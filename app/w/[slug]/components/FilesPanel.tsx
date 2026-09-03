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
  projectStatus: string
}

type ViewMode = 'preview' | 'code'

function bestFile(files: FileSnapshot[]): { file: FileSnapshot; mode: ViewMode } | null {
  if (!files.length) return null
  const html = files.find((f) => f.path.endsWith('.html'))
  if (html) return { file: html, mode: 'preview' }
  return { file: files[0], mode: 'code' }
}

export function FilesPanel({ projectId, initialFiles, projectStatus }: Props) {
  const [files, setFiles] = useState<FileSnapshot[]>(initialFiles)
  const [selected, setSelected] = useState<FileSnapshot | null>(null)
  const [open, setOpen] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>('code')

  const isHtml = selected?.path.endsWith('.html') ?? false

  // Auto-open in preview for already-completed projects on page load
  useEffect(() => {
    if (projectStatus === 'completed') {
      const best = bestFile(initialFiles)
      if (best) {
        setOpen(true)
        setSelected(best.file)
        setViewMode(best.mode)
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const db = createBrowserClient()

    // Watch for new/updated files
    const fileSub = db
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

    // When the project completes, auto-open the best file in preview
    const completeSub = db
      .channel(`project-complete-files:${projectId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `project_id=eq.${projectId}`,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }, (payload: any) => {
        const meta = payload.new?.metadata as Record<string, unknown> | null
        if (!meta?.project_complete) return
        setFiles((currentFiles) => {
          const best = bestFile(currentFiles)
          if (best) {
            setOpen(true)
            setSelected(best.file)
            setViewMode(best.mode)
          }
          return currentFiles
        })
      })
      .subscribe()

    return () => {
      void db.removeChannel(fileSub)
      void db.removeChannel(completeSub)
    }
  }, [projectId])

  function selectFile(f: FileSnapshot) {
    if (selected?.path === f.path) {
      setSelected(null)
      return
    }
    setSelected(f)
    setViewMode(f.path.endsWith('.html') ? 'preview' : 'code')
  }

  if (!files.length) return null

  const panelWidth = open && isHtml && viewMode === 'preview' ? 'w-[480px]' : 'w-80'

  return (
    <>
      {/* Collapsed tab */}
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

      {/* Expanded panel */}
      {open && (
        <div className={`shrink-0 ${panelWidth} flex h-full border-l border-gray-200 flex-col bg-white transition-[width] duration-200`}>
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 bg-gray-50">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Files</span>
            <button
              onClick={() => { setOpen(false); setSelected(null) }}
              className="text-gray-400 hover:text-gray-600 text-lg leading-none"
            >×</button>
          </div>

          {/* File list */}
          <div className="border-b border-gray-100 overflow-y-auto max-h-40">
            {files.map((f) => (
              <button
                key={f.path}
                onClick={() => selectFile(f)}
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
              <div className="px-3 py-1.5 border-b border-gray-100 bg-white flex items-center justify-between gap-2 shrink-0">
                <span className="text-xs font-mono text-gray-500 truncate">{selected.path}</span>
                {isHtml && (
                  <div className="flex shrink-0 rounded border border-gray-200 overflow-hidden text-xs">
                    <button
                      onClick={() => setViewMode('preview')}
                      className={`px-2 py-0.5 transition-colors ${viewMode === 'preview' ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:bg-gray-50'}`}
                    >
                      Preview
                    </button>
                    <button
                      onClick={() => setViewMode('code')}
                      className={`px-2 py-0.5 border-l border-gray-200 transition-colors ${viewMode === 'code' ? 'bg-indigo-600 text-white' : 'text-gray-500 hover:bg-gray-50'}`}
                    >
                      Code
                    </button>
                  </div>
                )}
              </div>

              {viewMode === 'preview' && isHtml ? (
                <iframe
                  key={selected.path}
                  srcDoc={selected.content}
                  className="flex-1 w-full border-0 bg-white"
                  sandbox="allow-scripts"
                  title={selected.path}
                />
              ) : (
                <pre className="flex-1 overflow-auto p-3 text-xs font-mono text-gray-800 bg-gray-50 whitespace-pre leading-relaxed">
                  {selected.content}
                </pre>
              )}
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
