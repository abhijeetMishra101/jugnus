'use client'

import { useState, useRef } from 'react'
import { useRouter } from 'next/navigation'

interface Attachment {
  url: string
  name: string
  isImage: boolean
  textContent?: string | null
  preview?: string  // local object URL for image thumbnails
  uploading?: boolean
  error?: string
}

export function NewProjectForm({ slug, workspaceId }: { slug: string; workspaceId: string }) {
  const router = useRouter()
  const [objective, setObjective] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function uploadFile(file: File) {
    const localPreview = file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined
    const tempId = `${Date.now()}-${file.name}`

    setAttachments((prev) => [
      ...prev,
      { url: '', name: file.name, isImage: file.type.startsWith('image/'), preview: localPreview, uploading: true },
    ])

    const form = new FormData()
    form.append('file', file)

    const res = await fetch('/api/upload', { method: 'POST', body: form })
    if (!res.ok) {
      setAttachments((prev) => prev.map((a) => a.name === file.name && a.uploading ? { ...a, uploading: false, error: 'Upload failed' } : a))
      return
    }
    const data = await res.json() as { url: string; name: string; isImage: boolean; textContent?: string | null }
    setAttachments((prev) =>
      prev.map((a) => a.name === file.name && a.uploading
        ? { url: data.url, name: data.name, isImage: data.isImage, textContent: data.textContent, preview: localPreview, uploading: false }
        : a
      )
    )
    void tempId
  }

  function handleFiles(files: FileList | null) {
    if (!files) return
    Array.from(files).slice(0, 5).forEach(uploadFile)
  }

  function removeAttachment(name: string) {
    setAttachments((prev) => prev.filter((a) => a.name !== name))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!objective.trim()) return
    if (attachments.some((a) => a.uploading)) return

    setLoading(true)
    setError('')

    const readyAttachments = attachments.filter((a) => a.url && !a.error).map(({ url, name, isImage, textContent }) => ({ url, name, isImage, textContent }))

    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId, objective: objective.trim(), attachments: readyAttachments }),
    })

    if (!res.ok) { setError('Failed to create project. Try again.'); setLoading(false); return }
    const { id } = await res.json() as { id: string }
    router.push(`/w/${slug}/p/${id}`)
  }

  const pendingUploads = attachments.filter((a) => a.uploading).length
  const canSubmit = !loading && !!objective.trim() && pendingUploads === 0

  return (
    <div className="flex h-full items-center justify-center bg-gray-50">
      <div className="w-full max-w-lg">
        <h1 className="text-2xl font-semibold text-gray-900 mb-2">New project</h1>
        <p className="text-sm text-gray-500 mb-8">
          Describe what you want to build. Your team will take it from there.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="relative">
            <textarea
              autoFocus
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void handleSubmit(e as unknown as React.FormEvent) }}
              placeholder="e.g. Design a landing page for my mithai shop — warm colours, sweet imagery, online order CTA."
              rows={5}
              className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 placeholder-gray-400 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
              disabled={loading}
            />

            {/* Attach button — bottom-right of textarea */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={loading}
              className="absolute bottom-3 right-3 flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors disabled:opacity-40"
              title="Attach images or documents"
            >
              <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M13.5 9.5l-5 5a4 4 0 01-5.66-5.66l6-6a2.5 2.5 0 013.54 3.54L6.5 12.3a1 1 0 01-1.42-1.42L10.5 5.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Attach
            </button>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            multiple
            accept="image/*,.txt,.md,.json,.csv"
            onChange={(e) => handleFiles(e.target.files)}
          />

          {/* Attachment thumbnails */}
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {attachments.map((att) => (
                <div key={att.name} className="relative group">
                  {att.isImage && att.preview ? (
                    <div className="w-16 h-16 rounded-lg overflow-hidden border border-gray-200 bg-gray-100">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={att.preview} alt={att.name} className="w-full h-full object-cover" />
                      {att.uploading && (
                        <div className="absolute inset-0 bg-white/60 flex items-center justify-center rounded-lg">
                          <span className="block w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600 max-w-[160px]">
                      <svg className="w-3.5 h-3.5 shrink-0 text-gray-400" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="M9 2H4a1 1 0 00-1 1v10a1 1 0 001 1h8a1 1 0 001-1V6L9 2z" strokeLinecap="round" strokeLinejoin="round"/>
                        <path d="M9 2v4h4" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                      <span className="truncate">{att.name}</span>
                      {att.uploading && <span className="block w-3 h-3 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin shrink-0" />}
                    </div>
                  )}
                  {att.error && <span className="absolute -top-1 -right-1 text-[9px] bg-red-500 text-white px-1 rounded">!</span>}
                  <button
                    type="button"
                    onClick={() => removeAttachment(att.name)}
                    className="absolute -top-1.5 -right-1.5 hidden group-hover:flex w-4 h-4 rounded-full bg-gray-800 text-white items-center justify-center text-[10px] leading-none"
                    aria-label="Remove"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          {pendingUploads > 0 && (
            <p className="text-xs text-gray-400">Uploading {pendingUploads} file{pendingUploads > 1 ? 's' : ''}…</p>
          )}

          {error && <p className="text-sm text-red-500">{error}</p>}

          <button
            type="submit"
            disabled={!canSubmit}
            className="w-full rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? 'Starting…' : 'Start project →'}
          </button>
        </form>
      </div>
    </div>
  )
}
