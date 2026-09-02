'use client'

import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { createBrowserClient } from '@/lib/supabase/client'
import { JugnuIllustration } from './JugnuIllustration'

interface Message {
  id: string
  project_id: string
  author_type: string
  author_key: string
  content: string
  created_at: string
  metadata: Record<string, unknown>
}

const JUGNU: Record<string, { name: string; color: string; bg: string; role: string; icon: string }> = {
  maya: { name: 'Maya', color: '#f472b6', bg: '#fdf2f8', role: 'Planner',  icon: '🎯' },
  nia:  { name: 'Nia',  color: '#60a5fa', bg: '#eff6ff', role: 'Designer', icon: '🎨' },
  leo:  { name: 'Leo',  color: '#4ade80', bg: '#f0fdf4', role: 'Builder',  icon: '</>' },
  tara: { name: 'Tara', color: '#fb923c', bg: '#fff7ed', role: 'Reviewer', icon: '✓'  },
}

function TypingBubble({ jugnuKey, activities }: { jugnuKey: string; activities: string[] }) {
  const j = JUGNU[jugnuKey]
  if (!j) return null
  const color = j.color

  return (
    <div className="flex items-end gap-1 px-3 py-1.5">
      <div className="shrink-0">
        <JugnuIllustration jugnuKey={jugnuKey} size={80} />
      </div>
      <div className="mb-2 max-w-sm">
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-sm font-bold" style={{ color }}>{j.name}</span>
          <span
            className="text-xs font-semibold px-2 py-0.5 rounded-full"
            style={{ backgroundColor: color + '28', color }}
          >
            {j.role}
          </span>
          <span className="text-xs" style={{ color }}>{j.icon}</span>
        </div>

        <div
          className="rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm"
          style={{ backgroundColor: j.bg }}
        >
          {/* Activity log — scrollable, max 5 lines */}
          {activities.length > 0 && (
            <div className="mb-2.5 max-h-28 overflow-y-auto space-y-1.5">
              {activities.map((a, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <span
                    className="shrink-0 block w-1.5 h-1.5 rounded-full"
                    style={{ backgroundColor: color, opacity: i === activities.length - 1 ? 1 : 0.35 }}
                  />
                  <span
                    className="text-xs font-mono"
                    style={{ color, opacity: i === activities.length - 1 ? 0.9 : 0.45 }}
                  >
                    {a}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Animated dots */}
          <div className="flex items-center gap-1.5">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="block w-2 h-2 rounded-full"
                style={{
                  backgroundColor: color,
                  animation: `jugnu-bounce 1.2s ease-in-out ${i * 0.2}s infinite`,
                }}
              />
            ))}
            <span className="text-xs ml-1" style={{ color, opacity: 0.6 }}>
              {activities.length === 0 ? 'thinking…' : 'working…'}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

function MessageBubble({ msg }: { msg: Message }) {
  const isUser   = msg.author_type === 'user'
  const isSystem = msg.author_type === 'system'
  const j = JUGNU[msg.author_key]

  if (isSystem) {
    return (
      <div className="flex justify-center my-3">
        <span className="text-xs text-gray-400 bg-gray-100 rounded-full px-4 py-1.5">{msg.content}</span>
      </div>
    )
  }

  if (isUser) {
    return (
      <div className="flex items-end gap-3 justify-end px-8 py-1">
        <div className="max-w-md bg-indigo-600 text-white rounded-2xl rounded-br-sm px-5 py-3 text-sm leading-relaxed shadow-sm">
          {msg.content}
        </div>
        <div className="shrink-0 w-9 h-9 rounded-full bg-indigo-100 flex items-center justify-center text-xs font-bold text-indigo-600 shadow-sm">
          You
        </div>
      </div>
    )
  }

  const color = j?.color ?? '#a78bfa'
  const bg    = j?.bg    ?? '#f5f3ff'
  const name  = j?.name  ?? msg.author_key
  const role  = j?.role  ?? 'Agent'
  const icon  = j?.icon  ?? '✦'
  const key   = msg.author_key

  return (
    <div className="flex items-start gap-1 px-3 py-1.5">
      <div className="shrink-0">
        <JugnuIllustration jugnuKey={key} size={120} />
      </div>

      <div className="flex-1 min-w-0 max-w-lg mt-8">
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <span className="text-base font-bold" style={{ color }}>{name}</span>
          <span
            className="text-xs font-semibold px-2.5 py-0.5 rounded-full"
            style={{ backgroundColor: color + '28', color }}
          >
            {role}
          </span>
          <span className="text-sm" style={{ color }}>{icon}</span>
          <span className="text-xs text-gray-400 ml-0.5">
            {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>

        {/* Markdown-rendered message in a neat scrollable box (max ~320px before scroll) */}
        <div
          className="rounded-2xl rounded-tl-sm px-5 py-3.5 shadow-sm overflow-y-auto"
          style={{ backgroundColor: bg, maxHeight: 360 }}
        >
          <div className="jugnu-markdown">
            <ReactMarkdown>{msg.content}</ReactMarkdown>
          </div>
        </div>
      </div>
    </div>
  )
}

interface Props {
  projectId: string
  userId: string
  initialMessages: Message[]
  activeJugnuKey: string | null
}

export function ProjectChannel({ projectId, userId, initialMessages, activeJugnuKey: initialActive }: Props) {
  const [messages, setMessages]       = useState<Message[]>(initialMessages)
  const [activeJugnu, setActiveJugnu] = useState<string | null>(initialActive)
  // Activity log: keyed by jugnu, shows what the current jugnu is doing
  const [activities, setActivities]   = useState<string[]>([])
  const [input, setInput]             = useState('')
  const [sending, setSending]         = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const db = createBrowserClient()

    // Subscribe to new messages — deduplicate; route activity messages to the activity log
    const msgSub = db
      .channel(`project-messages-${projectId}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'messages',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }, (payload: any) => {
        const msg = payload.new as Message
        if (msg.project_id !== projectId) return
        if (msg.author_type === 'activity') {
          setActivities((prev) => [...prev, msg.content])
          return
        }
        // Non-activity: jugnu finished, clear the activity log
        if (msg.author_type === 'jugnu') setActivities([])
        setMessages((prev) => prev.find((m) => m.id === msg.id) ? prev : [...prev, msg])
      })
      .subscribe()

    // Track which jugnu is working for the typing indicator
    const jugnuSub = db
      .channel(`project-jugnu-typing-${projectId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'jugnus' },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (payload: any) => {
          const j = payload.new as { key: string; status: string }
          if (j.status === 'working') setActiveJugnu(j.key)
          else setActiveJugnu((prev) => prev === j.key ? null : prev)
        })
      .subscribe()

    // Re-fetch to fill gap between SSR and subscription setup
    db.from('messages')
      .select('id,project_id,author_type,author_key,content,created_at,metadata')
      .eq('project_id', projectId)
      .order('created_at', { ascending: true })
      .limit(100)
      .then(({ data }) => {
        if (data?.length) {
          setMessages((prev) => {
            const seen = new Set(prev.map((m) => m.id))
            const merged = [
              ...prev,
              ...(data as Message[]).filter((m) => !seen.has(m.id)),
            ].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
            return merged.length === prev.length ? prev : merged
          })
        }
      })

    return () => {
      void db.removeChannel(msgSub)
      void db.removeChannel(jugnuSub)
    }
  }, [projectId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, activeJugnu])

  const send = async () => {
    const content = input.trim()
    if (!content || sending) return
    setSending(true)
    setInput('')
    await fetch('/api/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, content, userId }),
    })
    setSending(false)
  }

  return (
    <>
      {/* Bounce keyframes injected once */}
      <style>{`
        @keyframes jugnu-bounce {
          0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
          40% { transform: translateY(-6px); opacity: 1; }
        }
      `}</style>

      <div className="flex-1 flex flex-col min-h-0">
        <div className="flex-1 overflow-y-auto py-4 space-y-1">
          {messages
            .filter((m) => m.author_type !== 'activity')
            .map((m) => <MessageBubble key={m.id} msg={m} />)}

          {/* Live typing indicator — shows while a jugnu is actively working */}
          {activeJugnu && <TypingBubble jugnuKey={activeJugnu} activities={activities} />}

          <div ref={bottomRef} />
        </div>

        {/* Input bar */}
        <div className="shrink-0 border-t border-gray-100 px-6 py-4">
          <div className="flex items-center gap-3 bg-gray-50 border border-gray-200 rounded-2xl px-5 py-3 focus-within:border-indigo-400 focus-within:bg-white transition-all shadow-sm">
            <textarea
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() } }}
              placeholder={`Message #${projectId.slice(0, 6)}…`}
              className="flex-1 resize-none text-sm text-gray-900 placeholder-gray-400 bg-transparent outline-none leading-5"
              style={{ maxHeight: '120px' }}
              disabled={sending}
            />
            <div className="flex items-center gap-3 text-gray-400">
              <span className="text-base cursor-pointer hover:text-gray-600 select-none">📎</span>
              <span className="text-base cursor-pointer hover:text-gray-600 select-none">😊</span>
              <span className="text-sm cursor-pointer hover:text-gray-600 select-none font-medium">@</span>
            </div>
            <button
              onClick={() => void send()}
              disabled={!input.trim() || sending}
              className="shrink-0 w-9 h-9 rounded-xl flex items-center justify-center bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow"
            >
              <svg className="w-4 h-4 text-white" fill="currentColor" viewBox="0 0 24 24">
                <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
              </svg>
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
