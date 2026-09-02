'use client'

import { JugnuAvatar } from './JugnuAvatar'

interface Task {
  id: string
  title: string
  status: string
  jugnu_key: string
}

interface Jugnu {
  key: string
  name: string
  role: string
  color: string
  status: string
}

interface Escalation {
  id: string
  question: string
  options?: Array<{ label: string; value: string }>
}

interface Props {
  jugnus: Jugnu[]
  tasks: Task[]
  escalations: Escalation[]
  onEscalationReply: (escalationId: string, answer: string) => void
}

const TASK_STATUS_ICON: Record<string, string> = {
  pending:     '○',
  in_progress: '●',
  completed:   '✓',
  blocked:     '!',
  skipped:     '–',
}

const JUGNU_COLOR: Record<string, string> = {
  maya: '#8b5cf6',
  nia:  '#ec4899',
  leo:  '#06b6d4',
  tara: '#10b981',
}

export function JugnuPanel({ jugnus, tasks, escalations, onEscalationReply }: Props) {
  const activeJugnus = jugnus.filter((j) => j.status !== 'idle')
  const currentTask = tasks.find((t) => t.status === 'in_progress')

  return (
    <aside className="w-72 shrink-0 border-l border-gray-200 bg-gray-50 flex flex-col h-full overflow-y-auto">
      {/* Active jugnus */}
      <div className="p-4 border-b border-gray-200">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
          Active Jugnus {activeJugnus.length > 0 && <span className="ml-1 bg-indigo-100 text-indigo-700 rounded-full px-1.5 py-0.5 text-xs">{activeJugnus.length}</span>}
        </h3>
        <div className="space-y-3">
          {jugnus.map((j) => (
            <JugnuAvatar
              key={j.key}
              name={j.name}
              role={j.role}
              color={j.color || JUGNU_COLOR[j.key] || '#6366f1'}
              status={j.status}
              task={j.key === currentTask?.jugnu_key ? currentTask.title : undefined}
            />
          ))}
        </div>
      </div>

      {/* Task progress */}
      {tasks.length > 0 && (
        <div className="p-4 border-b border-gray-200">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Task Progress</h3>
          <div className="space-y-2">
            {tasks.map((t) => (
              <div key={t.id} className="flex items-start gap-2">
                <span className={`shrink-0 text-sm font-mono mt-0.5 ${
                  t.status === 'completed' ? 'text-emerald-500' :
                  t.status === 'in_progress' ? 'text-indigo-500' :
                  t.status === 'blocked' ? 'text-red-400' : 'text-gray-300'
                }`}>
                  {TASK_STATUS_ICON[t.status] ?? '○'}
                </span>
                <span className={`text-xs leading-snug ${
                  t.status === 'completed' ? 'text-gray-400 line-through' :
                  t.status === 'in_progress' ? 'text-gray-900 font-medium' : 'text-gray-500'
                }`}>
                  {t.title}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Escalations / approvals needed */}
      {escalations.length > 0 && (
        <div className="p-4">
          <h3 className="text-xs font-semibold text-amber-600 uppercase tracking-wider mb-3">
            ⚠️ Needs Your Input
          </h3>
          {escalations.map((e) => (
            <div key={e.id} className="bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-2">
              <p className="text-sm text-gray-800">{e.question}</p>
              {e.options ? (
                <div className="space-y-1">
                  {e.options.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => onEscalationReply(e.id, opt.value)}
                      className="w-full text-left text-sm px-3 py-1.5 rounded bg-white border border-amber-300 hover:bg-amber-100 transition-colors"
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </aside>
  )
}
