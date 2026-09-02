import { NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { createServiceClient } from '@/lib/supabase/server'

/**
 * POST /api/messages
 * Founder sends a message in a project channel.
 * If there's a pending escalation, resolves it and re-dispatches Maya.
 */
export async function POST(request: Request) {
  const { projectId, content, userId } = await request.json() as {
    projectId: string
    content: string
    userId: string
  }

  if (!projectId || !content?.trim() || !userId) {
    return NextResponse.json({ error: 'projectId, content, userId required' }, { status: 400 })
  }

  const db = createServiceClient()

  // Insert founder message
  const { data: msg, error } = await db
    .from('messages')
    .insert({ project_id: projectId, author_type: 'user', author_key: userId, content: content.trim() })
    .select('id')
    .single()

  if (error || !msg) return NextResponse.json({ error: 'Failed to save message' }, { status: 500 })

  // Check for pending escalation — if so, resolve it and kick Maya
  const { data: escalation } = await db
    .from('escalations')
    .select('id')
    .eq('project_id', projectId)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(1)
    .single()

  if (escalation) {
    await db.from('escalations').update({ status: 'resolved', resolution: content.trim(), resolved_at: new Date().toISOString() })
      .eq('id', escalation.id)

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
