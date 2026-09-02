import Link from 'next/link'
import { createServiceClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'

interface Props {
  children: React.ReactNode
  params: Promise<{ slug: string }>
}

export default async function WorkspaceLayout({ children, params }: Props) {
  const { slug } = await params
  const db = createServiceClient()

  const { data: workspace } = await db
    .from('workspaces')
    .select('id, name, slug')
    .eq('slug', slug)
    .single()

  if (!workspace) notFound()

  const { data: projects } = await db
    .from('projects')
    .select('id, title, status')
    .eq('workspace_id', workspace.id)
    .order('created_at', { ascending: false })

  const statusDot: Record<string, string> = {
    planning: 'bg-yellow-400',
    building: 'bg-indigo-400 animate-pulse',
    reviewing: 'bg-yellow-400 animate-pulse',
    completed: 'bg-emerald-400',
    blocked: 'bg-red-400',
    cancelled: 'bg-gray-300',
    active: 'bg-indigo-400',
  }

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      {/* Sidebar */}
      <aside className="w-56 flex-shrink-0 bg-white border-r border-gray-200 flex flex-col">
        {/* Workspace header */}
        <div className="px-4 py-3 border-b border-gray-200">
          <Link href={`/w/${slug}`} className="flex items-center gap-2 group">
            <span className="text-indigo-600 font-bold text-base">✦</span>
            <span className="text-sm font-semibold text-gray-800 group-hover:text-indigo-600 truncate">
              {workspace.name}
            </span>
          </Link>
        </div>

        {/* Projects list */}
        <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-0.5">
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wider px-2 mb-1">Projects</p>
          {projects?.map((project) => (
            <Link
              key={project.id}
              href={`/w/${slug}/p/${project.id}`}
              className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm text-gray-700 hover:bg-gray-100 hover:text-gray-900 transition-colors group"
            >
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${statusDot[project.status] ?? 'bg-gray-300'}`} />
              <span className="truncate">{project.title}</span>
            </Link>
          ))}
          {!projects?.length && (
            <p className="px-2 py-1.5 text-xs text-gray-400 italic">No projects yet</p>
          )}
        </nav>

        {/* Footer links */}
        <div className="px-2 py-3 border-t border-gray-200 space-y-0.5">
          <Link
            href={`/w/${slug}/settings`}
            className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Settings
          </Link>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-hidden">
        {children}
      </main>
    </div>
  )
}
