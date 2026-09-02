import type { SupabaseClient } from '@supabase/supabase-js'
import { dispatchJugnu } from './dispatch'
import { advanceProject } from '../orchestration/executor'
import type { JugnuKey } from './registry'

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
    })
    return
  }

  const { dispatched, jugnuKey: nextKey, taskId: nextTaskId } = await advanceProject(projectId, db)

  if (dispatched && nextKey) {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
    await fetch(`${appUrl}/api/internal/jugnu-respond`, {
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
