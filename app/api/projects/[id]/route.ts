import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const db = createServiceClient()

  // Delete cascade: tasks, messages, file_snapshots, then project
  await db.from('file_snapshots').delete().eq('project_id', id)
  await db.from('tasks').delete().eq('project_id', id)
  await db.from('messages').delete().eq('project_id', id)
  const { error } = await db.from('projects').delete().eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
