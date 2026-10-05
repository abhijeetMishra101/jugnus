import type { SupabaseClient } from '@supabase/supabase-js'
import type { JugnuKey } from './registry'

export interface JugnuRole {
  display_role: string
  focus: string
}

export interface ProjectContext {
  projectId: string
  title: string
  objective: string
  constraints: Record<string, unknown>
  jugnu_roles: Record<string, JugnuRole>
  status: string
  currentTask: TaskContext | null
  completedTasks: TaskContext[]
  pendingTasks: TaskContext[]
  existingFiles: string[]
  learnings: string[]
}

export interface TaskContext {
  id: string
  title: string
  description: string
  capability: string
  jugnu_key: string
  status: string
  result: string | null
  artifact: Record<string, unknown> | null
}

export async function buildProjectContext(
  projectId: string,
  currentTaskId: string | null,
  db: SupabaseClient,
  jugnuKey?: string
): Promise<ProjectContext | null> {
  const { data: project } = await db
    .from('projects')
    .select('id, title, objective, constraints, status')
    .eq('id', projectId)
    .single()

  if (!project) return null

  const [tasksRes, filesRes] = await Promise.all([
    db.from('tasks')
      .select('id, title, description, capability, jugnu_key, status, result, artifact')
      .eq('project_id', projectId)
      .order('sort_order', { ascending: true }),
    db.from('file_snapshots')
      .select('path')
      .eq('project_id', projectId)
      .order('path', { ascending: true }),
  ])

  // Fetch learnings for this jugnu — graceful if table doesn't exist yet
  let learnings: string[] = []
  if (jugnuKey) {
    try {
      const { data: rows } = await db
        .from('jugnu_learnings')
        .select('content, learning_type')
        .eq('jugnu_key', jugnuKey)
        .order('created_at', { ascending: false })
        .limit(6)
      if (rows?.length) {
        learnings = rows.map((r: { content: string; learning_type: string }) =>
          `[${r.learning_type}] ${r.content}`
        )
      }
    } catch {
      // table not yet migrated — silently skip
    }
  }

  const allTasks = (tasksRes.data ?? []) as TaskContext[]
  const existingFiles = (filesRes.data ?? []).map((f: { path: string }) => f.path)
  const currentTask = currentTaskId
    ? allTasks.find((t) => t.id === currentTaskId) ?? null
    : allTasks.find((t) => t.status === 'in_progress') ?? null

  const constraints = (project.constraints ?? {}) as Record<string, unknown>
  const jugnu_roles = (constraints.jugnu_roles ?? {}) as Record<string, JugnuRole>

  return {
    projectId: project.id,
    title: project.title,
    objective: project.objective,
    constraints,
    jugnu_roles,
    status: project.status,
    currentTask,
    completedTasks: allTasks.filter((t) => t.status === 'completed'),
    pendingTasks: allTasks.filter((t) => t.status === 'pending'),
    existingFiles,
    learnings,
  }
}

