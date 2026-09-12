import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

type Params = { params: Promise<{ projectId: string; collection: string; id: string }> }

export async function PATCH(req: Request, { params }: Params) {
  const { projectId, collection, id } = await params

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const db = createServiceClient()

  const { data: existing } = await db
    .from('project_data')
    .select('record')
    .eq('id', id)
    .eq('project_id', projectId)
    .eq('collection', collection)
    .single()

  if (!existing) return NextResponse.json({ error: 'Record not found' }, { status: 404 })

  const merged = { ...(existing.record as Record<string, unknown>), ...body }

  const { data: row, error } = await db
    .from('project_data')
    .update({ record: merged })
    .eq('id', id)
    .select('id, record, created_at, updated_at')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    record: { id: row.id, ...(row.record as Record<string, unknown>), created_at: row.created_at, updated_at: row.updated_at },
  })
}

export async function DELETE(_req: Request, { params }: Params) {
  const { projectId, collection, id } = await params
  const db = createServiceClient()

  const { error } = await db
    .from('project_data')
    .delete()
    .eq('id', id)
    .eq('project_id', projectId)
    .eq('collection', collection)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
