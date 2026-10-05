'use client'

import { useEffect, useRef, useState } from 'react'
import { useProjectEvents } from './useProjectEvents'

export function useNotifications(projectId: string) {
  const [permission, setPermission] = useState<NotificationPermission>('default')
  const mountTime = useRef(Date.now())
  const notifiedIds = useRef(new Set<string>())
  const events = useProjectEvents(projectId)

  useEffect(() => {
    if (typeof Notification !== 'undefined') {
      setPermission(Notification.permission)
    }
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
      if (new Date(event.created_at).getTime() <= mountTime.current) continue

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
  }, [events, projectId])

  return { permission, requestPermission }
}
