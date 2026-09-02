import type { SupabaseClient } from '@supabase/supabase-js'
import type { JugnuKey } from './registry'

export interface ProjectContext {
  projectId: string
  title: string
  objective: string
  constraints: Record<string, unknown>
  status: string
  currentTask: TaskContext | null
  completedTasks: TaskContext[]
  pendingTasks: TaskContext[]
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

/**
 * Builds the full project context injected into every jugnu dispatch.
 * This is the fix for channel-history pollution: jugnus never need to infer
 * their assignment from noisy message history — it's handed to them explicitly.
 */
export async function buildProjectContext(
  projectId: string,
  currentTaskId: string | null,
  db: SupabaseClient
): Promise<ProjectContext | null> {
  const { data: project } = await db
    .from('projects')
    .select('id, title, objective, constraints, status')
    .eq('id', projectId)
    .single()

  if (!project) return null

  const { data: tasks } = await db
    .from('tasks')
    .select('id, title, description, capability, jugnu_key, status, result, artifact')
    .eq('project_id', projectId)
    .order('sort_order', { ascending: true })

  const allTasks = (tasks ?? []) as TaskContext[]
  const currentTask = currentTaskId
    ? allTasks.find((t) => t.id === currentTaskId) ?? null
    : allTasks.find((t) => t.status === 'in_progress') ?? null

  return {
    projectId: project.id,
    title: project.title,
    objective: project.objective,
    constraints: (project.constraints ?? {}) as Record<string, unknown>,
    status: project.status,
    currentTask,
    completedTasks: allTasks.filter((t) => t.status === 'completed'),
    pendingTasks: allTasks.filter((t) => t.status === 'pending'),
  }
}

/**
 * Formats the project context as a structured system-level prefix.
 * Prepended above the conversation history so the jugnu cannot miss it.
 */
export function formatContextBlock(ctx: ProjectContext, jugnuKey: JugnuKey): string {
  const completed = ctx.completedTasks.map((t) =>
    `  ✅ ${t.title}${t.result ? `: ${t.result}` : ''}${t.artifact ? ` [${(t.artifact as Record<string, string>).url ?? ''}]` : ''}`
  ).join('\n')

  const pending = ctx.pendingTasks.map((t) =>
    `  ⏳ ${t.title} (${t.jugnu_key})`
  ).join('\n')

  const current = ctx.currentTask
    ? `CURRENT TASK — YOUR ASSIGNMENT:\n  Title: ${ctx.currentTask.title}\n  Description: ${ctx.currentTask.description}\n  Capability needed: ${ctx.currentTask.capability}`
    : 'No current task assigned.'

  const constraintLines = Object.entries(ctx.constraints)
    .map(([k, v]) => `  ${k}: ${v}`)
    .join('\n')

  return `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
JUGNUS PROJECT BRIEF
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Project: ${ctx.title}
ID: ${ctx.projectId}
Status: ${ctx.status}

FOUNDER OBJECTIVE:
${ctx.objective}
${constraintLines ? `\nCONSTRAINTS:\n${constraintLines}` : ''}
${completed ? `\nCOMPLETED TASKS:\n${completed}` : ''}
${pending ? `\nUPCOMING TASKS:\n${pending}` : ''}

${current}

You are acting as ${jugnuKey.toUpperCase()} for this project.
Stack: Next.js + Supabase + Vercel (always — no configuration needed).
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`
}
