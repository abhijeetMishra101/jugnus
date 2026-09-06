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
 * Each hop gets its own independent 300s Vercel waitUntil budget.
 * Non-recursive — avoids timeout accumulation across jugnus.
 */
export async function runPipeline(
  projectId: string,
  taskId: string | null,
  jugnuKey: JugnuKey,
  db: SupabaseClient
): Promise<void> {
  try {
    await dispatchJugnu({ projectId, taskId, jugnuKey, db })
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
    // Derive the app URL — NEXT_PUBLIC_APP_URL must be set in Vercel env vars;
    // fall back to VERCEL_URL (auto-set by Vercel) so handoffs work even if
    // the env var is missing.
    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL ??
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '')

    // Fire and forget — jugnu-respond runs the next jugnu synchronously in its
    // own 300s invocation. We don't await so this invocation can exit cleanly.
    void fetch(`${appUrl}/api/internal/jugnu-respond`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.INTERNAL_API_SECRET ?? ''}`,
      },
      body: JSON.stringify({ projectId, taskId: nextTaskId, jugnuKey: nextKey }),
    }).catch((e) => {
      console.error('[pipeline] handoff to next jugnu failed:', e)
    })
  }
}
