import type { SupabaseClient } from '@supabase/supabase-js'
import type { JugnuKey } from '../jugnus/registry'

interface Task {
  id: string
  title: string
  jugnu_key: string
  depends_on: string[]
  status: string
}

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

export async function advanceProject(projectId: string, db: SupabaseClient): Promise<{
  dispatched: boolean
  jugnuKey: JugnuKey | null
  taskId: string | null
}> {
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
        metadata: { event_type: 'PROJECT_COMPLETED', project_complete: true },
      })
      const { data: proj } = await db.from('projects').select('workspace_id').eq('id', projectId).single()
      if (proj?.workspace_id) {
        await db.from('jugnus').update({ status: 'idle' }).eq('workspace_id', proj.workspace_id)
      }
    }
    return { dispatched: false, jugnuKey: null, taskId: null }
  }

  // Human approval task — pause pipeline, emit event, do not dispatch a jugnu
  if (next.jugnu_key === 'human') {
    await db.from('tasks').update({ status: 'in_progress', started_at: new Date().toISOString() }).eq('id', next.id)
    await db.from('messages').insert({
      project_id: projectId,
      author_type: 'system',
      author_key: 'system',
      content: '👀 Ready for your review. Approve to continue or share feedback.',
      task_id: next.id,
      metadata: { event_type: 'APPROVAL_REQUIRED', task_id: next.id },
    })
    return { dispatched: false, jugnuKey: null, taskId: next.id }
  }

  await db.from('tasks').update({ status: 'in_progress', started_at: new Date().toISOString(), retry_count: 0 }).eq('id', next.id)
  const { data: proj } = await db.from('projects').select('workspace_id').eq('id', projectId).single()
  if (proj?.workspace_id) {
    await db.from('jugnus').update({ status: 'working' })
      .eq('workspace_id', proj.workspace_id)
      .eq('key', next.jugnu_key)
  }

  await db.from('messages').insert({
    project_id: projectId,
    author_type: 'system',
    author_key: 'system',
    content: `⚡ ${next.jugnu_key.toUpperCase()} is working on: ${next.title}`,
    task_id: next.id,
    metadata: { event_type: 'TASK_ASSIGNED', jugnu_key: next.jugnu_key, task_id: next.id },
  })

  return { dispatched: true, jugnuKey: next.jugnu_key as JugnuKey, taskId: next.id }
}
