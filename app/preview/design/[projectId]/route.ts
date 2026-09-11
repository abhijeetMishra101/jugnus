import { createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

/**
 * GET /preview/design/[projectId]
 * Serves Nia's design artifact from the design/ path prefix.
 * Prefers design/assembled.html (the incremental-generation final file),
 * falls back to design/mockup.html (legacy), then any design/*.html file.
 * This is separate from /preview/[projectId] which serves Leo's built output.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params
  const db = createServiceClient()

  const { data: files } = await db
    .from('file_snapshots')
    .select('path, content')
    .eq('project_id', projectId)
    .ilike('path', 'design/%.html')
    .order('updated_at', { ascending: false })

  const file =
    files?.find((f) => f.path === 'design/assembled.html') ??
    files?.find((f) => f.path === 'design/mockup.html') ??
    files?.[0] ??
    null

  if (!file) {
    return new NextResponse('No design preview available yet.', {
      status: 404,
      headers: { 'Content-Type': 'text/plain' },
    })
  }

  return new NextResponse(file.content, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}
