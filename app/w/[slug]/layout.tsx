import Link from 'next/link'
import { createServiceClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { ProjectList } from './components/ProjectList'

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
          <div className="w-9 h-9 rounded-xl flex items-center justify-center shadow-lg overflow-hidden" style={{ background: 'linear-gradient(135deg, #f59e0b, #d97706)' }}>
            <svg viewBox="0 0 36 36" width="28" height="28" fill="none">
              {/* Body */}
              <ellipse cx="18" cy="20" rx="7" ry="8" fill="#1a1a1a"/>
              <rect x="12" y="16" width="12" height="3" rx="1.5" fill="#f59e0b" opacity="0.9"/>
              <rect x="12" y="20" width="12" height="3" rx="1.5" fill="#f59e0b" opacity="0.7"/>
              <rect x="12" y="24" width="12" height="2" rx="1" fill="#f59e0b" opacity="0.5"/>
              {/* Head */}
              <circle cx="18" cy="13" r="5" fill="#1a1a1a"/>
              <circle cx="16" cy="12" r="1.5" fill="#fde68a"/>
              <circle cx="20" cy="12" r="1.5" fill="#fde68a"/>
              {/* Wings */}
              <ellipse cx="10" cy="16" rx="5" ry="3" fill="white" opacity="0.55" transform="rotate(-20 10 16)"/>
              <ellipse cx="26" cy="16" rx="5" ry="3" fill="white" opacity="0.55" transform="rotate(20 26 16)"/>
              {/* Stinger */}
              <ellipse cx="18" cy="28" rx="1.5" ry="2" fill="#f59e0b"/>
              {/* Antennae */}
              <line x1="15" y1="8" x2="12" y2="5" stroke="#1a1a1a" strokeWidth="1.2" strokeLinecap="round"/>
              <circle cx="11.5" cy="4.5" r="1" fill="#fde68a"/>
              <line x1="21" y1="8" x2="24" y2="5" stroke="#1a1a1a" strokeWidth="1.2" strokeLinecap="round"/>
              <circle cx="24.5" cy="4.5" r="1" fill="#fde68a"/>
            </svg>
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

          <ProjectList projects={projects ?? []} slug={slug} />
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
