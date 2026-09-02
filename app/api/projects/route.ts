import { NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { createServiceClient } from '@/lib/supabase/server'
import { JUGNU_REGISTRY } from '@/lib/jugnus/registry'
import { runPipeline } from '@/lib/jugnus/pipeline'

export const maxDuration = 300

/**
 * POST /api/projects
 * Creates a new project from a founder's objective and seeds the jugnu roster.
 * Then immediately dispatches Maya to clarify and build the task plan.
 */
export async function POST(request: Request) {
  const { workspaceId, objective } = await request.json() as {
    workspaceId: string
    objective: string
  }

  if (!workspaceId || !objective?.trim()) {
    return NextResponse.json({ error: 'workspaceId and objective required' }, { status: 400 })
  }

  const db = createServiceClient()

  // Derive a title from the first sentence of the objective
  const title = objective.split(/[.!?]/)[0].trim().slice(0, 80) || 'New Project'

  // Create the project
  const { data: project, error } = await db
    .from('projects')
    .insert({ workspace_id: workspaceId, title, objective: objective.trim(), status: 'planning' })
    .select('id')
    .single()

  if (error || !project) {
    return NextResponse.json({ error: 'Failed to create project' }, { status: 500 })
  }

  const projectId = project.id

  // Seed jugnu roster for this workspace (idempotent)
  await Promise.all(
    Object.values(JUGNU_REGISTRY).map((j) =>
      db.from('jugnus').upsert({
        workspace_id: workspaceId,
        key: j.key,
        name: j.name,
        role: j.role,
        capabilities: j.capabilities,
        color: j.color,
        status: 'idle',
      }, { onConflict: 'workspace_id,key', ignoreDuplicates: true })
    )
  )

  // Post founder's objective as first message
  await db.from('messages').insert({
    project_id: projectId,
    author_type: 'user',
    author_key: workspaceId,
    content: objective.trim(),
  })

  // Post Maya's "I'm on it" system message
  await db.from('messages').insert({
    project_id: projectId,
    author_type: 'system',
    author_key: 'system',
    content: '✨ Maya is reviewing your objective and assembling the team…',
  })

  // Dispatch Maya and run the full pipeline in a single waitUntil (no HTTP self-calling)
  waitUntil(
    runPipeline(projectId, null, 'maya', db).catch(async (err) => {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[projects] pipeline error:', msg)
      try {
        await db.from('messages').insert({
          project_id: projectId,
          author_type: 'system',
          author_key: 'system',
          content: `❌ Pipeline error: ${msg}`,
        })
      } catch { /* best-effort */ }
    })
  )

  return NextResponse.json({ id: projectId, title }, { status: 201 })
}
