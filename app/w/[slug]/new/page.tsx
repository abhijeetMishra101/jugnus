'use client'

import { useState } from 'react'
import { useRouter, useParams } from 'next/navigation'

export default function NewProjectPage() {
  const { slug } = useParams<{ slug: string }>()
  const router = useRouter()
  const [objective, setObjective] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!objective.trim()) return
    setLoading(true)
    setError('')

    // Get workspaceId from the slug via the workspace API
    const wsRes = await fetch(`/api/workspaces?slug=${encodeURIComponent(slug)}`)
    if (!wsRes.ok) { setError('Could not load workspace.'); setLoading(false); return }
    const { id: workspaceId } = await wsRes.json() as { id: string }

    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId, objective: objective.trim() }),
    })

    if (!res.ok) { setError('Failed to create project. Try again.'); setLoading(false); return }
    const { id } = await res.json() as { id: string }
    router.push(`/w/${slug}/p/${id}`)
  }

  return (
    <div className="flex h-full items-center justify-center bg-gray-50">
      <div className="w-full max-w-lg">
        <h1 className="text-2xl font-semibold text-gray-900 mb-2">New project</h1>
        <p className="text-sm text-gray-500 mb-8">
          Describe what you want to build. Your team will take it from there.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <textarea
            autoFocus
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
            placeholder="e.g. Add a dark mode toggle to the app. Users should be able to switch between light and dark, and the preference should be saved."
            rows={5}
            className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 placeholder-gray-400 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
            disabled={loading}
          />

          {error && <p className="text-sm text-red-500">{error}</p>}

          <button
            type="submit"
            disabled={loading || !objective.trim()}
            className="w-full rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? 'Starting…' : 'Start project →'}
          </button>
        </form>
      </div>
    </div>
  )
}
