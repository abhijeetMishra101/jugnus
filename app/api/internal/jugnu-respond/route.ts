import { NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { createServiceClient } from '@/lib/supabase/server'
import { runPipeline } from '@/lib/jugnus/pipeline'
import type { JugnuKey } from '@/lib/jugnus/registry'

export const maxDuration = 800

/**
 * POST /api/internal/jugnu-respond
 * Responds 202 immediately, then runs the jugnu pipeline via waitUntil.
 *
 * Responding immediately is critical: the caller (pipeline.ts) now awaits this
 * fetch to confirm delivery before its own function exits. If we awaited the
 * full pipeline here before responding, the caller would time out waiting.
 */
export async function POST(request: Request) {
  const secret = process.env.INTERNAL_API_SECRET ?? ''
  const auth = request.headers.get('authorization') ?? ''
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { projectId, taskId, jugnuKey, nudge } = await request.json() as {
    projectId: string
    taskId: string | null
    jugnuKey: JugnuKey
    nudge?: string
  }

  if (!projectId || !jugnuKey) {
    return NextResponse.json({ error: 'projectId and jugnuKey required' }, { status: 400 })
  }

  const db = createServiceClient()

  // If the project has ai_skip_quiz:true, always prepend the skip instruction —
  // even on retries that carry their own nudge, so the flag is never overridden.
  let effectiveNudge = nudge
  if (jugnuKey === 'maya') {
    const { data: projData } = await db.from('projects').select('constraints').eq('id', projectId).single()
    const constraints = ((projData?.constraints ?? {}) as Record<string, unknown>)
    if (constraints.ai_skip_quiz === true) {
      const skipInstruction = 'CRITICAL INSTRUCTION: ai_skip_quiz is true — the founder already chose "Let AI answer all remaining questions". Do NOT call ask_founder again under any circumstances. Infer reasonable answers for every uncovered category as source:"inferred". Do NOT output any announcement. Call create_task_plan immediately.'
      effectiveNudge = effectiveNudge ? `${skipInstruction}\n\n${effectiveNudge}` : skipInstruction
    }
  }

  // Kick off the pipeline async — function stays alive via waitUntil
  waitUntil(
    runPipeline(projectId, taskId, jugnuKey, db, effectiveNudge).catch((err) => {
      console.error('[jugnu-respond] pipeline error:', err)
    })
  )

  // Respond 202 immediately so the caller confirms delivery in < 1s
  return NextResponse.json({ ok: true, queued: jugnuKey }, { status: 202 })
}
