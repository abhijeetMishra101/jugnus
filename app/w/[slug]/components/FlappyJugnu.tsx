'use client'
import { useEffect, useRef, useState, useCallback } from 'react'

interface Props {
  projectId: string
  userId: string
  approvalRequired: boolean
  projectCompleted: boolean
  onNavigateToChat: () => void
}

interface Obstacle {
  x: number
  gapTop: number
  passed: boolean
}

interface Firefly {
  x: number
  y: number
  collected: boolean
}

interface GameState {
  jugnu: { y: number; vy: number }
  obstacles: Obstacle[]
  fireflies: Firefly[]
  score: number
  speed: number
  frame: number
  phase: 'idle' | 'playing' | 'dead'
}

const CANVAS_W = 480
const CANVAS_H = 300
const JUGNU_X = 80
const JUGNU_W = 40
const JUGNU_H = 40
const GAP = 150
const OBSTACLE_W = 40
const GRAVITY = 0.4
const JUMP_VY = -8

function drawMountains(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = '#1a1240'
  const mountains = [
    [0, 260, 80, 180, 160, 260],
    [100, 260, 200, 150, 300, 260],
    [250, 260, 350, 170, 450, 260],
    [380, 260, 460, 190, 540, 260],
  ]
  for (const pts of mountains) {
    ctx.beginPath()
    ctx.moveTo(pts[0], pts[1])
    ctx.lineTo(pts[2], pts[3])
    ctx.lineTo(pts[4], pts[5])
    ctx.closePath()
    ctx.fill()
  }
}

function drawObstacle(ctx: CanvasRenderingContext2D, obs: Obstacle, canvasH: number) {
  const topH = obs.gapTop
  const botY = obs.gapTop + GAP
  const botH = canvasH - botY

  // Top block
  ctx.fillStyle = '#2d4a1e'
  ctx.fillRect(obs.x, 0, OBSTACLE_W, topH)
  ctx.fillStyle = '#3d6b29'
  ctx.fillRect(obs.x, topH - 14, OBSTACLE_W, 14)
  ctx.fillStyle = '#1a2e11'
  ctx.fillRect(obs.x + OBSTACLE_W - 4, 0, 4, topH)

  // Bottom block
  ctx.fillStyle = '#2d4a1e'
  ctx.fillRect(obs.x, botY, OBSTACLE_W, botH)
  ctx.fillStyle = '#3d6b29'
  ctx.fillRect(obs.x, botY, OBSTACLE_W, 14)
  ctx.fillStyle = '#1a2e11'
  ctx.fillRect(obs.x + OBSTACLE_W - 4, botY, 4, botH)
}

