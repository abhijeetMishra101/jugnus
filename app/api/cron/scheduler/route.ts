import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { Resend } from 'resend'

export const maxDuration = 300

interface ScheduledAction {
  id: string
  project_id: string
  record: {
    action: string
    run_at: string
    status: string
    // send_email fields
    to?: string
    subject?: string
    html?: string
    text?: string
    // http_post fields
    url?: string
    body?: unknown
    headers?: Record<string, string>
  }
}

export async function GET(request: Request): Promise<Response> {
  const envSecret = process.env.CRON_SECRET
  if (envSecret) {
    const auth = request.headers.get('authorization')
    if (auth !== `Bearer ${envSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const db = createServiceClient()

  // Fetch all due pending actions via DB function
  const { data: actions, error } = await db.rpc('get_due_scheduled_actions')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!actions?.length) return NextResponse.json({ processed: 0 })

  const results: { id: string; action: string; status: string; error?: string }[] = []

  for (const raw of actions as ScheduledAction[]) {
    const { id, project_id, record } = raw

    // Atomically mark as running — skip if already claimed
    const { data: claimed } = await db
      .from('project_data')
      .update({ record: { ...record, status: 'running', started_at: new Date().toISOString() } })
      .eq('id', id)
      .filter('record->>status', 'eq', 'pending')
      .select('id')
      .maybeSingle()

    if (!claimed) continue

    let resultStatus = 'completed'
    let resultError: string | undefined

    try {
      if (record.action === 'send_email') {
        const apiKey = process.env.RESEND_API_KEY
        if (!apiKey) throw new Error('RESEND_API_KEY not configured')
        if (!record.to || !record.subject) throw new Error('send_email requires to and subject')

        const resend = new Resend(apiKey)
        const from = process.env.RESEND_FROM_EMAIL ?? 'Jugnus <noreply@jugnus.app>'
        const { error: emailErr } = await resend.emails.send({
          from,
          to: record.to,
          subject: record.subject,
          ...(record.html ? { html: record.html } : { text: record.text ?? '' }),
        })
        if (emailErr) throw new Error(emailErr.message)

      } else if (record.action === 'http_post') {
        if (!record.url) throw new Error('http_post requires url')
        const res = await fetch(record.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(record.headers ?? {}) },
          body: record.body != null ? JSON.stringify(record.body) : undefined,
        })
        if (!res.ok) throw new Error(`HTTP ${res.status} from ${record.url}`)

      } else {
        throw new Error(`Unknown action type: ${record.action}`)
      }
    } catch (err) {
      resultStatus = 'failed'
      resultError = err instanceof Error ? err.message : String(err)
    }

    await db
      .from('project_data')
      .update({
        record: {
          ...record,
          status: resultStatus,
          completed_at: new Date().toISOString(),
          ...(resultError ? { error: resultError } : {}),
        },
      })
      .eq('id', id)
      .eq('project_id', project_id)

    results.push({ id, action: record.action, status: resultStatus, error: resultError })
  }

  return NextResponse.json({ processed: results.length, results })
}
