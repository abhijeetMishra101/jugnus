import type { SupabaseClient } from '@supabase/supabase-js'
import { dispatchJugnu } from './dispatch'
import { advanceProject } from '../orchestration/executor'
import type { JugnuKey } from './registry'

async function resetJugnuIdle(projectId: string, jugnuKey: JugnuKey, db: SupabaseClient) {
  const { data: proj } = await db.from('projects').select('workspace_id').eq('id', projectId).single()
  if (proj?.workspace_id) {
    await db.from('jugnus').update({ status: 'idle' })
      .eq('workspace_id', proj.workspace_id)
      .eq('key', jugnuKey)
  }
}

/**
 * Dispatches ONE jugnu, then fires an HTTP handoff to jugnu-respond for the next.
 * Each hop gets its own independent Vercel invocation budget.
 *
 * jugnu-respond now responds 202 immediately and processes async, so we can
 * await the fetch here to confirm delivery before this function exits.
 * Previously void fetch() was fire-and-forget — Vercel terminated the function
 * before the TCP connection was established, silently dropping the handoff.
 */
export async function runPipeline(
  projectId: string,
  taskId: string | null,
  jugnuKey: JugnuKey,
  db: SupabaseClient,
  nudge?: string
): Promise<void> {
  // Try once, then retry after 3s before giving up — handles transient Anthropic API errors
  // that previously left tasks stuck in_progress for 2+ minutes until the watchdog fired.
  let dispatchError: Error | null = null
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 3000))
      await dispatchJugnu({ projectId, taskId, jugnuKey, db, nudge })
      dispatchError = null
      break
    } catch (err) {
      dispatchError = err instanceof Error ? err : new Error(String(err))
    }
  }

  if (dispatchError) {
    await db.from('messages').insert({
      project_id: projectId,
      author_type: 'system',
      author_key: 'system',
      content: `❌ ${jugnuKey} hit an error: ${dispatchError.message}`,
      metadata: { event_type: 'REVIEW_FAILED', jugnu_key: jugnuKey, error: dispatchError.message },
    })
    // Reset task to pending so the watchdog can re-dispatch quickly (not stuck in_progress)
    if (taskId) {
      await db.from('tasks').update({ status: 'pending', started_at: null }).eq('id', taskId)
    }
    await resetJugnuIdle(projectId, jugnuKey, db)
    return
  }

  await resetJugnuIdle(projectId, jugnuKey, db)

  const { dispatched, jugnuKey: nextKey, taskId: nextTaskId } = await advanceProject(projectId, db)

  if (dispatched && nextKey) {
    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL ??
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '')

    // Await the fetch — jugnu-respond responds 202 immediately so this resolves in < 1s.
    // Awaiting ensures the HTTP request is fully sent before this function exits,
    // preventing Vercel from terminating the connection mid-handoff.
    try {
      const res = await fetch(`${appUrl}/api/internal/jugnu-respond`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.INTERNAL_API_SECRET ?? ''}`,
        },
        body: JSON.stringify({ projectId, taskId: nextTaskId, jugnuKey: nextKey }),
      })
      if (!res.ok) {
        console.error(`[pipeline] handoff to ${nextKey} returned ${res.status}`)
      }
    } catch (e) {
      console.error('[pipeline] handoff to next jugnu failed:', e)
    }
  }
}