function drawFirefly(ctx: CanvasRenderingContext2D, ff: Firefly, frame: number) {
  if (ff.collected) return
  const pulse = Math.sin(frame * 0.1 + ff.x) * 0.3 + 0.7
  ctx.save()
  ctx.globalAlpha = pulse
  ctx.shadowBlur = 8
  ctx.shadowColor = '#fde68a'
  ctx.fillStyle = '#fbbf24'
  ctx.beginPath()
  ctx.arc(ff.x, ff.y, 5, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

export function FlappyJugnu({ projectId, userId, approvalRequired, projectCompleted, onNavigateToChat }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const gameRef = useRef<GameState>({
    jugnu: { y: CANVAS_H / 2, vy: 0 },
    obstacles: [],
    fireflies: [],
    score: 0,
    speed: 2,
    frame: 0,
    phase: 'idle',
  })
  const rafRef = useRef<number>(0)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const scoreRef = useRef(0)

  const [displayScore, setDisplayScore] = useState(0)
  const [best, setBest] = useState(0)
  const [phase, setPhase] = useState<'idle' | 'playing' | 'dead'>('idle')

  // Load best from localStorage after mount
  useEffect(() => {
    const stored = localStorage.getItem('jugnu_best_score')
    if (stored) setBest(parseInt(stored, 10))
  }, [])

  // Load jugnu image once
  useEffect(() => {
    const img = new Image()
    img.src = '/jugnus/jugnu_nia.png'
    imgRef.current = img
  }, [])

  const submitScore = useCallback(async (score: number) => {
    if (score <= 0) return
    try {
      await fetch('/api/game-scores', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, userId, score }),
      })
    } catch {
      // Score submission failure is non-critical
    }
  }, [projectId, userId])

  const jump = useCallback(() => {
    const g = gameRef.current
    if (g.phase === 'idle') {
      g.phase = 'playing'
      g.jugnu.vy = JUMP_VY
      setPhase('playing')
    } else if (g.phase === 'playing') {
      g.jugnu.vy = JUMP_VY
    } else if (g.phase === 'dead') {
      // Restart
      gameRef.current = {
        jugnu: { y: CANVAS_H / 2, vy: 0 },
        obstacles: [],
        fireflies: [],
        score: 0,
        speed: 2,
        frame: 0,
        phase: 'idle',
      }
      scoreRef.current = 0
      setDisplayScore(0)
      setPhase('idle')
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space') { e.preventDefault(); jump() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [jump])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    function draw() {
      if (!ctx || !canvas) return
      const g = gameRef.current

      // Clear
      ctx.fillStyle = '#1a1035'
      ctx.fillRect(0, 0, CANVAS_W, CANVAS_H)

      // Mountains
      drawMountains(ctx)

      if (g.phase === 'idle') {
        // Draw jugnu centered
        const img = imgRef.current
        if (img?.complete) {
          ctx.save()
          ctx.filter = 'drop-shadow(0 0 6px rgba(250, 200, 50, 0.6))'
          ctx.drawImage(img, JUGNU_X - JUGNU_W / 2, g.jugnu.y - JUGNU_H / 2, JUGNU_W, JUGNU_H)
          ctx.restore()
        }

        ctx.fillStyle = '#e2e8f0'
        ctx.font = 'bold 16px monospace'
        ctx.textAlign = 'center'
        ctx.fillText('Press Space or tap to fly', CANVAS_W / 2, CANVAS_H / 2 - 20)
        ctx.font = '12px monospace'
        ctx.fillStyle = '#94a3b8'
        ctx.fillText(`Best: ${best}`, CANVAS_W / 2, CANVAS_H / 2 + 10)
        return
      }

      if (g.phase === 'playing') {
        g.frame++

        // Physics
        g.jugnu.vy += GRAVITY
        g.jugnu.y += g.jugnu.vy

        // New obstacle every 80 frames
        if (g.frame % 80 === 0) {
          const gapTop = 40 + Math.random() * (CANVAS_H - GAP - 80)
          const obs: Obstacle = { x: CANVAS_W, gapTop, passed: false }
          g.obstacles.push(obs)
          // Firefly in the gap
          const ffY = gapTop + GAP / 2 + (Math.random() - 0.5) * 40
          g.fireflies.push({ x: CANVAS_W + OBSTACLE_W / 2, y: ffY, collected: false })
        }

        // Move obstacles + speed increase
        for (const obs of g.obstacles) {
          obs.x -= g.speed
          if (!obs.passed && obs.x + OBSTACLE_W < JUGNU_X) {
            obs.passed = true
            g.score += 10
          }
        }
        for (const ff of g.fireflies) ff.x -= g.speed

        // Speed ramp every 5 obstacles cleared
        const cleared = g.obstacles.filter((o) => o.passed).length
        g.speed = 2 + Math.floor(cleared / 5) * 0.1

        // Cleanup off-screen
        g.obstacles = g.obstacles.filter((o) => o.x > -OBSTACLE_W)
        g.fireflies = g.fireflies.filter((f) => f.x > -10)

        // Collision detection
        const jx = JUGNU_X - JUGNU_W / 2
        const jy = g.jugnu.y - JUGNU_H / 2

        // Ceiling / floor
        if (g.jugnu.y - JUGNU_H / 2 < 0 || g.jugnu.y + JUGNU_H / 2 > CANVAS_H) {
          g.phase = 'dead'
          setPhase('dead')
          void submitScore(g.score)
          if (g.score > best) {
            setBest(g.score)
            localStorage.setItem('jugnu_best_score', String(g.score))
          }
        }

        // Obstacle AABB
        for (const obs of g.obstacles) {
          if (jx + JUGNU_W > obs.x && jx < obs.x + OBSTACLE_W) {
            const topH = obs.gapTop
            const botY = obs.gapTop + GAP
            if (jy < topH || jy + JUGNU_H > botY) {
              g.phase = 'dead'
              setPhase('dead')
              void submitScore(g.score)
              if (g.score > best) {
                setBest(g.score)
                localStorage.setItem('jugnu_best_score', String(g.score))
              }
            }
          }
        }

        // Firefly collection
        for (const ff of g.fireflies) {
          if (!ff.collected && Math.abs(ff.x - JUGNU_X) < 20 && Math.abs(ff.y - g.jugnu.y) < 20) {
            ff.collected = true
            g.score += 5
          }
        }

        // Draw obstacles
        for (const obs of g.obstacles) drawObstacle(ctx, obs, CANVAS_H)
        // Draw fireflies
        for (const ff of g.fireflies) drawFirefly(ctx, ff, g.frame)

        // Draw jugnu
        const img = imgRef.current
        if (img?.complete) {
          ctx.save()
          ctx.filter = 'drop-shadow(0 0 6px rgba(250, 200, 50, 0.6))'
          ctx.drawImage(img, jx, jy, JUGNU_W, JUGNU_H)
          ctx.restore()
        } else {
          ctx.fillStyle = '#fbbf24'
          ctx.fillRect(jx, jy, JUGNU_W, JUGNU_H)
        }

        // Wings
        const wf = Math.sin(g.frame * 0.3)
        ctx.save()
        ctx.globalAlpha = 0.55
        ctx.fillStyle = '#e2e8f0'
        ctx.beginPath()
        ctx.ellipse(JUGNU_X - 16, g.jugnu.y - 5 + wf * 4, 14, 6, -0.35, 0, Math.PI * 2)
        ctx.fill()
        ctx.beginPath()
        ctx.ellipse(JUGNU_X + 16, g.jugnu.y - 5 + wf * 4, 14, 6, 0.35, 0, Math.PI * 2)
        ctx.fill()
        ctx.restore()

        // Update score display every 10 frames
        if (g.frame % 10 === 0) {
          scoreRef.current = g.score
          setDisplayScore(g.score)
        }

        // HUD
        ctx.fillStyle = '#e2e8f0'
        ctx.font = 'bold 14px monospace'
        ctx.textAlign = 'left'
        ctx.fillText(`Score: ${g.score}`, 12, 24)
        ctx.textAlign = 'right'
        ctx.fillStyle = '#94a3b8'
        ctx.fillText(`Best: ${best}`, CANVAS_W - 12, 24)
      }

      if (g.phase === 'dead') {
        // Final frame — obstacles still shown
        for (const obs of g.obstacles) drawObstacle(ctx, obs, CANVAS_H)

        ctx.fillStyle = 'rgba(0,0,0,0.5)'
        ctx.fillRect(0, 0, CANVAS_W, CANVAS_H)

        ctx.textAlign = 'center'
        ctx.fillStyle = '#f87171'
        ctx.font = 'bold 20px monospace'
        ctx.fillText('Game Over', CANVAS_W / 2, CANVAS_H / 2 - 30)

        ctx.fillStyle = '#e2e8f0'
        ctx.font = '14px monospace'
        ctx.fillText(`Score: ${g.score}`, CANVAS_W / 2, CANVAS_H / 2)
        ctx.fillStyle = '#94a3b8'
        ctx.fillText(`Best: ${Math.max(g.score, best)}`, CANVAS_W / 2, CANVAS_H / 2 + 22)

        ctx.fillStyle = '#818cf8'
        ctx.font = '12px monospace'
        ctx.fillText('Press Space or tap to restart', CANVAS_W / 2, CANVAS_H / 2 + 50)
      }
    }

    function loop() {
      draw()
      rafRef.current = requestAnimationFrame(loop)
    }

    rafRef.current = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(rafRef.current)
  }, [best, submitScore])

  return (
    <div className="relative w-full h-full flex items-center justify-center bg-[#0d0a1e]">
      <canvas
        ref={canvasRef}
        width={CANVAS_W}
        height={CANVAS_H}
        onClick={jump}
        className="cursor-pointer rounded-lg"
        style={{ maxWidth: '100%', maxHeight: '100%', imageRendering: 'pixelated' }}
      />

      {approvalRequired && !projectCompleted && (
        <div className="absolute inset-x-0 top-0 bg-amber-500/90 text-white text-sm font-semibold py-2 px-4 flex items-center justify-between z-10 rounded-t-lg">
          <span>Nia needs your approval</span>
          <button onClick={onNavigateToChat} className="underline text-xs">Review design →</button>
        </div>
      )}

      {projectCompleted && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 z-10 rounded-lg">
          <div className="text-4xl mb-2">✨</div>
          <p className="text-white font-bold text-lg">Your Jugnus finished!</p>
          <p className="text-gray-300 text-sm mt-1">Check the chat for your deliverable</p>
          <button
            onClick={onNavigateToChat}
            className="mt-4 px-4 py-2 bg-indigo-500 text-white rounded-lg text-sm hover:bg-indigo-600 transition-colors"
          >
            See the result →
          </button>
        </div>
      )}

      {/* Score display outside canvas for React-managed state */}
      <div className="absolute top-2 right-2 text-xs font-mono text-gray-500 z-10">
        {phase === 'playing' && <span>Score: {displayScore}</span>}
      </div>
    </div>
  )
}
