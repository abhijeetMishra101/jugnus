import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { advanceProject } from '@/lib/orchestration/executor'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: projectId } = await params
  const { verdict, feedback } = await request.json() as {
    verdict: 'approved' | 'changes'
    feedback?: string
  }

  const db = createServiceClient()

  // Find the pending human approval task
  const { data: humanTask } = await db
    .from('tasks')
    .select('id')
    .eq('project_id', projectId)
    .eq('jugnu_key', 'human')
    .eq('status', 'in_progress')
    .single()

  if (!humanTask) {
    return NextResponse.json({ error: 'No pending approval task found' }, { status: 404 })
  }

  if (verdict === 'approved') {
    await db.from('tasks').update({
      status: 'completed',
      result: 'Founder approved',
      completed_at: new Date().toISOString(),
    }).eq('id', humanTask.id)

    // Record approval metrics in project constraints
    const { data: niaTasks } = await db
      .from('tasks')
      .select('id, status')
      .eq('project_id', projectId)
      .eq('jugnu_key', 'nia')

    const { data: projForMetrics } = await db
      .from('projects')
      .select('constraints')
      .eq('id', projectId)
      .single()

    const existingConstraints = (projForMetrics?.constraints ?? {}) as Record<string, unknown>
    const approvalMetrics = {
      nia_revision_count: ((niaTasks ?? []).filter((t) => t.status === 'completed').length) - 1,
      approved_immediately: !feedback || feedback === '',
      approved_at: new Date().toISOString(),
    }
    await db.from('projects').update({
      constraints: { ...existingConstraints, approval_metrics: approvalMetrics },
    }).eq('id', projectId)

    await db.from('messages').insert({
      project_id: projectId,
      author_type: 'system',
      author_key: 'system',
      content: '✅ Direction approved. The team is now building.',
      metadata: { event_type: 'PROTOTYPE_APPROVED' },
    })

    // Advance pipeline — picks up Leo's task next
    const { dispatched, jugnuKey, taskId } = await advanceProject(projectId, db)

    if (dispatched && jugnuKey) {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '')
      void fetch(`${appUrl}/api/internal/jugnu-respond`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.INTERNAL_API_SECRET ?? ''}`,
        },
        body: JSON.stringify({ projectId, taskId, jugnuKey }),
      }).catch((e) => console.error('[approve] handoff failed:', e))
    }

    return NextResponse.json({ ok: true, verdict: 'approved' })
  }

  // Nia revision loop guard — count completed Nia tasks to cap revision cycles
  const { count: niaDoneCount } = await db
    .from('tasks')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', projectId)
    .eq('jugnu_key', 'nia')
    .eq('status', 'completed')

  if ((niaDoneCount ?? 0) >= 3) {
    await db.from('messages').insert({
      project_id: projectId,
      author_type: 'system',
      author_key: 'system',
      content: 'Maximum revision cycles reached. Consider approving the current version or starting a new project.',
      metadata: { event_type: 'REVISION_LIMIT_REACHED', nia_done_count: niaDoneCount },
    })
    return NextResponse.json({ ok: false, reason: 'revision_limit_reached' }, { status: 409 })
  }

  // Feedback — insert a Nia revision task before the human approval task
  await db.from('tasks').update({
    status: 'pending',
    started_at: null,
  }).eq('id', humanTask.id)

  await db.from('tasks').insert({
    project_id: projectId,
    title: 'Revise alignment artifact based on founder feedback',
    description: `The founder reviewed your alignment artifact and requested changes:\n\n${feedback}\n\nUpdate your artifact using write_file to reflect this feedback, then call complete_task.`,
    capability: 'design',
    jugnu_key: 'nia',
    depends_on: [],
    sort_order: -1,
    status: 'pending',
  })

  await db.from('messages').insert({
    project_id: projectId,
    author_type: 'system',
    author_key: 'system',
    content: `🔄 Feedback sent to Nia: "${feedback}"`,
    metadata: { event_type: 'PROTOTYPE_REVISED', feedback },
  })

  const { dispatched, jugnuKey, taskId } = await advanceProject(projectId, db)
  if (dispatched && jugnuKey) {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '')
    void fetch(`${appUrl}/api/internal/jugnu-respond`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.INTERNAL_API_SECRET ?? ''}`,
      },
      body: JSON.stringify({ projectId, taskId, jugnuKey }),
    }).catch((e) => console.error('[approve] revision handoff failed:', e))
  }

  return NextResponse.json({ ok: true, verdict: 'changes_requested' })
}
