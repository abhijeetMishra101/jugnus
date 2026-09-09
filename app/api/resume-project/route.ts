import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { advanceProject } from '@/lib/orchestration/executor'

/**
 * POST /api/resume-project
 * Kicks advanceProject for a project that has a pending task but nothing in_progress.
 * Auth: Supabase service role key as Bearer token.
 */
export async function POST(request: Request) {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
  const auth = request.headers.get('authorization') ?? ''
  if (!serviceKey || auth !== `Bearer ${serviceKey}`) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { projectId } = await request.json() as { projectId: string }
  if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 })

  const db = createServiceClient()
  const { dispatched, jugnuKey, taskId } = await advanceProject(projectId, db)

  if (!dispatched || !jugnuKey) {
    return NextResponse.json({ dispatched: false, reason: 'nothing to advance' })
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
  void fetch(`${appUrl}/api/internal/jugnu-respond`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.INTERNAL_API_SECRET ?? ''}`,
    },
    body: JSON.stringify({ projectId, taskId, jugnuKey }),
  }).catch(console.error)

  return NextResponse.json({ dispatched: true, jugnuKey, taskId })
}
