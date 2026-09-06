'use client'

import { useEffect, useState } from 'react'
import { createBrowserClient } from '@/lib/supabase/client'

export interface ProjectEvent {
  id: string
  event_type: string
  jugnu_key?: string
  task_id?: string | null
  content: string
  created_at: string
  metadata: Record<string, unknown>
}

export function useProjectEvents(projectId: string): ProjectEvent[] {
  const [events, setEvents] = useState<ProjectEvent[]>([])

  useEffect(() => {
    const db = createBrowserClient()

    const sub = db
      .channel(`project-events:${projectId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `project_id=eq.${projectId}` },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (payload: any) => {
          const msg = payload.new
          const meta = (msg.metadata ?? {}) as Record<string, unknown>
          if (!meta.event_type) return
          setEvents((prev) => [
            ...prev,
            {
              id: msg.id,
              event_type: meta.event_type as string,
              jugnu_key: meta.jugnu_key as string | undefined,
              task_id: msg.task_id,
              content: msg.content,
              created_at: msg.created_at,
              metadata: meta,
            },
          ])
        }
      )
      .subscribe()

    return () => { void db.removeChannel(sub) }
  }, [projectId])

  return events
}
