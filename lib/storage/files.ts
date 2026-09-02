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
  const { error } = await db.from('file_snapshots').upsert({
    project_id: projectId,
    task_id: taskId,
    path,
    content,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'project_id,path' })

  if (error) throw new Error(error.message)
  return { ok: true }
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
