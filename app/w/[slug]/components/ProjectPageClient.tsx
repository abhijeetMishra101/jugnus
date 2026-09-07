'use client'

import { Component, useState, type ReactNode } from 'react'
import { ProjectChannel } from './ProjectChannel'
import { FilesPanel } from './FilesPanel'
import { JugnuPanel } from './JugnuPanel'
import { WorldRenderer } from './WorldRenderer'
import type { JugnuKey } from '@/lib/jugnus/registry'

class WorldErrorBoundary extends Component<
  { children: ReactNode },
  { crashed: boolean; msg: string }
> {
  constructor(props: { children: ReactNode }) {
    super(props)
    this.state = { crashed: false, msg: '' }
  }
  static getDerivedStateFromError(err: unknown) {
    return { crashed: true, msg: err instanceof Error ? err.message : String(err) }
  }
  render() {
    if (this.state.crashed) {
      return (
        <div className="flex-1 flex items-center justify-center bg-[#0f172a] text-gray-500 text-sm font-mono flex-col gap-3">
          <span className="text-2xl">⚠️</span>
          <p>World view failed to render</p>
          <p className="text-xs text-gray-700 max-w-xs text-center">{this.state.msg}</p>
          <button
            onClick={() => this.setState({ crashed: false, msg: '' })}
            className="mt-2 px-4 py-1.5 rounded-lg border border-gray-700 text-xs hover:border-gray-500 transition-colors"
          >
            Retry
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

interface JugnuInfo {
  key: JugnuKey
  display_role: string
}

interface Props {
  project: {
    id: string
    title: string
    objective: string
    status: string
  }
  workspace: { id: string; name: string; owner_id: string }
  initialMessages: Parameters<typeof ProjectChannel>[0]['initialMessages']
  initialFiles: { path: string; content: string; updated_at: string }[]
  jugnus: Parameters<typeof JugnuPanel>[0]['jugnus']
  tasks: Parameters<typeof JugnuPanel>[0]['tasks']
  escalations: Parameters<typeof JugnuPanel>[0]['escalations']
  activeJugnuKey: string | null
  onEscalationReply: (escalationId: string, answer: string) => Promise<void>
  jugnuRoles: Record<string, { display_role: string; focus: string }>
}

export function ProjectPageClient({
  project,
  workspace,
  initialMessages,
  initialFiles,
  jugnus,
  tasks,
  escalations,
  activeJugnuKey,
  onEscalationReply,
  jugnuRoles,
}: Props) {
  const [view, setView] = useState<'chat' | 'world'>('chat')
  const [worldEverMounted, setWorldEverMounted] = useState(false)

  // Build jugnu info list for WorldRenderer from jugnu_roles + registry keys
  const jugnuInfos: JugnuInfo[] = (['maya', 'nia', 'leo', 'tara'] as JugnuKey[]).map((key) => ({
    key,
    display_role: jugnuRoles[key]?.display_role ?? key.charAt(0).toUpperCase() + key.slice(1),
  }))

  return (
    <div className="flex h-full">
      {/* Main area (chat + world stacked, one visible at a time) */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header with view toggle */}
        <header className="shrink-0 px-6 py-3 border-b border-gray-100 bg-white flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-gray-400 text-sm font-medium">#</span>
              <h1 className="text-sm font-semibold text-gray-900 truncate">{project.title}</h1>
            </div>
            <p className="text-xs text-gray-400 truncate mt-0.5 pl-4">{project.objective}</p>
          </div>

          {/* Toggle */}
          <div className="shrink-0 flex items-center bg-gray-100 rounded-xl p-1 gap-0.5">
            <button
              onClick={() => setView('chat')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                view === 'chat'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor">
                <path d="M2 2h12a1 1 0 011 1v7a1 1 0 01-1 1H9l-3 3v-3H2a1 1 0 01-1-1V3a1 1 0 011-1z"/>
              </svg>
              Chat
            </button>
            <button
              onClick={() => { setWorldEverMounted(true); setView('world') }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                view === 'world'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 1.5a5.5 5.5 0 110 11 5.5 5.5 0 010-11zM6 6h4v1H9v3H7V7H6V6z"/>
              </svg>
              World
            </button>
          </div>
        </header>

        {/* Chat — always mounted, hidden when world is active */}
        <div className={`flex-1 flex flex-col min-h-0 ${view === 'world' ? 'hidden' : ''}`}>
          <ProjectChannel
            projectId={project.id}
            userId={workspace.owner_id}
            initialMessages={initialMessages}
            activeJugnuKey={activeJugnuKey}
          />
        </div>

        {/* World — lazy-mounted on first toggle, then always in DOM */}
        {worldEverMounted && (
          <div className={`flex-1 min-h-0 ${view === 'chat' ? 'hidden' : ''}`}>
            <WorldErrorBoundary>
              <WorldRenderer projectId={project.id} jugnus={jugnuInfos} />
            </WorldErrorBoundary>
          </div>
        )}
      </div>

      {/* Files panel */}
      <FilesPanel projectId={project.id} initialFiles={initialFiles} projectStatus={project.status} />

      {/* Right panel */}
      <JugnuPanel
        projectId={project.id}
        jugnus={jugnus}
        tasks={tasks}
        escalations={escalations}
        onEscalationReply={onEscalationReply}
        jugnuRoles={jugnuRoles}
      />
    </div>
  )
}
