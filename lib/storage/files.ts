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

  // Try upsert first; if that fails (e.g. missing unique constraint in some DB configs),
  // fall back to INSERT then UPDATE to guarantee idempotency.
  const { error: upsertErr } = await db.from('file_snapshots').upsert(row, { onConflict: 'project_id,path' })
  if (!upsertErr) return { ok: true }

  // Upsert failed — try plain INSERT
  const { error: insertErr } = await db.from('file_snapshots').insert(row)
  if (!insertErr) return { ok: true }

  // INSERT failed (likely duplicate) — try UPDATE instead
  const { error: updateErr } = await db.from('file_snapshots')
    .update({ content, updated_at: now, task_id: taskId })
    .eq('project_id', projectId)
    .eq('path', path)
  if (!updateErr) return { ok: true }

  // All three strategies failed — surface the original upsert error for debugging
  throw new Error(`write_file failed [upsert: ${upsertErr.message}] [insert: ${insertErr.message}] [update: ${updateErr.message}]`)
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
