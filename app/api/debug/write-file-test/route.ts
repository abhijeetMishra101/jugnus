import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { writeFile } from '@/lib/storage/files'

export const maxDuration = 30

export async function POST(request: Request): Promise<Response> {
  const secret = request.headers.get('authorization')
  if (secret !== `Bearer ${process.env.INTERNAL_API_SECRET ?? ''}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { projectId, taskId, path, content } = await request.json() as {
    projectId: string; taskId: string | null; path: string; content: string
  }

  const db = createServiceClient()

  // Check before
  const { data: before } = await db.from('file_snapshots')
    .select('path').eq('project_id', projectId).eq('path', path).maybeSingle()

  let writeResult: { ok: boolean } | null = null
  let writeError: string | null = null
  try {
    writeResult = await writeFile(projectId, taskId, path, content, db)
  } catch (err) {
    writeError = err instanceof Error ? err.message : String(err)
  }

  // Check after
  const { data: after } = await db.from('file_snapshots')
    .select('path, updated_at').eq('project_id', projectId).eq('path', path).maybeSingle()

  return NextResponse.json({ before, writeResult, writeError, after })
}
