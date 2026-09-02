'use client'

import { useEffect, useState } from 'react'
import { createBrowserClient } from '@/lib/supabase/client'

interface Jugnu {
  key: string
  name: string
  color: string
  status: string
}

const START: Record<string, { top: string; left: string }> = {
  maya: { top: '20%', left: '15%' },
  leo:  { top: '55%', left: '60%' },
  nia:  { top: '35%', left: '75%' },
  tara: { top: '70%', left: '30%' },
}

export function FlyingJugnus({ projectId, initialJugnus }: { projectId: string; initialJugnus: Jugnu[] }) {
  const [jugnus, setJugnus] = useState<Jugnu[]>(initialJugnus)

  useEffect(() => {
    const db = createBrowserClient()
    const sub = db
      .channel(`jugnus-status:${projectId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'jugnus',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }, (payload: any) => {
        const updated = payload.new as Jugnu
        setJugnus((prev) => prev.map((j) => j.key === updated.key ? { ...j, status: updated.status } : j))
      })
      .subscribe()
    return () => { void db.removeChannel(sub) }
  }, [projectId])

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden>
      {jugnus.map((j) => {
        const pos = START[j.key] ?? { top: '50%', left: '50%' }
        const isActive = j.status !== 'idle'
        return (
          <div
            key={j.key}
            className={`jugnu-firefly fly-${j.key} ${isActive ? 'active' : 'idle'}`}
            style={{
              top: pos.top,
              left: pos.left,
              backgroundColor: j.color,
              boxShadow: isActive ? `0 0 12px 4px ${j.color}88, 0 0 24px 8px ${j.color}44` : 'none',
            }}
            title={`${j.name} — ${j.status}`}
          />
        )
      })}
    </div>
  )
}
