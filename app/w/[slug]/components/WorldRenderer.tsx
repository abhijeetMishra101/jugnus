'use client'

import { useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { JugnuIllustration } from './JugnuIllustration'
import { useProjectEvents } from '../hooks/useProjectEvents'
import type { JugnuKey } from '@/lib/jugnus/registry'

interface JugnuInfo {
  key: JugnuKey
  display_role: string
}

interface Props {
  projectId: string
  jugnus: JugnuInfo[]
}

type ArtifactPos = 'center' | 'maya' | 'nia' | 'leo' | 'tara' | 'delivered'
type DeskState = 'idle' | 'working' | 'done' | 'waiting'

const DESK_POSITIONS: Record<string, { x: string; y: string }> = {
  maya: { x: '14%',  y: '18%' },
  nia:  { x: '62%',  y: '18%' },
  leo:  { x: '14%',  y: '58%' },
  tara: { x: '62%',  y: '58%' },
}

const ARTIFACT_POSITIONS: Record<ArtifactPos, { x: string; y: string }> = {
  center:    { x: '43%', y: '41%' },
  maya:      { x: '22%', y: '26%' },
  nia:       { x: '70%', y: '26%' },
  leo:       { x: '22%', y: '66%' },
  tara:      { x: '70%', y: '66%' },
  delivered: { x: '43%', y: '82%' },
}

const JUGNU_ORDER: JugnuKey[] = ['maya', 'nia', 'leo', 'tara']

interface WorldState {
  deskStates: Record<string, DeskState>
  artifactPos: ArtifactPos
  activeJugnu: string | null
  thinkingJugnu: string | null
  isComplete: boolean
  awaitingApproval: boolean
}

function deriveWorldState(events: ReturnType<typeof useProjectEvents>): WorldState {
  const deskStates: Record<string, DeskState> = { maya: 'idle', nia: 'idle', leo: 'idle', tara: 'idle' }
  let artifactPos: ArtifactPos = 'center'
  let activeJugnu: string | null = null
  let thinkingJugnu: string | null = null
  let isComplete = false
  let awaitingApproval = false

  for (const { event_type, jugnu_key } of events) {
    switch (event_type) {
      case 'TASK_ASSIGNED':
        if (jugnu_key && DESK_POSITIONS[jugnu_key]) {
          activeJugnu = jugnu_key
          deskStates[jugnu_key] = 'working'
          artifactPos = jugnu_key as ArtifactPos
          awaitingApproval = false
        }
        break
      case 'JUGNU_THINKING':
        if (jugnu_key) thinkingJugnu = jugnu_key
        break
      case 'JUGNU_SPOKE':
      case 'JUGNU_STARTED':
        thinkingJugnu = null
        break
      case 'PROTOTYPE_READY':
      case 'APPROVAL_REQUIRED':
        artifactPos = 'center'
        awaitingApproval = true
        activeJugnu = null
        break
      case 'PROTOTYPE_APPROVED':
        awaitingApproval = false
        break
      case 'PROTOTYPE_REVISED':
        awaitingApproval = false
        deskStates['nia'] = 'working'
        artifactPos = 'nia'
        activeJugnu = 'nia'
        break
      case 'FILE_WRITTEN':
        if (jugnu_key && DESK_POSITIONS[jugnu_key]) {
          deskStates[jugnu_key] = 'working'
        }
        break
      case 'REVIEW_STARTED':
        deskStates['tara'] = 'working'
        artifactPos = 'tara'
        activeJugnu = 'tara'
        break
      case 'TASK_RETURNED':
        deskStates['tara'] = 'idle'
        deskStates['leo'] = 'working'
        artifactPos = 'leo'
        activeJugnu = 'leo'
        break
      case 'REVIEW_PASSED':
      case 'PROJECT_COMPLETED':
        Object.keys(deskStates).forEach((k) => { deskStates[k] = 'done' })
        artifactPos = 'delivered'
        activeJugnu = null
        thinkingJugnu = null
        isComplete = true
        break
      case 'TASK_COMPLETED':
        if (jugnu_key) deskStates[jugnu_key] = 'done'
        break
    }
  }

  return { deskStates, artifactPos, activeJugnu, thinkingJugnu, isComplete, awaitingApproval }
}

export function WorldRenderer({ projectId, jugnus }: Props) {
  const events = useProjectEvents(projectId)
  const { deskStates, artifactPos, activeJugnu, thinkingJugnu, isComplete, awaitingApproval } =
    useMemo(() => deriveWorldState(events), [events])

  const roleFor = (key: JugnuKey) =>
    jugnus.find((j) => j.key === key)?.display_role ?? key.charAt(0).toUpperCase() + key.slice(1)

  return (
    <div className="relative w-full h-full bg-gradient-to-b from-indigo-50 to-white overflow-hidden select-none">
      {/* Room floor grid */}
      <svg className="absolute inset-0 w-full h-full opacity-10" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#6366f1" strokeWidth="0.5"/>
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid)" />
      </svg>

      {/* Desks + Jugnus */}
      {JUGNU_ORDER.map((key) => {
        const pos = DESK_POSITIONS[key]
        const state = deskStates[key] ?? 'idle'
        const isActive = activeJugnu === key
        const isThinking = thinkingJugnu === key
        if (!pos) return null

        return (
          <div
            key={key}
            className="absolute flex flex-col items-center gap-1"
            style={{ left: pos.x, top: pos.y, transform: 'translate(-50%, -50%)' }}
          >
            {/* Desk surface */}
            <div className={`w-28 h-16 rounded-xl shadow-sm border-2 flex items-end justify-center pb-1 transition-all duration-500 ${
              state === 'working' ? 'border-indigo-400 bg-indigo-50 shadow-indigo-200 shadow-md' :
              state === 'done'    ? 'border-emerald-400 bg-emerald-50' :
              state === 'waiting' ? 'border-amber-400 bg-amber-50' :
                                   'border-gray-200 bg-white'
            }`}>
              <span className="text-xs text-gray-400 font-mono">
                {state === 'working' ? '⚡' : state === 'done' ? '✅' : ''}
              </span>
            </div>

            {/* Jugnu illustration */}
            <div className="relative -mt-6">
              <motion.div
                animate={isActive ? { y: [0, -6, 0] } : { y: 0 }}
                transition={isActive ? { duration: 2.2, repeat: Infinity, ease: 'easeInOut' } : { duration: 0.3 }}
              >
                <JugnuIllustration jugnuKey={key} size={72} />
              </motion.div>

              {/* Thought bubble */}
              <AnimatePresence>
                {isThinking && (
                  <motion.div
                    initial={{ opacity: 0, scale: 0.5, y: 4 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.5 }}
                    className="absolute -top-7 left-1/2 -translate-x-1/2 bg-white border border-gray-200 rounded-full px-2 py-0.5 text-xs shadow-sm whitespace-nowrap"
                  >
                    💭
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Nameplate */}
            <div className="bg-white border border-gray-200 rounded-lg px-2 py-0.5 shadow-sm">
              <p className="text-xs font-semibold text-gray-700 capitalize">{key}</p>
              <p className="text-[10px] text-indigo-500 text-center">{roleFor(key)}</p>
            </div>
          </div>
        )
      })}

      {/* Project artifact */}
      <AnimatePresence mode="wait">
        <motion.div
          key={artifactPos}
          className="absolute"
          style={{ left: ARTIFACT_POSITIONS[artifactPos].x, top: ARTIFACT_POSITIONS[artifactPos].y, transform: 'translate(-50%, -50%)' }}
          initial={{ scale: 0.6, opacity: 0 }}
          animate={{
            scale: 1, opacity: 1,
            y: artifactPos === 'center' && awaitingApproval ? [0, -5, 0] : 0,
          }}
          exit={{ scale: 0.6, opacity: 0 }}
          transition={{
            duration: 0.5, ease: 'easeOut',
            y: awaitingApproval ? { duration: 1.6, repeat: Infinity, ease: 'easeInOut' } : undefined,
          }}
        >
          <div className={`text-3xl filter drop-shadow transition-all duration-300 ${
            isComplete ? 'scale-125' : awaitingApproval ? 'scale-110' : ''
          }`}>
            {isComplete ? '🎉' : awaitingApproval ? '👀' : '📄'}
          </div>
          {awaitingApproval && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="absolute -bottom-6 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] font-medium text-indigo-600 bg-indigo-50 border border-indigo-200 rounded-full px-2 py-0.5"
            >
              Awaiting approval
            </motion.div>
          )}
          {isComplete && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              className="absolute -bottom-6 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] font-medium text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5"
            >
              Delivered ✓
            </motion.div>
          )}
        </motion.div>
      </AnimatePresence>

      {/* Legend */}
      <div className="absolute bottom-3 right-3 flex gap-2 text-[10px] text-gray-400">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-indigo-400 inline-block"/>Working</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-400 inline-block"/>Done</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-gray-200 inline-block"/>Idle</span>
      </div>
    </div>
  )
}
