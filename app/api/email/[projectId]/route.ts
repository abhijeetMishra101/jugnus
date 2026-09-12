import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { Resend } from 'resend'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params

  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'Email not configured (RESEND_API_KEY missing)' }, { status: 503 })
  }

  let body: { to: string; subject: string; html?: string; text?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { to, subject, html, text } = body
  if (!to || !subject || (!html && !text)) {
    return NextResponse.json({ error: 'to, subject, and html or text are required' }, { status: 400 })
  }

  const db = createServiceClient()
  const { data: project } = await db.from('projects').select('id').eq('id', projectId).single()
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  const from = process.env.RESEND_FROM_EMAIL ?? 'Jugnus <noreply@jugnus.app>'
  const resend = new Resend(apiKey)

  const { error } = await resend.emails.send({
    from, to, subject,
    ...(html ? { html } : { text: text ?? '' }),
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
