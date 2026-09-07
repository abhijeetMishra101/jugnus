import { createServiceClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  const { projectId, workspaceId, userId, score } = await req.json() as {
    projectId?: string
    workspaceId?: string
    userId?: string
    score?: unknown
  }

  if (!userId || typeof score !== 'number' || score < 0) {
    return NextResponse.json({ error: 'invalid' }, { status: 400 })
  }

  const db = createServiceClient()
  const { error } = await db.from('game_scores').insert({
    user_id: userId,
    workspace_id: workspaceId ?? null,
    project_id: projectId ?? null,
    score,
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const period = url.searchParams.get('period') ?? 'today'
  const db = createServiceClient()

  let since: string
  if (period === 'today') {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    since = d.toISOString()
  } else if (period === 'week') {
    const d = new Date()
    d.setDate(d.getDate() - 7)
    since = d.toISOString()
  } else {
    since = new Date(0).toISOString()
  }

  const { data } = await db
    .from('game_scores')
    .select('user_id, score, created_at')
    .gte('created_at', since)
    .order('score', { ascending: false })
    .limit(10)

  return NextResponse.json({ scores: data ?? [] })
}
