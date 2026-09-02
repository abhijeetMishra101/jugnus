import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

/**
 * GET /api/workspaces?ownerId=<id>
 * Returns the first workspace for a user (used by login redirect).
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const ownerId = searchParams.get('ownerId')
  if (!ownerId) return NextResponse.json({ error: 'ownerId required' }, { status: 400 })

  const db = createServiceClient()
  const { data } = await db.from('workspaces').select('slug').eq('owner_id', ownerId).limit(1).single()
  return NextResponse.json({ slug: data?.slug ?? null })
}

/**
 * POST /api/workspaces
 * Creates a workspace for a new user (called after signup).
 */
export async function POST(request: Request) {
  const { name, ownerId } = await request.json() as { name: string; ownerId: string }

  if (!name?.trim() || !ownerId) {
    return NextResponse.json({ error: 'name and ownerId required' }, { status: 400 })
  }

  const db = createServiceClient()

  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') +
    '-' + Math.random().toString(36).slice(2, 6)

  const { data: workspace, error } = await db
    .from('workspaces')
    .insert({ name: name.trim(), slug, owner_id: ownerId })
    .select('id, slug')
    .single()

  if (error || !workspace) {
    return NextResponse.json({ error: 'Failed to create workspace' }, { status: 500 })
  }

  return NextResponse.json({ id: workspace.id, slug: workspace.slug }, { status: 201 })
}
