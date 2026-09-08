'use client'
import type { ProjectEvent } from '../hooks/useProjectEvents'

const EVENT_LABELS: Record<string, (e: ProjectEvent) => string> = {
  TASK_ASSIGNED: (e) => `${capitalize(e.jugnu_key ?? '')} started working`,
  TASK_COMPLETED: (e) => `${capitalize(e.jugnu_key ?? '')} finished task`,
  FILE_WRITTEN: (e) => `${capitalize(e.jugnu_key ?? '')} wrote a file`,
  PROTOTYPE_READY: () => 'Design prototype ready for review',
  APPROVAL_REQUIRED: () => 'Waiting for your approval',
  PROTOTYPE_APPROVED: () => 'Design approved — building now',
  PROTOTYPE_REVISED: () => 'Nia is revising the design',
  REVIEW_STARTED: () => 'Tara is reviewing',
  REVIEW_PASSED: () => 'Review passed',
  TASK_RETURNED: () => 'Tara returned work to Leo',
  PROJECT_COMPLETED: () => 'Project completed',
  JUGNU_THINKING: (e) => `${capitalize(e.jugnu_key ?? '')} thinking…`,
  PLAN_CREATED: () => 'Maya created the plan',
  CLARIFICATION_REQUIRED: () => 'Maya has a question for you',
  CLARIFICATION_RESOLVED: () => 'Clarification answered',
  BUDGET_EXCEEDED: () => 'Budget ceiling reached — project paused',
}

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

const JUGNU_COLORS: Record<string, string> = {
  maya: '#f59e0b',
  nia: '#8b5cf6',
  leo: '#3b82f6',
  tara: '#ec4899',
}

interface Props {
  events: ProjectEvent[]
}

export function WorldActivityTicker({ events }: Props) {
  const visible = [...events].reverse().slice(0, 6)

  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Live Activity</p>
      {visible.length === 0 && (
        <p className="text-xs text-gray-600">Waiting for work to begin…</p>
      )}
      {visible.map((e) => {
        const label = EVENT_LABELS[e.event_type]?.(e) ?? e.event_type.toLowerCase().replace(/_/g, ' ')
        const color = e.jugnu_key ? (JUGNU_COLORS[e.jugnu_key] ?? '#6b7280') : '#6b7280'
        return (
          <div key={e.id} className="flex items-start gap-2">
            <span className="text-xs text-gray-600 font-mono shrink-0 mt-0.5">{formatTime(e.created_at)}</span>
            {e.jugnu_key && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`/jugnus/jugnu_${e.jugnu_key}.png`}
                alt={e.jugnu_key}
                style={{ width: 16, height: 16, objectFit: 'contain', marginTop: 1 }}
              />
            )}
            <span className="text-xs leading-snug" style={{ color }}>{label}</span>
          </div>
        )
      })}
    </div>
  )
}
