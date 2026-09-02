import type { SupabaseClient } from '@supabase/supabase-js'
import { dispatchJugnu } from './dispatch'
import { advanceProject } from '../orchestration/executor'
import type { JugnuKey } from './registry'

/**
 * Runs the full jugnu pipeline to completion in a single async chain.
 * dispatch jugnu → advance project → dispatch next → repeat.
 * Designed to run inside a single Vercel waitUntil (maxDuration=300).
 */
export async function runPipeline(
  projectId: string,
  taskId: string | null,
  jugnuKey: JugnuKey,
  db: SupabaseClient
): Promise<void> {
  await dispatchJugnu({ projectId, taskId, jugnuKey, db })

  const { dispatched, jugnuKey: nextKey, taskId: nextTaskId } = await advanceProject(projectId, db)
  if (dispatched && nextKey) {
    await runPipeline(projectId, nextTaskId, nextKey, db)
  }
}
