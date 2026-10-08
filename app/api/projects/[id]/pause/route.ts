import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const db = createServiceClient()

  const { error } = await db.from('projects').update({ status: 'paused' }).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await db.from('messages').insert({
    project_id: id,
    author_type: 'system',
    author_key: 'system',
    content: '⏸️ Pipeline paused. The current task will finish, then the team will wait. Send a message when you\'re ready to continue.',
    metadata: { event_type: 'PIPELINE_PAUSED' },
  })

  return NextResponse.json({ ok: true })
}
