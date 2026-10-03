import type { SupabaseClient } from '@supabase/supabase-js'

export interface FileSnapshot {
  path: string
  content: string
  updated_at: string
}

export async function writeFile(
  projectId: string,
  taskId: string | null,
  path: string,
  content: string,
  db: SupabaseClient
): Promise<{ ok: boolean }> {
  const now = new Date().toISOString()
  const row = { project_id: projectId, task_id: taskId, path, content, updated_at: now }

  // Strategy 1: upsert
  const { error: upsertErr, status: upsertStatus } = await (db.from('file_snapshots').upsert(row, { onConflict: 'project_id,path' }) as unknown as Promise<{ error: { message: string } | null; status: number }>)

  // Verify the row actually landed (upsert silently no-ops in some PostgREST configs)
  if (!upsertErr) {
    const { data: check } = await db.from('file_snapshots').select('path').eq('project_id', projectId).eq('path', path).maybeSingle()
    if (check) return { ok: true }
  }

  // Strategy 2: plain INSERT (handles case where upsert silently did nothing)
  const { error: insertErr } = await db.from('file_snapshots').insert(row)
  if (!insertErr) return { ok: true }

  // Strategy 3: UPDATE in case the row exists but upsert/insert both failed
  const { error: updateErr, count } = await db.from('file_snapshots')
    .update({ content, updated_at: now, task_id: taskId })
    .eq('project_id', projectId)
    .eq('path', path)
    .select('path')
  if (!updateErr && count && count > 0) return { ok: true }

  // All strategies failed — throw with full debug info
  const detail = [
    `upsert: ${upsertErr?.message ?? `status ${upsertStatus} no-op`}`,
    `insert: ${insertErr?.message ?? 'no error but failed'}`,
    `update: ${updateErr?.message ?? `matched ${count ?? 0} rows`}`,
  ].join(' | ')
  throw new Error(`write_file failed for ${path} — ${detail}`)
}

export async function readFile(
  projectId: string,
  path: string,
  db: SupabaseClient
): Promise<{ path: string; content: string } | { error: string }> {
  const { data, error } = await db
    .from('file_snapshots')
    .select('path, content')
    .eq('project_id', projectId)
    .eq('path', path)
    .single()

  if (error || !data) return { error: `File not found: ${path}` }
  return { path: data.path, content: data.content }
}

export async function listFiles(
  projectId: string,
  db: SupabaseClient
): Promise<{ files: Array<{ path: string; updated_at: string }> }> {
  const { data } = await db
    .from('file_snapshots')
    .select('path, updated_at')
    .eq('project_id', projectId)
    .order('path', { ascending: true })

  return { files: data ?? [] }
}
