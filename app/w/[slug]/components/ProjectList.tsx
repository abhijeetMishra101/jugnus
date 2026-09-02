'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

interface Project {
  id: string
  title: string
  status: string
}

const STATUS_DOT: Record<string, string> = {
  planning:  'bg-yellow-400',
  building:  'bg-indigo-400 animate-pulse',
  reviewing: 'bg-amber-400 animate-pulse',
  completed: 'bg-emerald-400',
  blocked:   'bg-red-400',
  active:    'bg-indigo-400',
}

export function ProjectList({ projects: initial, slug }: { projects: Project[]; slug: string }) {
  const [projects, setProjects] = useState<Project[]>(initial)
  const [deleting, setDeleting] = useState<string | null>(null)
  const router = useRouter()

  const remove = async (id: string) => {
    setDeleting(id)
    await fetch(`/api/projects/${id}`, { method: 'DELETE' })
    setProjects((prev) => prev.filter((p) => p.id !== id))
    setDeleting(null)
    router.refresh()
  }

  if (!projects.length) {
    return <p className="px-3 py-2 text-xs text-white/30 italic">No projects yet</p>
  }

  return (
    <div className="space-y-0.5">
      {projects.map((p) => (
        <div key={p.id} className="group flex items-center gap-1">
          <Link
            href={`/w/${slug}/p/${p.id}`}
            className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-white/70 hover:bg-white/10 hover:text-white transition-colors flex-1 min-w-0"
          >
            <span className="text-white/40 font-medium">#</span>
            <span className="truncate flex-1">{p.title}</span>
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${STATUS_DOT[p.status] ?? 'bg-white/20'}`} />
          </Link>
          <button
            onClick={() => void remove(p.id)}
            disabled={deleting === p.id}
            className="opacity-0 group-hover:opacity-100 mr-1 p-1 rounded text-white/30 hover:text-red-400 hover:bg-white/10 transition-all disabled:opacity-20"
            title="Delete project"
          >
            {deleting === p.id ? (
              <span className="text-xs">…</span>
            ) : (
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            )}
          </button>
        </div>
      ))}
    </div>
  )
}
