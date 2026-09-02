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
  const [selected, setSelected] = useState<FileSnapshot | null>(null)
  const [open, setOpen] = useState(false)

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
      })
      .subscribe()
    return () => { void db.removeChannel(sub) }
  }, [projectId])

  if (!files.length) return null

  return (
    <>
      {/* Collapsed tab — always visible when files exist */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="shrink-0 self-start mt-4 mr-2 flex flex-col items-center gap-1 px-2 py-3 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-500 hover:text-indigo-600 transition-colors shadow-sm"
          title="Show files"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <span className="text-xs font-medium" style={{ writingMode: 'vertical-rl' }}>{files.length} files</span>
        </button>
      )}

      {/* Expanded panel — fixed width, never squishes the chat */}
      {open && (
        <div className="shrink-0 w-80 flex h-full border-l border-gray-200 flex-col bg-white">
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 bg-gray-50">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Files</span>
            <button onClick={() => { setOpen(false); setSelected(null) }} className="text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
          </div>

          {/* File list */}
          <div className="border-b border-gray-100 overflow-y-auto max-h-40">
            {files.map((f) => (
              <button
                key={f.path}
                onClick={() => setSelected(selected?.path === f.path ? null : f)}
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

          {/* File content */}
          {selected ? (
            <div className="flex-1 flex flex-col min-h-0">
              <div className="px-3 py-1.5 border-b border-gray-100 bg-white">
                <span className="text-xs font-mono text-gray-500 truncate block">{selected.path}</span>
              </div>
              <pre className="flex-1 overflow-auto p-3 text-xs font-mono text-gray-800 bg-gray-50 whitespace-pre leading-relaxed">
                {selected.content}
              </pre>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-xs text-gray-400">
              Select a file to view
            </div>
          )}
        </div>
      )}
    </>
  )
}
