import type { SupabaseClient } from '@supabase/supabase-js'
import type { JugnuKey } from '../jugnus/registry'

interface Task {
  id: string
  title: string
  jugnu_key: string
  depends_on: string[]
  status: string
  eta?: string | null
}

export async function getNextReadyTask(
  projectId: string,
  db: SupabaseClient
): Promise<Task | null> {
  const { data: tasks } = await db
    .from('tasks')
    .select('id, title, jugnu_key, depends_on, status, eta')
    .eq('project_id', projectId)
    .order('sort_order', { ascending: true })

  if (!tasks?.length) return null

  const completedIds = new Set(
    tasks.filter((t) => t.status === 'completed' || t.status === 'skipped').map((t) => t.id)
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

  // Don't advance while a founder question is pending — pipeline resumes when they reply
  const { count: pendingEscalations } = await db
    .from('escalations')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', projectId)
    .eq('status', 'pending')
  if ((pendingEscalations ?? 0) > 0) {
    return { dispatched: false, jugnuKey: null, taskId: null }
  }

  const next = await getNextReadyTask(projectId, db)
  if (!next) {
    const { count } = await db
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .not('status', 'in', '("completed","skipped","failed")')

    if (count === 0) {
      // Skip if PROJECT_COMPLETED was already emitted (e.g. by Tara's approve handler)
      const { count: alreadyEmitted } = await db
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', projectId)
        .eq('author_type', 'system')
        .contains('metadata', { event_type: 'PROJECT_COMPLETED' })
      if ((alreadyEmitted ?? 0) > 0) {
        return { dispatched: false, jugnuKey: null, taskId: null }
      }

      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''

      // Generate a URL-safe slug from the project title for a branded preview link.
      // Stored in constraints.preview_slug (works without migration) and preview_slug
      // column (used after 011_project_slug migration is applied).
      const { data: projTitle } = await db.from('projects').select('title, constraints').eq('id', projectId).single()
      const rawTitle = ((projTitle?.title as string) ?? '').split('\n')[0].replace(/^#+\s*/, '').replace(/Project Name:\s*/i, '').trim()
      const slug = rawTitle
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, '')
        .trim()
        .replace(/\s+/g, '-')
        .slice(0, 40)
        || projectId.slice(0, 8)

      const previewUrl = appUrl ? `${appUrl}/preview/${slug}` : null

      const existingConstraints = ((projTitle?.constraints ?? {}) as Record<string, unknown>)
      await db.from('projects').update({
        status: 'completed',
        preview_slug: slug,
        constraints: { ...existingConstraints, preview_slug: slug, revision_mode: false },
        ...(previewUrl ? { deploy_url: previewUrl } : {}),
      }).eq('id', projectId)

      const { data: hasFiles } = await db
        .from('file_snapshots')
        .select('id')
        .eq('project_id', projectId)
        .not('path', 'ilike', 'design/%')
        .limit(1)
        .single()

      const deployLine = previewUrl && hasFiles
        ? `\n\n🌐 Preview: ${previewUrl}`
        : ''

      await db.from('messages').insert({
        project_id: projectId,
        author_type: 'system',
        author_key: 'system',
        content: `✨ All tasks completed. Your Jugnus finished the project.${deployLine}`,
        metadata: { event_type: 'PROJECT_COMPLETED', project_complete: true, deploy_url: previewUrl },
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
    const { data: humanClaimed } = await db
      .from('tasks')
      .update({ status: 'in_progress', started_at: new Date().toISOString() })
      .eq('id', next.id)
      .eq('status', 'pending')
      .select('id')
      .single()
    if (!humanClaimed) return { dispatched: false, jugnuKey: null, taskId: next.id }
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

  // Credit pre-check — block dispatch if budget headroom is too thin.
  // Prevents mid-run ceiling hits that waste tokens and leave tasks stuck.
  const { data: projBudget } = await db
    .from('projects')
    .select('total_cost_usd, credit_ceiling_usd')
    .eq('id', projectId)
    .single()
  const spent = (projBudget?.total_cost_usd as number) ?? 0
  const ceiling = (projBudget?.credit_ceiling_usd as number) ?? Infinity
  const headroom = ceiling - spent
  // Minimum headroom required per jugnu (rough lower-bound cost per run)
  const MIN_HEADROOM: Record<string, number> = { leo: 0.40, nia: 0.10, tara: 0.08, maya: 0.05 }
  const required = MIN_HEADROOM[next.jugnu_key] ?? 0.10
  if (headroom < required) {
    await db.from('projects').update({ status: 'paused' }).eq('id', projectId)
    await db.from('messages').insert({
      project_id: projectId,
      author_type: 'system',
      author_key: 'system',
      content: `⏸️ Build paused — $${spent.toFixed(2)} of $${ceiling.toFixed(2)} used. Increase your budget in project settings to continue.`,
      metadata: { event_type: 'BUDGET_PAUSED', spent, ceiling, jugnu_blocked: next.jugnu_key },
    })
    return { dispatched: false, jugnuKey: null, taskId: null }
  }

  // Atomic claim — only succeeds if task is still 'pending', preventing double-dispatch
  const { data: claimed } = await db
    .from('tasks')
    .update({ status: 'in_progress', started_at: new Date().toISOString() })
    .eq('id', next.id)
    .eq('status', 'pending')
    .select('id')
    .single()

  if (!claimed) return { dispatched: false, jugnuKey: null, taskId: null }

  const { data: proj } = await db.from('projects').select('workspace_id').eq('id', projectId).single()
  if (proj?.workspace_id) {
    await db.from('jugnus').update({ status: 'working' })
      .eq('workspace_id', proj.workspace_id)
      .eq('key', next.jugnu_key)
  }

  // Use Maya's project-specific estimate if she provided one; fall back to generic ranges
  const FALLBACK_ETA: Partial<Record<string, string>> = {
    nia:  '~1–3 min',
    leo:  '~3–5 min',
    tara: '~1–2 min',
  }
  const eta = next.eta ?? FALLBACK_ETA[next.jugnu_key]
  const jugnu_name = next.jugnu_key.charAt(0).toUpperCase() + next.jugnu_key.slice(1)
  const content = eta
    ? `⚡ ${jugnu_name} is on it — expect results in ${eta}`
    : `⚡ ${jugnu_name} is on it`

  await db.from('messages').insert({
    project_id: projectId,
    author_type: 'system',
    author_key: 'system',
    content,
    task_id: next.id,
    metadata: { event_type: 'TASK_ASSIGNED', jugnu_key: next.jugnu_key, task_id: next.id },
  })

  return { dispatched: true, jugnuKey: next.jugnu_key as JugnuKey, taskId: next.id }
}
