import { NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { createServiceClient } from '@/lib/supabase/server'

/**
 * POST /api/messages
 * Founder sends a message in a project channel.
 * - Pending escalation → resolve + re-dispatch the blocked jugnu
 * - Completed project  → start a revision run (Maya plans the minimal change set)
 * - Otherwise          → save and return (pipeline is already running or idle)
 */
export async function POST(request: Request) {
  const { projectId, content, userId, attachments } = await request.json() as {
    projectId: string
    content: string
    userId: string
    attachments?: Array<{ url: string; name: string; type: string; size: number; isImage: boolean; textContent?: string | null }>
  }

  if (!projectId || !content?.trim() || !userId) {
    return NextResponse.json({ error: 'projectId, content, userId required' }, { status: 400 })
  }

  const db = createServiceClient()

  const metadata: Record<string, unknown> = { event_type: 'USER_MESSAGE' }
  if (attachments?.length) metadata.attachments = attachments

  // Insert founder message
  const { data: msg, error } = await db
    .from('messages')
    .insert({ project_id: projectId, author_type: 'user', author_key: userId, content: content.trim(), metadata })
    .select('id')
    .single()

  if (error || !msg) return NextResponse.json({ error: 'Failed to save message' }, { status: 500 })

  // Check for pending escalation — if so, resolve it, persist Q&A, and re-dispatch the correct jugnu
  const { data: escalation } = await db
    .from('escalations')
    .select('id, question, options, jugnu_key, task_id')
    .eq('project_id', projectId)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(1)
    .single()

  // Persist image attachments to project constraints so jugnus can embed them with correct URLs
  if (attachments?.some((a) => a.isImage)) {
    const { data: projData } = await db.from('projects').select('constraints').eq('id', projectId).single()
    const existing = ((projData?.constraints ?? {}) as Record<string, unknown>)
    const priorAtts = Array.isArray(existing.attachments)
      ? (existing.attachments as Array<{ url: string; name: string; isImage: boolean }>)
      : []
    const newAtts = attachments
      .filter((a) => a.isImage && !priorAtts.some((p) => p.url === a.url))
      .map((a) => ({ url: a.url, name: a.name, isImage: a.isImage }))
    if (newAtts.length > 0) {
      await db.from('projects').update({
        constraints: { ...existing, attachments: [...priorAtts, ...newAtts] },
      }).eq('id', projectId)
    }
  }

  if (escalation) {
    await db.from('escalations').update({ status: 'resolved', resolution: content.trim(), resolved_at: new Date().toISOString() })
      .eq('id', escalation.id)

    const resumeJugnuKey = (escalation.jugnu_key ?? 'maya') as string

    // Persist Q&A as a durable founder constraint so all downstream jugnus receive it
    if (escalation.question) {
      const { data: projData } = await db.from('projects').select('constraints').eq('id', projectId).single()
      const existing = ((projData?.constraints ?? {}) as Record<string, unknown>)
      const prior = Array.isArray(existing.founder_constraints)
        ? (existing.founder_constraints as Array<Record<string, unknown>>)
        : []

      // Extract category tag from the escalation's options array (Maya quiz questions carry it)
      type QuestionOption = { text: string; options: string[]; category?: string }
      const escalationOptions = (escalation.options as QuestionOption[] | null) ?? []
      const category = escalationOptions[0]?.category ?? null

      // Tag Q&As added during a revision run so Tara can distinguish them from original quiz entries
      const isRevisionRun = (existing.revision_mode as boolean | undefined) === true

      await db.from('projects').update({
        constraints: {
          ...existing,
          founder_constraints: [
            ...prior,
            {
              question: escalation.question,
              answer: content.trim(),
              ...(category ? { category } : {}),
              ...(isRevisionRun ? { is_revision: true } : {}),
              source: resumeJugnuKey === 'maya' ? 'clarification' : 'info_request',
              created_at: new Date().toISOString(),
            },
          ],
        },
      }).eq('id', projectId)
    }

    // Signal the resuming jugnu so UI shows typing indicator immediately
    const jugnuName = resumeJugnuKey.charAt(0).toUpperCase() + resumeJugnuKey.slice(1)
    const resumeMsg = resumeJugnuKey === 'maya'
      ? '✨ Maya is reviewing your answers and assembling the plan…'
      : `✨ ${jugnuName} is back — continuing with your details…`

    await db.from('messages').insert({
      project_id: projectId,
      author_type: 'system',
      author_key: 'system',
      content: resumeMsg,
      metadata: { event_type: 'TASK_ASSIGNED', jugnu_key: resumeJugnuKey },
    })

    // Look up the jugnu's in-progress task (use escalation.task_id as the reliable source)
    const resumeTaskId = escalation.task_id ?? null

    waitUntil(
      fetch(new URL('/api/internal/jugnu-respond', process.env.NEXT_PUBLIC_APP_URL!).toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.INTERNAL_API_SECRET}` },
        body: JSON.stringify({ projectId, taskId: resumeTaskId, jugnuKey: resumeJugnuKey }),
      }).catch(console.error)
    )
  } else {
    // ── Post-completion revision ───────────────────────────────────────────────
    // No active escalation. If the project is completed, treat the founder's message
    // as a change request: Maya plans the smallest valid set of agents to address it.
    const { data: proj } = await db
      .from('projects')
      .select('status, constraints, preview_slug')
      .eq('id', projectId)
      .single()

    if (proj?.status === 'completed') {
      const existingConstraints = ((proj.constraints ?? {}) as Record<string, unknown>)
      const previewSlug = (existingConstraints.preview_slug as string | undefined) ?? proj.preview_slug as string | undefined ?? projectId
      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
      const previewUrl = appUrl ? `${appUrl}/preview/${previewSlug}` : null

      // List non-design files so Maya knows what's already built
      const { data: snapshots } = await db
        .from('file_snapshots')
        .select('path')
        .eq('project_id', projectId)
        .not('path', 'ilike', 'design/%')
        .limit(20)
      const filePaths = (snapshots ?? []).map((s) => s.path as string).join(', ') || 'index.html'

      // Mark project as building + set revision_mode so agents know context
      await db.from('projects').update({
        status: 'building',
        constraints: { ...existingConstraints, revision_mode: true },
      }).eq('id', projectId)

      const taskDescription = `REVISION REQUEST: "${content.trim()}"

The project is already built and live${previewUrl ? ` at ${previewUrl}` : ''}.
Existing files: ${filePaths}

Run the REVISION QUIZ before planning. See REVISION MODE in your system prompt for the quiz protocol. Only call create_task_plan after the quiz is complete. In Leo's task description always include: "Read index.html first with read_file, then modify only what was asked — do not rewrite the file."`

      // Create and immediately claim the revision Maya task
      const { data: revTask } = await db.from('tasks').insert({
        project_id: projectId,
        title: `Revision: ${content.trim().slice(0, 80)}`,
        description: taskDescription,
        capability: 'planning',
        jugnu_key: 'maya',
        status: 'in_progress',
        started_at: new Date().toISOString(),
        depends_on: [],
        sort_order: 9999,
      }).select('id').single()

      await db.from('messages').insert({
        project_id: projectId,
        author_type: 'system',
        author_key: 'system',
        content: '✏️ Got it — Maya is reviewing and planning the changes…',
        metadata: { event_type: 'REVISION_STARTED', task_id: revTask?.id },
      })

      waitUntil(
        fetch(new URL('/api/internal/jugnu-respond', process.env.NEXT_PUBLIC_APP_URL!).toString(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.INTERNAL_API_SECRET ?? ''}` },
          body: JSON.stringify({
            projectId,
            taskId: revTask?.id ?? null,
            jugnuKey: 'maya',
            nudge: 'REVISION MODE is active. Run the REVISION QUIZ first — see your system prompt for the protocol. Do not call create_task_plan until the quiz is complete.',
          }),
        }).catch(console.error)
      )
    }
  }

  return NextResponse.json({ id: msg.id }, { status: 201 })
}
