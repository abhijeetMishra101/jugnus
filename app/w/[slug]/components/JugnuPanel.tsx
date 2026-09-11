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

interface Props {
  jugnus: Jugnu[]
  tasks: Task[]
  projectId: string
  jugnuRoles?: Record<string, { display_role: string; focus: string }>
}

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  working:   { label: 'Working',   cls: 'bg-indigo-500/20 text-indigo-300 animate-pulse' },
  reviewing: { label: 'Reviewing', cls: 'bg-amber-500/20  text-amber-300  animate-pulse' },
  done:      { label: 'Done',      cls: 'bg-emerald-500/20 text-emerald-300' },
  idle:      { label: 'Idle',      cls: 'bg-white/10      text-white/40' },
  blocked:   { label: 'Blocked',   cls: 'bg-red-500/20    text-red-300' },
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

export function JugnuPanel({ jugnus: initialJugnus, tasks: initialTasks, projectId, jugnuRoles }: Props) {
  const [jugnus, setJugnus] = useState<Jugnu[]>(initialJugnus)
  const [tasks, setTasks]   = useState<Task[]>(initialTasks)

  useEffect(() => {
    const db = createBrowserClient()

    // Fresh snapshot on mount so we never miss tasks created before the subscription fires
    void db.from('tasks')
      .select('id,title,status,jugnu_key,sort_order')
      .eq('project_id', projectId)
      .order('sort_order', { ascending: true })
      .then(({ data }) => {
        if (data?.length) {
          setTasks(data as Task[])
        }
      })

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
    <aside className="w-72 shrink-0 border-l border-white/10 flex flex-col h-full overflow-y-auto" style={{ background: 'rgba(8, 14, 35, 0.88)', backdropFilter: 'blur(12px)' }}>

      {/* Agents in action */}
      <div className="p-5 border-b border-white/10">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-base">✦</span>
          <h3 className="text-sm font-semibold text-white/90">Agents in action</h3>
        </div>

        <div className="space-y-3">
          {jugnus.map((j) => {
            const currentTask = tasks.find((t) => t.jugnu_key === j.key && t.status === 'in_progress')
            const hasDone    = tasks.some((t) => t.jugnu_key === j.key && t.status === 'completed')
            const hasPending = tasks.some((t) => t.jugnu_key === j.key && (t.status === 'pending' || t.status === 'in_progress'))
            const derivedStatus = currentTask ? 'working' : hasDone && !hasPending ? 'done' : 'idle'
            const badge = STATUS_BADGE[derivedStatus] ?? STATUS_BADGE.idle
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
                    <p className="text-sm font-semibold text-white/90">{j.name}</p>
                    <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${badge.cls}`}>
                      {badge.label}
                    </span>
                  </div>
                  <p className="text-xs text-white/40 truncate">
                    {currentTask
                      ? currentTask.title
                      : jugnuRoles?.[j.key]?.display_role ?? JUGNU_ROLE[j.key] ?? j.role}
                  </p>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Task progress */}
      {tasks.length > 0 && (
        <div className="p-5 border-b border-white/10">
          <h3 className="text-sm font-semibold text-white/90 mb-4">Task Progress</h3>

          {/* Circular progress */}
          <div className="flex items-center gap-4 mb-4">
            <svg width="56" height="56" className="-rotate-90">
              <circle cx="28" cy="28" r="20" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="5" />
              <circle
                cx="28" cy="28" r="20" fill="none" stroke="#6366f1" strokeWidth="5"
                strokeDasharray={circumference}
                strokeDashoffset={circumference * (1 - pct / 100)}
                strokeLinecap="round"
                style={{ transition: 'stroke-dashoffset 0.5s ease' }}
              />
            </svg>
            <div>
              <p className="text-2xl font-bold text-white/90">{pct}%</p>
              <p className="text-xs text-white/40">{completedCount} of {tasks.length} done</p>
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
                      t.status === 'completed'   ? 'text-white/30 line-through' :
                      t.status === 'in_progress' ? 'text-white/90 font-medium'  : 'text-white/50'
                    }`}>{t.title}</span>
                    {t.status === 'in_progress' && (
                      <span className="shrink-0 text-xs text-indigo-300 font-medium">In progress</span>
                    )}
                    {t.status === 'completed' && (
                      <span className="shrink-0 text-xs text-emerald-300 font-medium">Done</span>
                    )}
                    {t.status === 'pending' && (
                      <span className="shrink-0 text-xs text-white/25">Pending</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Footer tagline */}
      <div className="mt-auto p-5 border-t border-white/10">
        <p className="text-xs font-semibold text-white/70">The jugnus are on it!</p>
        <p className="text-xs text-white/35">Your ideas. Their action.</p>
      </div>
    </aside>
  )
}
