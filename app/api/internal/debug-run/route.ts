import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { dispatchJugnu } from '@/lib/jugnus/dispatch'
import type { JugnuKey } from '@/lib/jugnus/registry'

export const maxDuration = 300

// Temporary debug endpoint — runs a single jugnu synchronously and returns the result.
// Remove after pipeline is confirmed working.
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

  const db = createServiceClient()

  try {
    const result = await dispatchJugnu({ projectId, taskId, jugnuKey, db })
    return NextResponse.json({ ok: true, result })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, error: msg }, { status: 500 })
  }
}
