import { createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId: param } = await params
  const db = createServiceClient()

  // Resolve param → real project UUID.
  // Accepts either a UUID directly or a human-readable slug (e.g. "boldo").
  // Slug is stored in projects.preview_slug (after migration) or
  // projects.constraints->>'preview_slug' (available immediately, no migration needed).
  let resolvedId = param

  if (!UUID_RE.test(param)) {
    // Try preview_slug column first (post-migration)
    const { data: byCol } = await db
      .from('projects')
      .select('id')
      .eq('preview_slug', param)
      .maybeSingle()

    if (byCol) {
      resolvedId = byCol.id as string
    } else {
      // Fall back to constraints JSON (pre-migration, works right now)
      const { data: rows } = await db
        .from('projects')
        .select('id, constraints')

      const match = (rows ?? []).find(
        (r) => (r.constraints as Record<string, unknown>)?.preview_slug === param
      )
      if (!match) {
        return new NextResponse('Project not found.', {
          status: 404,
          headers: { 'Content-Type': 'text/plain' },
        })
      }
      resolvedId = match.id as string
    }
  }

  const { data: files } = await db
    .from('file_snapshots')
    .select('path, content')
    .eq('project_id', resolvedId)
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

  return new NextResponse(file.content as string, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300, stale-while-revalidate=60',
    },
  })
}
