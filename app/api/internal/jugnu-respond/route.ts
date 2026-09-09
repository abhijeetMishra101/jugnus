import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { runPipeline } from '@/lib/jugnus/pipeline'
import type { JugnuKey } from '@/lib/jugnus/registry'

export const maxDuration = 800

/**
 * POST /api/internal/jugnu-respond
 * Runs one jugnu synchronously up to maxDuration.
 * Each jugnu is its own 800s Vercel invocation — no waitUntil needed.
 * The caller fires and forgets (no await on the fetch); each hop gets
 * its own independent budget.
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

  // Run synchronously — this function stays alive for the full jugnu execution.
  // The CALLER fires this request and forgets (no await on its side).
  await runPipeline(projectId, taskId, jugnuKey, db).catch((err) => {
    console.error('[jugnu-respond] pipeline error:', err)
  })

  return NextResponse.json({ ok: true })
}
