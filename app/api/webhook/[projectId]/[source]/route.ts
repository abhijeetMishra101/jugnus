import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

type Params = { params: Promise<{ projectId: string; source: string }> }

// Receives inbound webhooks from third parties (Stripe, Twilio, etc.)
// Stores each payload in project_data under collection `webhook_<source>`
// Leo's app reads events via GET /api/data/[projectId]/webhook_<source>
export async function POST(request: Request, { params }: Params) {
  const { projectId, source } = await params

  let payload: unknown
  const contentType = request.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    try { payload = await request.json() } catch { payload = {} }
  } else if (contentType.includes('application/x-www-form-urlencoded')) {
    const text = await request.text()
    payload = Object.fromEntries(new URLSearchParams(text))
  } else {
    payload = { raw: await request.text() }
  }

  const db = createServiceClient()
  const { data: project } = await db.from('projects').select('id').eq('id', projectId).single()
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  const collection = `webhook_${source.replace(/[^a-zA-Z0-9_]/g, '_')}`
  await db.from('project_data').insert({
    project_id: projectId,
    collection,
    record: {
      source,
      payload,
      received_at: new Date().toISOString(),
    },
  })

  return NextResponse.json({ ok: true })
}
