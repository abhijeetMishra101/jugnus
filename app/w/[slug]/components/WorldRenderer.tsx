'use client'

import { useMemo } from 'react'
import { motion } from 'framer-motion'
import { JugnuIllustration } from './JugnuIllustration'
import { useProjectEvents } from '../hooks/useProjectEvents'
import type { JugnuKey } from '@/lib/jugnus/registry'

interface Props {
  projectId: string
  jugnus: { key: JugnuKey; display_role: string }[]
}

// ─── Isometric math ───────────────────────────────────────────────────────────
const VW = 600
const VH = 370
const TW = 68     // tile diamond full width
const TH = 34     // tile diamond height (TW / 2)
const BH = 30     // crafting-station block height
const AH = 14     // artifact block height

const OX = 295    // screen X for world col=0,row=0
const OY = 138    // screen Y for world col=0,row=0

function sx(col: number, row: number): number { return OX + (col - row) * TW / 2 }
function sy(col: number, row: number): number { return OY + (col + row) * TH / 2 }

// Three-face isometric block — points as SVG polygon strings
function topPts(col: number, row: number, h: number): string {
  const x = sx(col, row), y = sy(col, row)
  return `${x},${y - TH / 2 - h} ${x + TW / 2},${y - h} ${x},${y + TH / 2 - h} ${x - TW / 2},${y - h}`
}
function leftPts(col: number, row: number, h: number): string {
  const x = sx(col, row), y = sy(col, row)
  return `${x - TW / 2},${y - h} ${x},${y + TH / 2 - h} ${x},${y + TH / 2} ${x - TW / 2},${y}`
}
function rightPts(col: number, row: number, h: number): string {
  const x = sx(col, row), y = sy(col, row)
  return `${x},${y + TH / 2 - h} ${x + TW / 2},${y - h} ${x + TW / 2},${y} ${x},${y + TH / 2}`
}
function tilePts(col: number, row: number): string {
  const x = sx(col, row), y = sy(col, row)
  return `${x},${y - TH / 2} ${x + TW / 2},${y} ${x},${y + TH / 2} ${x - TW / 2},${y}`
}

// Artifact drawn at world-space (0,0) — translated via SVG transform
const ART_TOP  = `0,${-(TH / 2) - AH} ${TW / 2},${-AH} 0,${TH / 2 - AH} ${-TW / 2},${-AH}`
const ART_LEFT = `${-TW / 2},${-AH} 0,${TH / 2 - AH} 0,${TH / 2} ${-TW / 2},0`
const ART_RIGHT= `0,${TH / 2 - AH} ${TW / 2},${-AH} ${TW / 2},0 0,${TH / 2}`

// ─── Station palette ──────────────────────────────────────────────────────────
const PALETTE: Record<string, {
  idle: { t: string; l: string; r: string }
  working: { t: string; l: string; r: string }
  done: { t: string; l: string; r: string }
  accent: string
}> = {
  maya: {
    idle:    { t: '#a855f7', l: '#6b21a8', r: '#3b0764' },
    working: { t: '#d946ef', l: '#9333ea', r: '#6b21a8' },
    done:    { t: '#c084fc', l: '#4c1d95', r: '#2e1065' },
    accent: '#d946ef',
  },
  nia: {
    idle:    { t: '#3b82f6', l: '#1d4ed8', r: '#1e3a8a' },
    working: { t: '#60a5fa', l: '#2563eb', r: '#1e40af' },
    done:    { t: '#93c5fd', l: '#1e40af', r: '#1e3a8a' },
    accent: '#60a5fa',
  },
  leo: {
    idle:    { t: '#22c55e', l: '#15803d', r: '#14532d' },
    working: { t: '#4ade80', l: '#16a34a', r: '#15803d' },
    done:    { t: '#86efac', l: '#166534', r: '#14532d' },
    accent: '#4ade80',
  },
  tara: {
    idle:    { t: '#f59e0b', l: '#b45309', r: '#78350f' },
    working: { t: '#fbbf24', l: '#d97706', r: '#b45309' },
    done:    { t: '#fde68a', l: '#92400e', r: '#78350f' },
    accent: '#fbbf24',
  },
}

// ─── Station grid positions ───────────────────────────────────────────────────
const GRID: Record<string, { col: number; row: number }> = {
  maya: { col: 1, row: 0 },  // top-left in iso  → screen top-center
  nia:  { col: 4, row: 0 },  // top-right in iso → screen right
  leo:  { col: 1, row: 3 },  // bottom-left      → screen left
  tara: { col: 4, row: 3 },  // bottom-right     → screen bottom-center
}

