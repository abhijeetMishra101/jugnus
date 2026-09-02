import { NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'

export const maxDuration = 300
import { createServiceClient } from '@/lib/supabase/server'
import { dispatchJugnu } from '@/lib/jugnus/dispatch'
import { advanceProject } from '@/lib/orchestration/executor'
import type { JugnuKey } from '@/lib/jugnus/registry'

/**
 * POST /api/internal/jugnu-respond
 * Dispatches a specific jugnu for a project+task, then advances to the next task.
 * Guarded by INTERNAL_API_SECRET — never callable from the browser.
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

  waitUntil((async () => {
    try {
      // Run the jugnu turn
      await dispatchJugnu({ projectId, taskId, jugnuKey, db })

      // After jugnu completes, advance to the next ready task
      const { dispatched, jugnuKey: nextKey, taskId: nextTaskId } = await advanceProject(projectId, db)

      if (dispatched && nextKey) {
        // Fire next jugnu via internal API (self-call)
        await fetch(new URL('/api/internal/jugnu-respond', process.env.NEXT_PUBLIC_APP_URL!).toString(), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${secret}`,
          },
          body: JSON.stringify({ projectId, taskId: nextTaskId, jugnuKey: nextKey }),
        })
      }
    } catch (err) {
      console.error('[jugnu-respond] error:', err)
    }
  })())

  return NextResponse.json({ ok: true })
}
