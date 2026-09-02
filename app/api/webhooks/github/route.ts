import { NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { createServiceClient } from '@/lib/supabase/server'
import { verifyWebhookSignature } from '@/lib/github/operations'
import { advanceProject } from '@/lib/orchestration/executor'

export async function POST(request: Request) {
  const rawBody = Buffer.from(await request.arrayBuffer())
  const signature = request.headers.get('x-hub-signature-256')

  if (!await verifyWebhookSignature(rawBody, signature)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  const eventType = request.headers.get('x-github-event') ?? ''
  const payload = JSON.parse(rawBody.toString('utf-8')) as Record<string, unknown>
  const installationId = String((payload.installation as Record<string, unknown>)?.id ?? '')

  waitUntil(handleEvent(eventType, payload, installationId))

  return NextResponse.json({ ok: true })
}

async function handleEvent(
  eventType: string,
  payload: Record<string, unknown>,
  installationId: string
): Promise<void> {
  const db = createServiceClient()

  const { data: installations } = await db
    .from('github_installations')
    .select('workspace_id, repo_full_name')
    .eq('installation_id', installationId)

  if (!installations?.length) return

  const action = String(payload.action ?? '')

  for (const { workspace_id: workspaceId } of installations) {
    // PR opened on a jugnu/build-* branch → find the project and trigger Tara
    if (eventType === 'pull_request' && action === 'opened') {
      const pr = payload.pull_request as Record<string, unknown>
      const branch = String((pr.head as Record<string, unknown>)?.ref ?? '')
      if (!branch.startsWith('jugnu/build-')) continue

      const projectId = branch.replace('jugnu/build-', '')

      // Mark the in-progress build task as completed (Leo opened the PR)
      const { data: buildTask } = await db
        .from('tasks')
        .select('id')
        .eq('project_id', projectId)
        .eq('capability', 'build')
        .eq('status', 'in_progress')
        .limit(1)
        .single()

      if (buildTask) {
        await db.from('tasks').update({
          status: 'completed',
          result: `PR #${pr.number} opened: ${pr.html_url}`,
          artifact: { type: 'github_pr', url: pr.html_url, number: pr.number },
          completed_at: new Date().toISOString(),
        }).eq('id', buildTask.id)
      }

      // Advance to the next task (Tara's review)
      const { dispatched, jugnuKey, taskId } = await advanceProject(projectId, db)
      if (dispatched && jugnuKey) {
        await fetch(new URL('/api/internal/jugnu-respond', process.env.NEXT_PUBLIC_APP_URL!).toString(), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${process.env.INTERNAL_API_SECRET}`,
          },
          body: JSON.stringify({ projectId, taskId, jugnuKey }),
        })
      }
    }
  }
}
