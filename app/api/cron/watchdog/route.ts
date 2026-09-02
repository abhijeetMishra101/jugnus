import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

const STUCK_THRESHOLD_MINUTES = 4

/**
 * Watchdog cron — runs every 5 minutes via Vercel Crons.
 * Finds tasks that have been in_progress for over STUCK_THRESHOLD_MINUTES,
 * marks them blocked, and posts a recovery message.
 */
export async function GET(request: Request) {
  // Vercel Crons sends Authorization: Bearer <CRON_SECRET>.
  // Only enforce the check when CRON_SECRET is actually configured.
  const envSecret = process.env.CRON_SECRET
  if (envSecret) {
    const cronSecret = request.headers.get('authorization')
    if (cronSecret !== `Bearer ${envSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const db = createServiceClient()
  const cutoff = new Date(Date.now() - STUCK_THRESHOLD_MINUTES * 60 * 1000).toISOString()

  const { data: stuckTasks } = await db
    .from('tasks')
    .select('id, project_id, jugnu_key, title')
    .eq('status', 'in_progress')
    .lt('started_at', cutoff)

  if (!stuckTasks?.length) {
    return NextResponse.json({ recovered: 0 })
  }

  const recovered: string[] = []

  for (const task of stuckTasks) {
    // Re-dispatch the jugnu for this task
    const res = await fetch(
      new URL('/api/internal/jugnu-respond', process.env.NEXT_PUBLIC_APP_URL!).toString(),
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.INTERNAL_API_SECRET}`,
        },
        body: JSON.stringify({
          projectId: task.project_id,
          taskId: task.id,
          jugnuKey: task.jugnu_key,
          nudge: `Your last attempt on "${task.title}" appears to have stalled. Please retry — pick up exactly where you left off.`,
        }),
      }
    )

    if (res.ok) {
      recovered.push(task.id)
    } else {
      // If re-dispatch fails, mark blocked so the founder can see it
      await db.from('tasks').update({ status: 'blocked' }).eq('id', task.id)
      await db.from('messages').insert({
        project_id: task.project_id,
        author_key: 'system',
        content: `⚠️ Task "${task.title}" is stuck and couldn't be recovered automatically. Check the Settings page to verify your GitHub connection.`,
        metadata: { type: 'watchdog_block' },
      })
    }
  }

  return NextResponse.json({ recovered: recovered.length, ids: recovered })
}
