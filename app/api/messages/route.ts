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

  // Check for pending escalation — if so, resolve it, persist Q&A as durable constraint, and re-dispatch Maya
  const { data: escalation } = await db
    .from('escalations')
    .select('id, question')
    .eq('project_id', projectId)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(1)
    .single()

  if (escalation) {
    await db.from('escalations').update({ status: 'resolved', resolution: content.trim(), resolved_at: new Date().toISOString() })
      .eq('id', escalation.id)

    // Persist Q&A as a durable founder constraint so all downstream jugnus receive it
    // regardless of whether the original chat messages fall outside the rolling history window
    if (escalation.question) {
      const { data: projData } = await db
        .from('projects')
        .select('constraints')
        .eq('id', projectId)
        .single()

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
              source: 'clarification',
              created_at: new Date().toISOString(),
            },
          ],
        },
      }).eq('id', projectId)
    }

    // Immediately signal Maya is back so the UI shows the typing indicator without the ~60s blind wait
    await db.from('messages').insert({
      project_id: projectId,
      author_type: 'system',
      author_key: 'system',
      content: '✨ Maya is reviewing your answers and assembling the plan…',
      metadata: { event_type: 'TASK_ASSIGNED', jugnu_key: 'maya' },
    })

    waitUntil(
      fetch(new URL('/api/internal/jugnu-respond', process.env.NEXT_PUBLIC_APP_URL!).toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.INTERNAL_API_SECRET}` },
        body: JSON.stringify({ projectId, taskId: null, jugnuKey: 'maya' }),
      }).catch(console.error)
    )
  }

  return NextResponse.json({ id: msg.id }, { status: 201 })
}