export function formatContextBlock(ctx: ProjectContext, jugnuKey: JugnuKey): string {
  const completed = ctx.completedTasks.map((t) => {
    const artifact = t.artifact as Record<string, unknown> | null
    const buildEvidence = artifact?.build_evidence as Record<string, unknown> | undefined
    const previewNote = buildEvidence?.preview_url ? ` — preview: ${buildEvidence.preview_url}` : ''
    return `  ✅ ${t.title}${t.result ? `: ${t.result}` : ''}${previewNote}`
  }).join('\n')

  const pending = ctx.pendingTasks.map((t) =>
    `  ⏳ ${t.title} (${t.jugnu_key})`
  ).join('\n')

  const current = ctx.currentTask
    ? `CURRENT TASK — YOUR ASSIGNMENT:\n  Title: ${ctx.currentTask.title}\n  Description: ${ctx.currentTask.description}\n  Capability needed: ${ctx.currentTask.capability}`
    : 'No current task assigned.'

  const constraintLines = Object.entries(ctx.constraints)
    .filter(([k]) => !['jugnu_roles', 'founder_constraints', 'approval_metrics', 'attachments', 'acceptance_criteria'].includes(k))
    .map(([k, v]) => `  ${k}: ${v}`)
    .join('\n')

  type AttRef = { url: string; name: string; isImage: boolean }
  const attachmentRefs = (ctx.constraints.attachments as AttRef[] | undefined) ?? []
  const attachmentBlock = attachmentRefs.length > 0
    ? `\nFOUNDER IMAGES — PERMANENT PUBLIC URLs (use verbatim as img src):\n${attachmentRefs.filter((a) => a.isImage).map((a) => `  <img src="${a.url}" alt="${a.name}">`).join('\n')}${attachmentRefs.filter((a) => !a.isImage).length > 0 ? `\nFOUNDER FILES:\n${attachmentRefs.filter((a) => !a.isImage).map((a) => `  📄 ${a.name}`).join('\n')}` : ''}\nCRITICAL: The URLs above are permanent public URLs. Copy them verbatim into <img src="URL"> tags. Do NOT invent your own URL format or use placeholder paths.`
    : ''

  const founderConstraintsRaw: unknown = ctx.constraints.founder_constraints
  let founderDecisionLines = ''
  if (Array.isArray(founderConstraintsRaw) && founderConstraintsRaw.length > 0) {
    // New structured format: [{question, answer, source, created_at}]
    founderDecisionLines = (founderConstraintsRaw as Array<Record<string, unknown>>)
      .map((entry) => `  Q: ${String(entry.question)}\n  A: ${String(entry.answer)}`)
      .join('\n\n')
  } else if (founderConstraintsRaw && typeof founderConstraintsRaw === 'object' && !Array.isArray(founderConstraintsRaw)) {
    // Legacy key-value format (backwards compatibility)
    founderDecisionLines = Object.entries(founderConstraintsRaw as Record<string, unknown>)
      .map(([q, a]) => `  ${q}: ${String(a)}`)
      .join('\n')
  }

  // Extract build evidence from Leo's completed task (if present) for Tara
  const leoBuildEvidence = ctx.completedTasks
    .filter((t) => t.jugnu_key === 'leo')
    .map((t) => (t.artifact as Record<string, unknown> | null)?.build_evidence as Record<string, unknown> | undefined)
    .filter(Boolean)
    .pop()

  const buildEvidenceBlock = leoBuildEvidence
    ? `\nBUILD EVIDENCE (deterministic checks — do NOT ignore these):\n` +
      `  HTML valid: ${leoBuildEvidence.html_valid ? '✅ yes' : '❌ no'}\n` +
      `  Primary file: ${String(leoBuildEvidence.primary_html_file ?? 'none')}\n` +
      `  Preview URL: ${String(leoBuildEvidence.preview_url ?? 'unavailable')}\n` +
      `  Checked at: ${String(leoBuildEvidence.checked_at ?? 'unknown')}\n` +
      `  NOTE: Do NOT approve if html_valid is false.`
    : ''

  // Inject project-specific persona for this jugnu
  const role = ctx.jugnu_roles[jugnuKey]
  const personaLine = role
    ? `\nYOUR ROLE ON THIS PROJECT:\n  ${role.display_role}\n  Focus: ${role.focus}`
    : ''

  const filesBlock = ctx.existingFiles.length > 0
    ? `\nFILES ALREADY WRITTEN (skip these — do NOT overwrite unless fixing a specific issue):\n${ctx.existingFiles.map((f) => `  ${f}`).join('\n')}`
    : ''

  type AcceptanceCriterion = { id: string; description: string; category?: string; question?: string; founder_answer?: string | null; source: string }
  const rawCriteria = ctx.constraints.acceptance_criteria as AcceptanceCriterion[] | undefined
  const acceptanceCriteriaBlock = rawCriteria?.length
    ? `\nACCEPTANCE CRITERIA — verify EVERY item, report pass/fail for each:\n${
        rawCriteria.map((c, i) =>
          `  ${i + 1}. [${c.source === 'inferred' ? 'INFERRED' : 'FOUNDER'}] ${c.description}`
        ).join('\n')
      }`
    : ''

  const learningsBlock = ctx.learnings.length > 0
    ? `\nLEARNINGS FROM PAST PROJECTS (real mistakes and patterns — apply these):\n${ctx.learnings.map((l) => `  • ${l}`).join('\n')}`
    : ''

  return `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
JUGNUS PROJECT BRIEF
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Project: ${ctx.title}
ID: ${ctx.projectId}
Status: ${ctx.status}

FOUNDER OBJECTIVE:
${ctx.objective}
${attachmentBlock}
${constraintLines ? `\nCONSTRAINTS:\n${constraintLines}` : ''}
${founderDecisionLines ? `\nFOUNDER DECISIONS (from clarification — apply these to your work):\n${founderDecisionLines}` : ''}
${acceptanceCriteriaBlock}
${completed ? `\nCOMPLETED TASKS:\n${completed}` : ''}
${pending ? `\nUPCOMING TASKS:\n${pending}` : ''}
${filesBlock}
${buildEvidenceBlock}
${learningsBlock}

${current}
${personaLine}

You are acting as ${jugnuKey.toUpperCase()} for this project.
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
}
