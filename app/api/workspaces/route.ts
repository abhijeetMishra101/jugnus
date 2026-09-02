import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'

/**
 * GET /api/workspaces?ownerId=<id>   — returns { slug } for the owner's first workspace
 * GET /api/workspaces?slug=<slug>    — returns { id, name } for a workspace by slug
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const ownerId = searchParams.get('ownerId')
  const slug = searchParams.get('slug')
  const db = createServiceClient()

  if (slug) {
    const { data } = await db.from('workspaces').select('id, name').eq('slug', slug).single()
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ id: data.id, name: data.name })
  }

  if (!ownerId) return NextResponse.json({ error: 'ownerId or slug required' }, { status: 400 })
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
