import type { SupabaseClient } from '@supabase/supabase-js'
import type { JugnuKey } from '../jugnus/registry'

interface Task {
  id: string
  title: string
  jugnu_key: string
  depends_on: string[]
  status: string
}

/**
 * Finds the next task ready to execute: pending with all dependencies completed.
 * Returns null if nothing is ready (all pending tasks are blocked by incomplete deps).
 */
export async function getNextReadyTask(
  projectId: string,
  db: SupabaseClient
): Promise<Task | null> {
  const { data: tasks } = await db
    .from('tasks')
    .select('id, title, jugnu_key, depends_on, status')
    .eq('project_id', projectId)
    .order('sort_order', { ascending: true })

  if (!tasks?.length) return null

  const completedIds = new Set(
    tasks.filter((t) => t.status === 'completed').map((t) => t.id)
  )

  return tasks.find((t) => {
    if (t.status !== 'pending') return false
    const deps = (t.depends_on ?? []) as string[]
    return deps.every((dep) => completedIds.has(dep))
  }) ?? null
}

/**
 * Marks a task as in_progress, updates the jugnu status, and dispatches the jugnu.
 * Called by the internal API route after task graph creation or task completion.
 */
export async function advanceProject(projectId: string, db: SupabaseClient): Promise<{
  dispatched: boolean
  jugnuKey: JugnuKey | null
  taskId: string | null
}> {
  // Check if project already has an in-progress task
  const { data: inProgress } = await db
    .from('tasks')
    .select('id')
    .eq('project_id', projectId)
    .eq('status', 'in_progress')
    .limit(1)
    .single()

  if (inProgress) {
    return { dispatched: false, jugnuKey: null, taskId: inProgress.id }
  }

  const next = await getNextReadyTask(projectId, db)
  if (!next) {
    // Check if all tasks are completed → project done
    const { count } = await db
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .neq('status', 'completed')

    if (count === 0) {
      await db.from('projects').update({ status: 'completed' }).eq('id', projectId)
      await db.from('messages').insert({
        project_id: projectId,
        author_type: 'system',
        author_key: 'system',
        content: '✨ All tasks completed. Your Jugnus finished the project.',
        metadata: { project_complete: true },
      })
      // Reset all jugnus in this workspace to idle
      const { data: proj } = await db.from('projects').select('workspace_id').eq('id', projectId).single()
      if (proj?.workspace_id) {
        await db.from('jugnus').update({ status: 'idle' }).eq('workspace_id', proj.workspace_id)
      }
    }
    return { dispatched: false, jugnuKey: null, taskId: null }
  }

  // Mark task in_progress and jugnu as working; reset retry_count for a fresh start
  await db.from('tasks').update({ status: 'in_progress', started_at: new Date().toISOString(), retry_count: 0 }).eq('id', next.id)
  await db.from('jugnus').update({ status: 'working' }).eq('workspace_id', (
    await db.from('projects').select('workspace_id').eq('id', projectId).single()
  ).data?.workspace_id).eq('key', next.jugnu_key)

  await db.from('messages').insert({
    project_id: projectId,
    author_type: 'system',
    author_key: 'system',
    content: `⚡ ${next.jugnu_key.toUpperCase()} is working on: ${next.title}`,
    task_id: next.id,
  })

  return { dispatched: true, jugnuKey: next.jugnu_key as JugnuKey, taskId: next.id }
}
