import Link from 'next/link'
import { createServiceClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'

interface Props {
  children: React.ReactNode
  params: Promise<{ slug: string }>
}

const NAV = [
  { icon: '⌂', label: 'Home' },
  { icon: '⊟', label: 'Threads' },
  { icon: '@', label: 'Mentions' },
  { icon: '☆', label: 'Starred' },
  { icon: '✉', label: 'Direct Messages' },
]

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
    .from('workspaces').select('id, name, slug').eq('slug', slug).single()
  if (!workspace) notFound()

  const { data: projects } = await db
    .from('projects').select('id, title, status')
    .eq('workspace_id', workspace.id)
    .order('created_at', { ascending: false })

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: '#1e1b4b' }}>
      {/* Sidebar */}
      <aside className="w-60 flex-shrink-0 flex flex-col" style={{ background: '#1e1b4b' }}>

        {/* Logo */}
        <div className="px-5 py-5 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg, #8b5cf6, #ec4899)' }}>
            <span className="text-white text-lg">✦</span>
          </div>
          <span className="text-white font-bold text-lg tracking-tight">jugnus</span>
        </div>

        {/* Nav items */}
        <div className="px-3 space-y-0.5">
          {NAV.map((item) => (
            <button key={item.label} className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-white/60 hover:bg-white/10 hover:text-white transition-colors text-left">
              <span className="text-base w-5 text-center">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </div>

        {/* Channels / Projects */}
        <div className="mt-6 px-3 flex-1 overflow-y-auto">
          <div className="flex items-center justify-between px-3 mb-1">
            <span className="text-xs font-semibold text-white/40 uppercase tracking-wider">Channels</span>
            <Link href={`/w/${slug}/new`} className="text-white/40 hover:text-white transition-colors" title="New project">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </Link>
          </div>

          <div className="space-y-0.5">
            {projects?.map((p) => (
              <Link
                key={p.id}
                href={`/w/${slug}/p/${p.id}`}
                className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-white/70 hover:bg-white/10 hover:text-white transition-colors group"
              >
                <span className="text-white/40 font-medium">#</span>
                <span className="truncate flex-1">{p.title}</span>
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${STATUS_DOT[p.status] ?? 'bg-white/20'}`} />
              </Link>
            ))}
            {!projects?.length && (
              <p className="px-3 py-2 text-xs text-white/30 italic">No projects yet</p>
            )}
          </div>
        </div>

        {/* User footer */}
        <div className="px-4 py-4 border-t border-white/10 flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-indigo-400 flex items-center justify-center text-xs font-bold text-white flex-shrink-0">
            A
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-white truncate">Abhijeet</p>
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              <span className="text-xs text-white/50">Online</span>
            </div>
          </div>
          <Link href={`/w/${slug}/settings`} className="text-white/40 hover:text-white transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </Link>
        </div>
      </aside>

      {/* Main content — white rounded panel */}
      <main className="flex-1 overflow-hidden bg-white" style={{ borderRadius: '16px 0 0 16px', margin: '8px 0 8px 0' }}>
        {children}
      </main>
    </div>
  )
}
