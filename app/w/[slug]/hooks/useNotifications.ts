'use client'

import { useEffect, useRef, useState } from 'react'
import { useProjectEvents } from './useProjectEvents'

export function useNotifications(projectId: string) {
  // useState lazy init is allowed for impure calls like Date.now()
  const [mountTime] = useState(() => Date.now())
  const [permission, setPermission] = useState<NotificationPermission>('default')
  const notifiedIds = useRef(new Set<string>())
  const events = useProjectEvents(projectId)

  useEffect(() => {
    if (typeof Notification === 'undefined') return
    // Read external browser state in a callback to satisfy react-hooks/set-state-in-effect
    const update = () => setPermission(Notification.permission)
    update()
  }, [])

  const requestPermission = async () => {
    if (typeof Notification === 'undefined') return
    const result = await Notification.requestPermission()
    setPermission(result)
  }

  useEffect(() => {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return

    for (const event of events) {
      if (notifiedIds.current.has(event.id)) continue
      notifiedIds.current.add(event.id)

      // Skip historical events that predate this page load
      if (new Date(event.created_at).getTime() <= mountTime) continue

      if (event.event_type === 'APPROVAL_REQUIRED') {
        new Notification('👀 Design ready for review', {
          body: 'Nia finished the design. Tap to approve and start building.',
          tag: `jugnus-gate-${projectId}`,
        })
      }
      if (event.event_type === 'PROJECT_COMPLETED') {
        new Notification('🎉 Project complete!', {
          body: 'Your jugnus finished building. Tap to see the result.',
          tag: `jugnus-done-${projectId}`,
        })
      }
    }
  }, [events, projectId, mountTime])

  return { permission, requestPermission }
}
