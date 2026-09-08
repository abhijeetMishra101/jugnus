import { createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

const MIME: Record<string, string> = {
  css:  'text/css; charset=utf-8',
  js:   'text/javascript; charset=utf-8',
  json: 'application/json',
  svg:  'image/svg+xml',
  png:  'image/png',
  jpg:  'image/jpeg',
  ico:  'image/x-icon',
  txt:  'text/plain; charset=utf-8',
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string; path: string[] }> },
) {
  const { projectId, path } = await params
  const filePath = path.join('/')
  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''

  const db = createServiceClient()
  const { data: file } = await db
    .from('file_snapshots')
    .select('content')
    .eq('project_id', projectId)
    .eq('path', filePath)
    .single()

  if (!file) {
    return new NextResponse('Not found', { status: 404 })
  }

  return new NextResponse(file.content, {
    headers: {
      'Content-Type': MIME[ext] ?? 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
    },
  })
}
