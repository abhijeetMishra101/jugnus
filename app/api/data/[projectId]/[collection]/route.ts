import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

type Params = { params: Promise<{ projectId: string; collection: string }> }

export async function GET(_req: Request, { params }: Params) {
  const { projectId, collection } = await params
  const db = createServiceClient()

  const { data, error } = await db
    .from('project_data')
    .select('id, record, created_at, updated_at')
    .eq('project_id', projectId)
    .eq('collection', collection)
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const records = (data ?? []).map((row) => ({
    id: row.id,
    ...(row.record as Record<string, unknown>),
    created_at: row.created_at,
    updated_at: row.updated_at,
  }))

  return NextResponse.json({ records })
}

export async function POST(req: Request, { params }: Params) {
  const { projectId, collection } = await params

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const db = createServiceClient()

  const { data: project } = await db
    .from('projects').select('id').eq('id', projectId).single()
  if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

  const { data: row, error } = await db
    .from('project_data')
    .insert({ project_id: projectId, collection, record: body })
    .select('id, record, created_at, updated_at')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    record: { id: row.id, ...(row.record as Record<string, unknown>), created_at: row.created_at, updated_at: row.updated_at },
  }, { status: 201 })
}