const ART_GRID: Record<string, { col: number; row: number }> = {
  center:    { col: 2.5, row: 1.5 },
  maya:      GRID.maya,
  nia:       GRID.nia,
  leo:       GRID.leo,
  tara:      GRID.tara,
  delivered: { col: 2.5, row: 4.5 },
}

const JUGNU_ORDER: JugnuKey[] = ['maya', 'nia', 'leo', 'tara']

// ─── World state derivation ───────────────────────────────────────────────────
type DeskState = 'idle' | 'working' | 'done'
type ArtifactPos = keyof typeof ART_GRID

interface WorldState {
  deskStates: Record<string, DeskState>
  artifactPos: ArtifactPos
  activeJugnu: string | null
  isComplete: boolean
  awaitingApproval: boolean
}

function deriveWorldState(events: ReturnType<typeof useProjectEvents>): WorldState {
  const deskStates: Record<string, DeskState> = { maya: 'idle', nia: 'idle', leo: 'idle', tara: 'idle' }
  let artifactPos: ArtifactPos = 'center'
  let activeJugnu: string | null = null
  let isComplete = false
  let awaitingApproval = false

  for (const { event_type, jugnu_key } of events) {
    switch (event_type) {
      case 'TASK_ASSIGNED':
        if (jugnu_key && GRID[jugnu_key]) {
          activeJugnu = jugnu_key
          deskStates[jugnu_key] = 'working'
          artifactPos = jugnu_key as ArtifactPos
          awaitingApproval = false
        }
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
        isComplete = true
        break
      case 'TASK_COMPLETED':
        if (jugnu_key) deskStates[jugnu_key] = 'done'
        break
    }
  }

  return { deskStates, artifactPos, activeJugnu, isComplete, awaitingApproval }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
// Sort keys back-to-front for the painter's algorithm
function isoDepth(col: number, row: number) { return col + row }

// ─── Component ────────────────────────────────────────────────────────────────
export function WorldRenderer({ projectId, jugnus }: Props) {
  const events = useProjectEvents(projectId)
  const { deskStates, artifactPos, activeJugnu, isComplete, awaitingApproval } =
    useMemo(() => deriveWorldState(events), [events])

  const roleFor = (key: JugnuKey) =>
    jugnus.find((j) => j.key === key)?.display_role ?? key.charAt(0).toUpperCase() + key.slice(1)

  // Floor tile grid (cols 0–5, rows 0–4), sorted back-to-front
  const floorTiles = useMemo(() => {
    const tiles: { col: number; row: number }[] = []
    for (let c = 0; c <= 5; c++) {
      for (let r = 0; r <= 4; r++) {
        tiles.push({ col: c, row: r })
      }
    }
    return tiles.sort((a, b) => isoDepth(a.col, a.row) - isoDepth(b.col, b.row))
  }, [])

  // Stations sorted back-to-front
  const sortedKeys = useMemo(() =>
    JUGNU_ORDER.slice().sort(
      (a, b) => isoDepth(GRID[a].col, GRID[a].row) - isoDepth(GRID[b].col, GRID[b].row)
    ), [])

  // Artifact screen position (for the SVG transform)
  const artG = ART_GRID[artifactPos] ?? ART_GRID.center
  const artX = sx(artG.col, artG.row)
  const artY = sy(artG.col, artG.row)

  // Artifact colors
  const artColors = isComplete
    ? { t: '#10b981', l: '#059669', r: '#047857' }
    : awaitingApproval
      ? { t: '#a78bfa', l: '#7c3aed', r: '#5b21b6' }
      : { t: '#e2e8f0', l: '#94a3b8', r: '#64748b' }

  return (
    <div
      className="relative w-full h-full overflow-hidden select-none"
      style={{ background: 'linear-gradient(160deg, #0d1117 0%, #0f172a 60%, #111827 100%)' }}
    >
      {/* Scanline texture overlay for pixel-art feel */}
      <div
        className="absolute inset-0 pointer-events-none z-10"
        style={{
          backgroundImage: 'repeating-linear-gradient(0deg, rgba(0,0,0,0.06) 0px, rgba(0,0,0,0.06) 1px, transparent 1px, transparent 3px)',
        }}
      />

      {/* Main isometric SVG */}
      <svg
        className="absolute inset-0 w-full h-full"
        viewBox={`0 0 ${VW} ${VH}`}
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <filter id="w-glow" x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="w-glow-sm" x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="w-artifact-glow" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="8" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* ── Floor tiles ── */}
        {floorTiles.map(({ col, row }) => {
          // Station tiles get a subtle highlight
          const isStation = JUGNU_ORDER.some((k) => GRID[k].col === col && GRID[k].row === row)
          const isEven = (col + row) % 2 === 0
          return (
            <polygon
              key={`t-${col}-${row}`}
              points={tilePts(col, row)}
              fill={isStation ? '#1e293b' : isEven ? '#161d2b' : '#131929'}
              stroke="#0d1117"
              strokeWidth="0.8"
            />
          )
        })}

        {/* ── Dashed path lines (pipeline flow) ── */}
        {([
          [GRID.maya, GRID.nia],
          [GRID.nia,  GRID.tara],
          [GRID.tara, GRID.leo],
          [GRID.leo,  GRID.maya],
        ] as [typeof GRID[string], typeof GRID[string]][]).map(([from, to], i) => (
          <line
            key={`path-${i}`}
            x1={sx(from.col, from.row)}
            y1={sy(from.col, from.row) - BH}
            x2={sx(to.col, to.row)}
            y2={sy(to.col, to.row) - BH}
            stroke="#1e3a5f"
            strokeWidth="1"
            strokeDasharray="3 5"
            opacity="0.5"
          />
        ))}

        {/* ── Crafting-station blocks (back-to-front) ── */}
        {sortedKeys.map((key) => {
          const g = GRID[key]
          const state = deskStates[key] ?? 'idle'
          const pal = PALETTE[key][state]
          const accent = PALETTE[key].accent
          const isWorking = activeJugnu === key
          const isDone = state === 'done'
          const cx = sx(g.col, g.row)
          const cy = sy(g.col, g.row)

          return (
            <g key={key} filter={isWorking ? 'url(#w-glow)' : undefined}>
              {/* Block body */}
              <polygon points={leftPts(g.col, g.row, BH)}  fill={pal.l} />
              <polygon points={rightPts(g.col, g.row, BH)} fill={pal.r} />
              <polygon points={topPts(g.col, g.row, BH)}   fill={pal.t} />

              {/* Crafting-table cross on top face */}
              <line
                x1={cx} y1={cy - TH / 2 - BH}
                x2={cx} y2={cy + TH / 2 - BH}
                stroke="rgba(0,0,0,0.22)" strokeWidth="1"
              />
              <line
                x1={cx - TW / 2} y1={cy - BH}
                x2={cx + TW / 2} y2={cy - BH}
                stroke="rgba(0,0,0,0.22)" strokeWidth="1"
              />

              {/* Pixel dots on top corners (Minecraft crafting table slots) */}
              {[
                [cx - TW / 4, cy - BH - TH / 4],
                [cx + TW / 4, cy - BH - TH / 4],
                [cx - TW / 4, cy - BH + TH / 4],
                [cx + TW / 4, cy - BH + TH / 4],
              ].map(([rx, ry], i) => (
                <rect key={i} x={rx - 2} y={ry - 2} width={4} height={3}
                  fill="rgba(0,0,0,0.18)" rx="0.5"
                />
              ))}

              {/* Active: pulsing orb on top */}
              {isWorking && (
                <circle cx={cx} cy={cy - BH - 4} r={4} fill={accent} filter="url(#w-glow-sm)">
                  <animate attributeName="r" values="3;6;3" dur="1.4s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="1;0.4;1" dur="1.4s" repeatCount="indefinite" />
                </circle>
              )}

              {/* Done: checkmark glyph */}
              {isDone && (
                <text x={cx} y={cy - BH - 10} textAnchor="middle"
                  fontSize="11" fill={accent} fontFamily="monospace" fontWeight="bold"
                  filter="url(#w-glow-sm)"
                >
                  ✓
                </text>
              )}

              {/* Nameplate below block */}
              <text
                x={cx}
                y={cy + TH / 2 + 13}
                textAnchor="middle"
                fontSize="9"
                fill={isWorking ? accent : isDone ? accent : '#4b5563'}
                fontFamily="monospace"
                fontWeight={isWorking ? 'bold' : 'normal'}
              >
                {key}
              </text>
              <text
                x={cx}
                y={cy + TH / 2 + 23}
                textAnchor="middle"
                fontSize="7.5"
                fill={isWorking ? accent : '#374151'}
                fontFamily="monospace"
                opacity={isWorking || isDone ? 0.85 : 0.5}
              >
                {roleFor(key as JugnuKey)}
              </text>
            </g>
          )
        })}

        {/* ── Artifact block ──
            Use CSS transform (with px) not SVG transform attr so the
            CSS transition actually fires (SVG attr changes are not CSS transitions). */}
        <g
          style={{
            transform: `translate(${artX}px, ${artY}px)`,
            transition: 'transform 0.75s cubic-bezier(0.34, 1.4, 0.64, 1)',
          }}
          filter="url(#w-artifact-glow)"
        >
          <polygon points={ART_LEFT}  fill={artColors.l} />
          <polygon points={ART_RIGHT} fill={artColors.r} />
          <polygon points={ART_TOP}   fill={artColors.t} />

          {/* Artifact label */}
          <text
            y={-AH - 8}
            textAnchor="middle"
            fontSize="8"
            fill={artColors.t}
            fontFamily="monospace"
          >
            {isComplete ? 'delivered ✓' : awaitingApproval ? '👀 review' : '◆ artifact'}
          </text>
        </g>

        {/* ── Delivered zone (visible only when done) ── */}
        {isComplete && (
          <g opacity="0.8">
            <polygon
              points={tilePts(2.5, 4.5)}
              fill="none"
              stroke="#10b981"
              strokeWidth="1.5"
              strokeDasharray="4 3"
              filter="url(#w-glow-sm)"
            />
            <text
              x={sx(2.5, 4.5)}
              y={sy(2.5, 4.5) + TH / 2 + 14}
              textAnchor="middle"
              fontSize="8"
              fill="#10b981"
              fontFamily="monospace"
            >
              delivered
            </text>
          </g>
        )}
      </svg>

      {/* ── Jugnu illustrations (overlay, avoids SVG distortion) ──
          Outer div: static centering via transform (no framer-motion — avoids
          the crash where motion parses % units from style.transform as an
          initial animation value).
          Inner motion.div: ONLY handles the y-bob, no transform in style. */}
      {JUGNU_ORDER.map((key) => {
        const g = GRID[key]
        const isWorking = activeJugnu === key

        const screenX = sx(g.col, g.row)
        const screenY = sy(g.col, g.row) - BH - 60

        return (
          <div
            key={key}
            className="absolute pointer-events-none z-20"
            style={{
              left: (screenX / VW) * 100 + '%',
              top:  (screenY / VH) * 100 + '%',
              transform: 'translate(-50%, -50%)',
            }}
          >
            <motion.div
              animate={isWorking ? { y: [0, -6, 0] } : { y: 0 }}
              transition={
                isWorking
                  ? { duration: 2.2, repeat: Infinity, ease: 'easeInOut' }
                  : { duration: 0.4 }
              }
            >
              <JugnuIllustration jugnuKey={key} size={56} />
            </motion.div>
          </div>
        )
      })}

      {/* ── Legend ── */}
      <div className="absolute bottom-3 right-3 z-20 flex flex-col gap-1.5">
        {([
          { color: '#4b5563', label: 'idle' },
          { color: '#d946ef', label: 'working' },
          { color: '#4ade80', label: 'done'    },
        ] as { color: string; label: string }[]).map(({ color, label }) => (
          <div key={label} className="flex items-center gap-1.5">
            <span
              className="block w-2.5 h-2.5"
              style={{
                background: color,
                clipPath: 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)',
              }}
            />
            <span className="text-[9px] font-mono text-gray-500">{label}</span>
          </div>
        ))}
      </div>

      {/* ── Approval glow ring (pulsing overlay) ── */}
      {awaitingApproval && (
        <div className="absolute inset-0 pointer-events-none z-10">
          <div
            className="absolute"
            style={{
              left: (artX / VW) * 100 + '%',
              top:  (artY / VH) * 100 + '%',
              transform: 'translate(-50%, -50%)',
              width: 80,
              height: 80,
              borderRadius: '50%',
              background: 'radial-gradient(circle, rgba(139,92,246,0.25) 0%, transparent 70%)',
              animation: 'pulse 2s ease-in-out infinite',
            }}
          />
          <style>{`@keyframes pulse { 0%,100%{opacity:0.5;transform:translate(-50%,-50%) scale(1)} 50%{opacity:1;transform:translate(-50%,-50%) scale(1.3)} }`}</style>
        </div>
      )}
    </div>
  )
}
