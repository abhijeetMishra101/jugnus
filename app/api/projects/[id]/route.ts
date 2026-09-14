import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const db = createServiceClient()

  // Look up workspace before deleting so we can reset jugnu statuses
  const { data: project } = await db.from('projects').select('workspace_id').eq('id', id).single()

  // Delete cascade: tasks, messages, file_snapshots, then project
  await Promise.all([
    db.from('file_snapshots').delete().eq('project_id', id),
    db.from('tasks').delete().eq('project_id', id),
    db.from('messages').delete().eq('project_id', id),
  ])
  const { error } = await db.from('projects').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Reset all jugnus to idle — any in-flight dispatch for this project will
  // complete or time out on its own, but the UI should show idle immediately
  if (project?.workspace_id) {
    await db.from('jugnus').update({ status: 'idle' }).eq('workspace_id', project.workspace_id)
  }

  return NextResponse.json({ ok: true })
}
