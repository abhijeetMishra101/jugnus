import { NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { createServiceClient } from '@/lib/supabase/server'
import { runPipeline } from '@/lib/jugnus/pipeline'
import type { JugnuKey } from '@/lib/jugnus/registry'

export const maxDuration = 300

/**
 * POST /api/internal/jugnu-respond
 * Starts or resumes the pipeline for a project from a given jugnu.
 * Used by the watchdog cron to unstick timed-out tasks.
 * Guarded by INTERNAL_API_SECRET.
 */
export async function POST(request: Request) {
  const secret = process.env.INTERNAL_API_SECRET ?? ''
  const auth = request.headers.get('authorization') ?? ''
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { projectId, taskId, jugnuKey } = await request.json() as {
    projectId: string
    taskId: string | null
    jugnuKey: JugnuKey
  }

  if (!projectId || !jugnuKey) {
    return NextResponse.json({ error: 'projectId and jugnuKey required' }, { status: 400 })
  }

  const db = createServiceClient()

  waitUntil(
    runPipeline(projectId, taskId, jugnuKey, db).catch((err) => {
      console.error('[jugnu-respond] pipeline error:', err)
    })
  )

  return NextResponse.json({ ok: true })
}
