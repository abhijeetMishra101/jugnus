import { NextResponse } from 'next/server'
import { Client } from 'pg'

const BLOCKED_PATTERNS = [
  /drop\s+database/i,
  /drop\s+role/i,
  /create\s+role/i,
  /alter\s+role/i,
  /\bcopy\b/i,
  /pg_catalog/i,
  /supabase_admin/i,
  /auth\.\w/i,
  /storage\.\w/i,
  /_realtime\.\w/i,
  /information_schema/i,
]

/**
 * POST /api/internal/run-sql
 * Executes DDL or DML on the shared Jugnus Postgres instance.
 * Leo uses this to create project-scoped tables (p_{shortId}_tablename).
 *
 * Auth: Bearer INTERNAL_API_SECRET
 * Body: { sql: string; projectId: string }
 * Returns: { ok: true; rows: unknown[] } | { ok: false; error: string }
 */
export async function POST(request: Request) {
  const secret = process.env.INTERNAL_API_SECRET ?? ''
  const auth = request.headers.get('authorization') ?? ''
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json() as { sql?: string; projectId?: string }
  const { sql, projectId } = body

  if (!sql?.trim() || !projectId) {
    return NextResponse.json({ ok: false, error: 'sql and projectId required' }, { status: 400 })
  }

  // Safety check — block operations that could affect shared infrastructure
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(sql)) {
      return NextResponse.json({ ok: false, error: `SQL blocked: matches restricted pattern (${pattern.source})` }, { status: 400 })
    }
  }

  const dbUrl = process.env.SUPABASE_DB_URL
  if (!dbUrl) {
    return NextResponse.json({ ok: false, error: 'SUPABASE_DB_URL not configured' }, { status: 500 })
  }

  const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } })

  try {
    await client.connect()
    const result = await client.query(sql)
    return NextResponse.json({ ok: true, rows: result.rows ?? [], rowCount: result.rowCount })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ ok: false, error: msg }, { status: 422 })
  } finally {
    await client.end().catch(() => {})
  }
}
