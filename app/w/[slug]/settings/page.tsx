import { createServiceClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import GithubConnectButton from './GithubConnectButton'

interface Props {
  params: Promise<{ slug: string }>
}

export default async function SettingsPage({ params }: Props) {
  const { slug } = await params
  const db = createServiceClient()

  const { data: workspace } = await db
    .from('workspaces')
    .select('id, name')
    .eq('slug', slug)
    .single()

  if (!workspace) notFound()

  const { data: installation } = await db
    .from('github_installations')
    .select('repo_full_name, installed_at')
    .eq('workspace_id', workspace.id)
    .maybeSingle()

  const appName = process.env.GITHUB_APP_NAME ?? 'jugnus-app'
  const installUrl = `https://github.com/apps/${appName}/installations/new`

  return (
    <div className="max-w-2xl mx-auto py-12 px-6 space-y-10">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Workspace Settings</h1>
        <p className="text-sm text-gray-500 mt-1">{workspace.name}</p>
      </div>

      {/* GitHub Integration */}
      <section className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4">
        <div className="flex items-center gap-3">
          <svg className="w-5 h-5 text-gray-700" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
          </svg>
          <h2 className="text-base font-semibold text-gray-800">GitHub</h2>
        </div>

        {installation ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 rounded-lg px-3 py-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              Connected to <strong>{installation.repo_full_name}</strong>
            </div>
            <p className="text-xs text-gray-400">
              Jugnus will commit files and open PRs on this repo. To change the repo, reinstall the GitHub App.
            </p>
            <GithubConnectButton installUrl={installUrl} label="Change repository" variant="secondary" />
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-gray-600">
              Connect a GitHub repository so your jugnus can commit code and open pull requests.
            </p>
            <GithubConnectButton installUrl={`${installUrl}?state=${slug}`} label="Connect GitHub" variant="primary" />
          </div>
        )}
      </section>
    </div>
  )
}
