'use client'

import { useEffect, useState } from 'react'
import { createBrowserClient } from '@/lib/supabase/client'

interface Task {
  id: string
  title: string
  status: string
  jugnu_key: string
  sort_order: number
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
  projectId: string
  onEscalationReply: (escalationId: string, answer: string) => void
}

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  working:   { label: 'Working',   cls: 'bg-indigo-100 text-indigo-700 animate-pulse' },
  reviewing: { label: 'Reviewing', cls: 'bg-amber-100  text-amber-700  animate-pulse' },
  done:      { label: 'Done',      cls: 'bg-emerald-100 text-emerald-700' },
  idle:      { label: 'Idle',      cls: 'bg-gray-100   text-gray-500' },
  blocked:   { label: 'Blocked',   cls: 'bg-red-100    text-red-600' },
}

const TASK_ICON: Record<string, { icon: string; cls: string }> = {
  completed:   { icon: '✓', cls: 'text-emerald-500' },
  in_progress: { icon: '●', cls: 'text-indigo-500' },
  pending:     { icon: '○', cls: 'text-gray-300'   },
  blocked:     { icon: '!', cls: 'text-red-400'    },
}

const JUGNU_ROLE: Record<string, string> = {
  maya: 'Planner',
  nia:  'Designer',
  leo:  'Builder',
  tara: 'Reviewer',
}

export function JugnuPanel({ jugnus: initialJugnus, tasks: initialTasks, escalations: initialEscalations, projectId, onEscalationReply }: Props) {
  const [jugnus, setJugnus]           = useState<Jugnu[]>(initialJugnus)
  const [tasks, setTasks]             = useState<Task[]>(initialTasks)
  const [escalations, setEscalations] = useState<Escalation[]>(initialEscalations)

  useEffect(() => {
    const db = createBrowserClient()

    const jugnuSub = db
      .channel(`jugnu-panel-jugnus:${projectId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'jugnus' },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (payload: any) => {
          const u = payload.new as Jugnu
          setJugnus((prev) => prev.map((j) => j.key === u.key ? { ...j, status: u.status } : j))
        })
      .subscribe()

    const taskSub = db
      .channel(`jugnu-panel-tasks:${projectId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks', filter: `project_id=eq.${projectId}` },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (payload: any) => {
          const u = payload.new as Task
          setTasks((prev) => {
            const exists = prev.find((t) => t.id === u.id)
            if (exists) return prev.map((t) => t.id === u.id ? u : t)
            return [...prev, u].sort((a, b) => a.sort_order - b.sort_order)
          })
        })
      .subscribe()

    return () => {
      void db.removeChannel(jugnuSub)
      void db.removeChannel(taskSub)
    }
  }, [projectId])

  const completedCount = tasks.filter((t) => t.status === 'completed').length
  const pct = tasks.length > 0 ? Math.round((completedCount / tasks.length) * 100) : 0
  const circumference = 2 * Math.PI * 20 // r=20

  return (
    <aside className="w-72 shrink-0 border-l border-gray-100 bg-gray-50/80 flex flex-col h-full overflow-y-auto">

      {/* Agents in action */}
      <div className="p-5 border-b border-gray-100">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-base">✦</span>
          <h3 className="text-sm font-semibold text-gray-900">Agents in action</h3>
        </div>

        <div className="space-y-3">
          {jugnus.map((j) => {
            const badge = STATUS_BADGE[j.status] ?? STATUS_BADGE.idle
            const currentTask = tasks.find((t) => t.jugnu_key === j.key && t.status === 'in_progress')
            return (
              <div key={j.key} className="flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/jugnus/jugnu_${j.key}.png`}
                  alt={j.name}
                  className="shrink-0"
                  style={{ width: 48, height: 46, objectFit: 'contain' }}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1">
                    <p className="text-sm font-semibold text-gray-900">{j.name}</p>
                    <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${badge.cls}`}>
                      {badge.label}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400 truncate">
                    {currentTask ? currentTask.title : JUGNU_ROLE[j.key] ?? j.role}
                  </p>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Task progress */}
      {tasks.length > 0 && (
        <div className="p-5 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Task Progress</h3>

          {/* Circular progress */}
          <div className="flex items-center gap-4 mb-4">
            <svg width="56" height="56" className="-rotate-90">
              <circle cx="28" cy="28" r="20" fill="none" stroke="#e5e7eb" strokeWidth="5" />
              <circle
                cx="28" cy="28" r="20" fill="none" stroke="#6366f1" strokeWidth="5"
                strokeDasharray={circumference}
                strokeDashoffset={circumference * (1 - pct / 100)}
                strokeLinecap="round"
                style={{ transition: 'stroke-dashoffset 0.5s ease' }}
              />
            </svg>
            <div>
              <p className="text-2xl font-bold text-gray-900">{pct}%</p>
              <p className="text-xs text-gray-400">{completedCount} of {tasks.length} done</p>
            </div>
          </div>

          {/* Task list */}
          <div className="space-y-2">
            {tasks.map((t) => {
              const icon = TASK_ICON[t.status] ?? TASK_ICON.pending
              return (
                <div key={t.id} className="flex items-start gap-2">
                  <span className={`shrink-0 text-sm font-mono mt-0.5 ${icon.cls}`}>{icon.icon}</span>
                  <div className="flex-1 min-w-0 flex items-center justify-between gap-2">
                    <span className={`text-xs leading-snug ${
                      t.status === 'completed'   ? 'text-gray-400 line-through' :
                      t.status === 'in_progress' ? 'text-gray-900 font-medium'  : 'text-gray-500'
                    }`}>{t.title}</span>
                    {t.status === 'in_progress' && (
                      <span className="shrink-0 text-xs text-indigo-500 font-medium">In progress</span>
                    )}
                    {t.status === 'completed' && (
                      <span className="shrink-0 text-xs text-emerald-500 font-medium">Done</span>
                    )}
                    {t.status === 'pending' && (
                      <span className="shrink-0 text-xs text-gray-300">Pending</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Escalations */}
      {escalations.length > 0 && (
        <div className="p-5">
          <h3 className="text-xs font-semibold text-amber-600 uppercase tracking-wider mb-3">⚠️ Your input needed</h3>
          {escalations.map((e) => (
            <div key={e.id} className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-2">
              <p className="text-sm text-gray-800">{e.question}</p>
              {e.options?.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => onEscalationReply(e.id, opt.value)}
                  className="w-full text-left text-sm px-3 py-1.5 rounded-lg bg-white border border-amber-300 hover:bg-amber-100 transition-colors"
                >
                  {opt.label}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Footer tagline */}
      <div className="mt-auto p-5 border-t border-gray-100">
        <p className="text-xs font-semibold text-gray-700">The jugnus are on it!</p>
        <p className="text-xs text-gray-400">Your ideas. Their action.</p>
      </div>
    </aside>
  )
}
