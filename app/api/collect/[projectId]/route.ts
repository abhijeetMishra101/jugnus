import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const formType = typeof body.form === 'string' ? body.form : 'generic'
  const data = { ...body }
  delete data.form

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'No data provided' }, { status: 400 })
  }

  const db = createServiceClient()

  const { data: project } = await db
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .single()

  if (!project) {
    return NextResponse.json({ error: 'Project not found' }, { status: 404 })
  }

  const { error } = await db.from('form_submissions').insert({
    project_id: projectId,
    form_type: formType,
    data,
  })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
