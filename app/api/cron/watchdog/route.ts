import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export const maxDuration = 60

// A jugnu is "stuck" if it has been in_progress for > 2 min with NO activity in that time.
// Activity = any message (including pre-tool activity inserts) OR any file_snapshots write.
// This catches two failure modes:
//   1. Cold-start / HTTP handoff silently dropped — jugnu never started
//   2. Mid-generation hang — jugnu started but stopped producing output
// Leo writing a large HTML file keeps file_snapshots.updated_at fresh every few seconds,
// so the 2-min check won't fire on genuine work even for long-running turns.
const NO_ACTIVITY_THRESHOLD_MINUTES = 1
// Hard ceiling — anything in_progress > 10 min is killed regardless of activity
const HARD_CAP_MINUTES = 10
const MAX_RETRIES = 3

/**
 * Watchdog cron — runs every minute via Vercel Crons.
 * Finds in_progress tasks where the jugnu has sent no messages in the last 3 minutes.
 * Restarts them up to MAX_RETRIES times, then marks failed.
 */
export async function GET(request: Request): Promise<Response> {
  const envSecret = process.env.CRON_SECRET
  if (envSecret) {
    const cronSecret = request.headers.get('authorization')
    if (cronSecret !== `Bearer ${envSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  let db: ReturnType<typeof createServiceClient>
  try {
    db = createServiceClient()
  } catch (e) {
    return NextResponse.json({ error: 'db_init_failed', detail: String(e) }, { status: 500 })
  }

  const activityCutoff = new Date(Date.now() - NO_ACTIVITY_THRESHOLD_MINUTES * 60 * 1000).toISOString()
  const hardCutoff     = new Date(Date.now() - HARD_CAP_MINUTES * 60 * 1000).toISOString()

  // Find in_progress tasks where the jugnu has been silent for 3+ min OR running for 8+ min
  type StuckRow = { id: string; project_id: string; jugnu_key: string; title: string; retry_count: number; last_activity_at: string | null }
  const { data: stuckTasks } = await db.rpc('get_stuck_tasks', {
    p_activity_cutoff: activityCutoff,
    p_hard_cutoff: hardCutoff,
  }) as { data: StuckRow[] | null }

  // Fallback: if RPC doesn't exist yet, use the old simple query
  let tasks: StuckRow[] = stuckTasks ?? []

  // Also catch orphaned pending tasks — all deps completed but jugnu was never dispatched
  // (happens when the void fetch from submit_for_review/approve silently drops)
  const ORPHAN_PENDING_MINUTES = 1
  const orphanCutoff = new Date(Date.now() - ORPHAN_PENDING_MINUTES * 60 * 1000).toISOString()
  const { data: allTasks } = await db
    .from('tasks')
    .select('id, project_id, jugnu_key, title, retry_count, depends_on, status, created_at')
    .eq('status', 'pending')
    .neq('jugnu_key', 'human')
    .lt('created_at', orphanCutoff)

  for (const t of allTasks ?? []) {
    // Check if all deps are completed — if so, this task is orphaned
    const deps = (t.depends_on as string[] | null) ?? []
    if (deps.length === 0) {
      // No deps but still pending — check if any sibling is in_progress (legitimate wait)
      const { count: inProgressCount } = await db
        .from('tasks')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', t.project_id)
        .eq('status', 'in_progress')
      if ((inProgressCount ?? 0) === 0 && !tasks.find((s) => s.id === t.id)) {
        // Promote to in_progress so the rest of the watchdog loop can handle it
        await db.from('tasks')
          .update({ status: 'in_progress', started_at: new Date().toISOString(), retry_count: 0 })
          .eq('id', t.id)
        tasks = [...tasks, { id: t.id, project_id: t.project_id, jugnu_key: t.jugnu_key, title: t.title, retry_count: 0, last_activity_at: null }]
      }
    }
  }

  if (!tasks.length) {
    return NextResponse.json({ recovered: 0, failed: 0 })
  }

  const recovered: string[] = []
  const failed: string[] = []

  for (const task of tasks) {
    const retries = (task.retry_count as number) ?? 0

    if (retries >= MAX_RETRIES) {
      // Give up — mark failed so the watchdog never touches this task again
      await db.from('tasks').update({ status: 'failed' }).eq('id', task.id)
      await db.from('messages').insert({
        project_id: task.project_id,
        author_type: 'system',
        author_key: 'system',
        content: `⚠️ Task "${task.title}" failed after ${MAX_RETRIES} retries and was stopped.`,
      })
      // Reset jugnu to idle
      const { data: proj } = await db.from('projects').select('workspace_id').eq('id', task.project_id).single()
      if (proj?.workspace_id) {
        await db.from('jugnus').update({ status: 'idle' })
          .eq('workspace_id', proj.workspace_id)
          .eq('key', task.jugnu_key)
      }
      failed.push(task.id)
      continue
    }

    // Increment retry count and reset started_at so the hard cap measures from this attempt, not the first
    await db.from('tasks').update({ retry_count: retries + 1, started_at: new Date().toISOString() }).eq('id', task.id)

    const base = process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin
    const res = await fetch(`${base}/api/internal/jugnu-respond`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.INTERNAL_API_SECRET}`,
      },
      body: JSON.stringify({
        projectId: task.project_id,
        taskId: task.id,
        jugnuKey: task.jugnu_key,
        nudge: `Your last attempt on "${task.title}" appears to have stalled (retry ${retries + 1}/${MAX_RETRIES}). Please retry — pick up exactly where you left off.`,
      }),
    })

    if (res.ok) {
      recovered.push(task.id)
    } else {
      // Re-dispatch failed — reset to pending so next cron can retry
      await db.from('tasks').update({ status: 'pending', started_at: null }).eq('id', task.id)
      await db.from('jugnus').update({ status: 'idle' }).eq('key', task.jugnu_key)
      console.error(`[watchdog] jugnu-respond returned ${res.status} for task ${task.id}`)
    }
  }

  return NextResponse.json({ recovered: recovered.length, failed: failed.length, ids: { recovered, failed } })
}
