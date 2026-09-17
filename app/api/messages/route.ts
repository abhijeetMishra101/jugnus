import { NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { createServiceClient } from '@/lib/supabase/server'

/**
 * POST /api/messages
 * Founder sends a message in a project channel.
 * If there's a pending escalation, resolves it and re-dispatches Maya.
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
    .select('id, question, jugnu_key, task_id')
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

      await db.from('projects').update({
        constraints: {
          ...existing,
          founder_constraints: [
            ...prior,
            {
              question: escalation.question,
              answer: content.trim(),
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
  }

  return NextResponse.json({ id: msg.id }, { status: 201 })
}
