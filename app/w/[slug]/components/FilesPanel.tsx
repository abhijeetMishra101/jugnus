'use client'

import { useEffect, useState } from 'react'
import { createBrowserClient } from '@/lib/supabase/client'

interface FileSnapshot {
  path: string
  content: string
  updated_at: string
}

interface Props {
  projectId: string
  initialFiles: FileSnapshot[]
}

export function FilesPanel({ projectId, initialFiles }: Props) {
  const [files, setFiles] = useState<FileSnapshot[]>(initialFiles)
  const [selected, setSelected] = useState<FileSnapshot | null>(initialFiles[0] ?? null)

  useEffect(() => {
    const db = createBrowserClient()
    const sub = db
      .channel(`files:${projectId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'file_snapshots',
        filter: `project_id=eq.${projectId}`,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }, (payload: any) => {
        const updated = payload.new as FileSnapshot
        setFiles((prev) => {
          const exists = prev.find((f) => f.path === updated.path)
          if (exists) return prev.map((f) => f.path === updated.path ? updated : f)
          return [...prev, updated].sort((a, b) => a.path.localeCompare(b.path))
        })
        setSelected(updated)
      })
      .subscribe()
    return () => { void db.removeChannel(sub) }
  }, [projectId])

  if (!files.length) return null

  return (
    <div className="flex h-full border-l border-gray-200">
      {/* File tree */}
      <div className="w-44 flex-shrink-0 bg-gray-50 border-r border-gray-200 flex flex-col">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-3 py-2">Files</p>
        <div className="flex-1 overflow-y-auto">
          {files.map((f) => (
            <button
              key={f.path}
              onClick={() => setSelected(f)}
              className={`w-full text-left px-3 py-1.5 text-xs truncate transition-colors ${
                selected?.path === f.path
                  ? 'bg-indigo-50 text-indigo-700 font-medium'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              {f.path.split('/').pop()}
              <span className="block text-gray-400 font-normal truncate">{f.path}</span>
            </button>
          ))}
        </div>
      </div>

      {/* File content */}
      {selected && (
        <div className="flex-1 flex flex-col min-w-0">
          <div className="px-4 py-2 border-b border-gray-200 bg-white flex items-center gap-2">
            <span className="text-xs font-mono text-gray-600 truncate">{selected.path}</span>
          </div>
          <pre className="flex-1 overflow-auto p-4 text-xs font-mono text-gray-800 bg-gray-50 whitespace-pre leading-relaxed">
            {selected.content}
          </pre>
        </div>
      )}
    </div>
  )
}
