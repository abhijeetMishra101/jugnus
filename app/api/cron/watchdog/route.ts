import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

const STUCK_THRESHOLD_MINUTES = 4
const MAX_RETRIES = 3

/**
 * Watchdog cron — runs every 5 minutes via Vercel Crons.
 * Finds tasks in_progress > STUCK_THRESHOLD_MINUTES.
 * Restarts them up to MAX_RETRIES times, then marks as failed to stop credit drain.
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

  const cutoff = new Date(Date.now() - STUCK_THRESHOLD_MINUTES * 60 * 1000).toISOString()

  const { data: stuckTasks } = await db
    .from('tasks')
    .select('id, project_id, jugnu_key, title, retry_count')
    .eq('status', 'in_progress')
    .lt('started_at', cutoff)

  if (!stuckTasks?.length) {
    return NextResponse.json({ recovered: 0, failed: 0 })
  }

  const recovered: string[] = []
  const failed: string[] = []

  for (const task of stuckTasks) {
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

    // Increment retry count before attempting
    await db.from('tasks').update({ retry_count: retries + 1 }).eq('id', task.id)

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
