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

function toEvent(msg: Record<string, unknown>): ProjectEvent | null {
  const meta = (msg.metadata ?? {}) as Record<string, unknown>
  if (!meta.event_type) return null
  return {
    id: msg.id as string,
    event_type: meta.event_type as string,
    jugnu_key: meta.jugnu_key as string | undefined,
    task_id: msg.task_id as string | null | undefined,
    content: msg.content as string,
    created_at: msg.created_at as string,
    metadata: meta,
  }
}

export function useProjectEvents(projectId: string): ProjectEvent[] {
  const [events, setEvents] = useState<ProjectEvent[]>([])

  useEffect(() => {
    const db = createBrowserClient()

    // Load historical events first, then subscribe to new ones.
    // Historical load runs before subscribe so we don't miss events
    // that were inserted before the hook mounted.
    db.from('messages')
      .select('id, task_id, author_type, author_key, content, created_at, metadata')
      .eq('project_id', projectId)
      .not('metadata->event_type', 'is', null)
      .order('created_at', { ascending: true })
      .then(({ data }) => {
        if (!data?.length) return
        const historical = (data as Record<string, unknown>[])
          .map(toEvent)
          .filter((e): e is ProjectEvent => e !== null)
        setEvents(historical)
      })

    const sub = db
      .channel(`project-events:${projectId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `project_id=eq.${projectId}` },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (payload: any) => {
          const msg = payload.new as Record<string, unknown>
          const evt = toEvent(msg)
          if (!evt) return
          setEvents((prev) => prev.find((e) => e.id === evt.id) ? prev : [...prev, evt])
        }
      )
      .subscribe()

    return () => { void db.removeChannel(sub) }
  }, [projectId])

  return events
}
