import { createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params
  const db = createServiceClient()

  // Fetch HTML files for this project, skipping Nia's design mockups
  const { data: files } = await db
    .from('file_snapshots')
    .select('path, content')
    .eq('project_id', projectId)
    .ilike('path', '%.html')
    .not('path', 'ilike', 'design/%')
    .order('path', { ascending: true })

  const file = files?.find((f) => f.path === 'index.html') ?? files?.[0] ?? null

  if (!file) {
    return new NextResponse('No preview available for this project.', {
      status: 404,
      headers: { 'Content-Type': 'text/plain' },
    })
  }

  return new NextResponse(file.content, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300, stale-while-revalidate=60',
    },
  })
}
