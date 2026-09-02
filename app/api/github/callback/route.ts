import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { createAppAuth } from '@octokit/auth-app'
import { Octokit } from '@octokit/rest'

/**
 * GitHub App OAuth callback.
 * GitHub redirects here after the founder installs the app.
 * Query params: installation_id, setup_action, state (= workspace slug)
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const installationId = searchParams.get('installation_id')
  const slug = searchParams.get('state')

  if (!installationId || !slug) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  const db = createServiceClient()

  const { data: workspace } = await db
    .from('workspaces')
    .select('id')
    .eq('slug', slug)
    .single()

  if (!workspace) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // Fetch the installation's accessible repos via GitHub API
  const auth = createAppAuth({
    appId: process.env.GITHUB_APP_ID!,
    privateKey: process.env.GITHUB_PRIVATE_KEY!,
    installationId: Number(installationId),
  })

  const octokit = new Octokit({ authStrategy: createAppAuth, auth: {
    appId: process.env.GITHUB_APP_ID!,
    privateKey: process.env.GITHUB_PRIVATE_KEY!,
    installationId: Number(installationId),
  }})

  const { data: repos } = await octokit.apps.listReposAccessibleToInstallation({ per_page: 1 })
  const repoFullName = repos.repositories[0]?.full_name ?? ''

  await db.from('github_installations').upsert({
    workspace_id: workspace.id,
    installation_id: String(installationId),
    repo_full_name: repoFullName,
    installed_at: new Date().toISOString(),
  }, { onConflict: 'workspace_id' })

  return NextResponse.redirect(new URL(`/w/${slug}/settings`, request.url))
}
