import Link from 'next/link'
import { createServiceClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'

interface Props {
  children: React.ReactNode
  params: Promise<{ slug: string }>
}

const STATUS_DOT: Record<string, string> = {
  planning:  'bg-yellow-400',
  building:  'bg-indigo-400 animate-pulse',
  reviewing: 'bg-amber-400 animate-pulse',
  completed: 'bg-emerald-400',
  blocked:   'bg-red-400',
  active:    'bg-indigo-400',
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

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: '#0f0f1a' }}>
      {/* Dark sidebar */}
      <aside className="w-56 flex-shrink-0 flex flex-col" style={{ background: '#16162a' }}>
        {/* Workspace header */}
        <div className="px-4 py-4 border-b border-white/10">
          <Link href={`/w/${slug}`} className="flex items-center gap-2.5 group">
            <span className="text-indigo-400 font-bold text-lg">✦</span>
            <span className="text-sm font-bold text-white group-hover:text-indigo-300 truncate">
              {workspace.name}
            </span>
          </Link>
        </div>

        {/* Projects */}
        <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-0.5">
          <div className="flex items-center justify-between px-2 mb-2">
            <p className="text-xs font-semibold text-white/40 uppercase tracking-wider">Projects</p>
            <Link
              href={`/w/${slug}/new`}
              className="text-white/40 hover:text-indigo-400 transition-colors"
              title="New project"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </Link>
          </div>

          {projects?.map((p) => (
            <Link
              key={p.id}
              href={`/w/${slug}/p/${p.id}`}
              className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm text-white/70 hover:bg-white/10 hover:text-white transition-colors group"
            >
              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${STATUS_DOT[p.status] ?? 'bg-white/20'}`} />
              <span className="truncate">{p.title}</span>
            </Link>
          ))}

          {!projects?.length && (
            <p className="px-2 py-2 text-xs text-white/30 italic">No projects yet</p>
          )}
        </nav>

        {/* Footer */}
        <div className="px-2 py-3 border-t border-white/10 space-y-0.5">
          <Link
            href={`/w/${slug}/settings`}
            className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm text-white/50 hover:bg-white/10 hover:text-white transition-colors"
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
      <main className="flex-1 overflow-hidden bg-white rounded-tl-2xl">
        {children}
      </main>
    </div>
  )
}
