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
  try {
    await dispatchJugnu({ projectId, taskId, jugnuKey, db, nudge })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await db.from('messages').insert({
      project_id: projectId,
      author_type: 'system',
      author_key: 'system',
      content: `❌ ${jugnuKey} hit an error: ${msg}`,
      metadata: { event_type: 'REVIEW_FAILED', jugnu_key: jugnuKey, error: msg },
    })
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
