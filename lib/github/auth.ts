import { Octokit } from '@octokit/rest'
import { createAppAuth } from '@octokit/auth-app'
import type { SupabaseClient } from '@supabase/supabase-js'

export async function getInstallationOctokit(installationId: string): Promise<Octokit> {
  const appOctokit = new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: process.env.GITHUB_APP_ID!,
      privateKey: process.env.GITHUB_APP_PRIVATE_KEY!.replace(/\\n/g, '\n'),
      installationId: Number(installationId),
    },
  })
  return appOctokit
}

export async function getInstallationForProject(
  projectId: string,
  db: SupabaseClient
): Promise<{ installation_id: string; repo_full_name: string } | null> {
  const { data: project } = await db
    .from('projects')
    .select('workspace_id')
    .eq('id', projectId)
    .single()

  if (!project) return null

  const { data } = await db
    .from('github_installations')
    .select('installation_id, repo_full_name')
    .eq('workspace_id', project.workspace_id)
    .limit(1)
    .single()

  return data ?? null
}
