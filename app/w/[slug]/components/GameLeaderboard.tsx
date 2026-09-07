'use client'
import { useEffect, useState } from 'react'

interface ScoreEntry {
  user_id: string
  score: number
  created_at: string
}

type Period = 'today' | 'week' | 'all'

interface Props {
  projectId: string
}

function userLabel(userId: string): string {
  return userId.slice(-4).toUpperCase()
}

export function GameLeaderboard({ projectId: _projectId }: Props) {
  const [period, setPeriod] = useState<Period>('today')
  const [scores, setScores] = useState<ScoreEntry[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/game-scores?period=${period}`)
      .then((r) => r.json())
      .then((data: { scores: ScoreEntry[] }) => {
        setScores((data.scores ?? []).slice(0, 5))
      })
      .catch(() => setScores([]))
      .finally(() => setLoading(false))
  }, [period])

  const periodLabels: Record<Period, string> = { today: 'Today', week: 'Week', all: 'All Time' }

  return (
    <div className="flex flex-col h-full p-4 text-white">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Leaderboard</p>

      {/* Period toggle */}
      <div className="flex gap-1 mb-3">
        {(Object.keys(periodLabels) as Period[]).map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={`flex-1 text-xs py-1 rounded font-medium transition-colors ${
              period === p
                ? 'bg-indigo-500 text-white'
                : 'bg-white/10 text-gray-400 hover:bg-white/20'
            }`}
          >
            {periodLabels[p]}
          </button>
        ))}
      </div>

      {/* Scores */}
      {loading ? (
        <p className="text-xs text-gray-600">Loading…</p>
      ) : scores.length === 0 ? (
        <p className="text-xs text-gray-600">No scores yet. Be the first!</p>
      ) : (
        <div className="flex flex-col gap-2">
          {scores.map((s, i) => (
            <div key={`${s.user_id}-${s.created_at}`} className="flex items-center gap-2">
              <span className="text-xs font-mono text-gray-500 w-4 shrink-0">{i + 1}</span>
              <div className="w-7 h-7 rounded-full bg-indigo-600/60 flex items-center justify-center shrink-0">
                <span className="text-xs font-bold text-indigo-200">{userLabel(s.user_id)}</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                  <div
                    className="h-1.5 rounded-full bg-indigo-400"
                    style={{ width: `${Math.min(100, (s.score / (scores[0]?.score ?? 1)) * 100)}%` }}
                  />
                </div>
              </div>
              <span className="text-xs font-mono text-indigo-300 shrink-0">{s.score}</span>
            </div>
          ))}
        </div>
      )}

      <div className="mt-auto">
        <button className="w-full text-xs text-gray-600 hover:text-gray-400 transition-colors py-2">
          View Full Leaderboard
        </button>
      </div>
    </div>
  )
}
