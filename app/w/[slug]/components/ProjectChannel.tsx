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

// ─── Feed grouping ────────────────────────────────────────────────────────────

type JugnuGroup = { type: 'jugnu'; authorKey: string; messages: Message[] }
type SoloItem   = { type: 'system' | 'user'; message: Message }
type FeedItem   = JugnuGroup | SoloItem

function buildFeed(messages: Message[]): FeedItem[] {
  const feed: FeedItem[] = []
  for (const msg of messages) {
    if (msg.author_type === 'activity') continue
    if (msg.author_type === 'jugnu') {
      const last = feed[feed.length - 1]
      if (last?.type === 'jugnu' && last.authorKey === msg.author_key) {
        last.messages.push(msg)
      } else {
        feed.push({ type: 'jugnu', authorKey: msg.author_key, messages: [msg] })
      }
    } else {
      feed.push({ type: msg.author_type as 'system' | 'user', message: msg })
    }
  }
  return feed
}

// ─── TypingBubble ─────────────────────────────────────────────────────────────

function TypingBubble({ jugnuKey, activities }: { jugnuKey: string; activities: string[] }) {
  const j = JUGNU[jugnuKey]
  if (!j) return null

  return (
    <div className="flex items-end gap-1 px-3 py-1.5">
      <div className="shrink-0">
        <JugnuIllustration jugnuKey={jugnuKey} size={80} />
      </div>
      <div className="mb-2 max-w-sm">
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-sm font-bold" style={{ color: j.color }}>{j.name}</span>
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ backgroundColor: j.color + '28', color: j.color }}>
            {j.role}
          </span>
          <span className="text-xs" style={{ color: j.color }}>{j.icon}</span>
        </div>
        <div className="rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm" style={{ backgroundColor: j.bg }}>
          {activities.length > 0 && (
            <div className="mb-2.5 max-h-28 overflow-y-auto space-y-1.5">
              {activities.map((a, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <span className="shrink-0 block w-1.5 h-1.5 rounded-full" style={{ backgroundColor: j.color, opacity: i === activities.length - 1 ? 1 : 0.35 }} />
                  <span className="text-xs font-mono" style={{ color: j.color, opacity: i === activities.length - 1 ? 0.9 : 0.45 }}>{a}</span>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-center gap-1.5">
            {[0, 1, 2].map((i) => (
              <span key={i} className="block w-2 h-2 rounded-full" style={{ backgroundColor: j.color, animation: `jugnu-bounce 1.2s ease-in-out ${i * 0.2}s infinite` }} />
            ))}
            <span className="text-xs ml-1" style={{ color: j.color, opacity: 0.6 }}>
              {activities.length === 0 ? 'thinking…' : 'working…'}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Single message bubble (no avatar — used inside JugnuSection) ─────────────

function MessageContent({ msg, color, bg }: { msg: Message; color: string; bg: string }) {
  return (
    <div className="flex items-start gap-3 py-0.5">
      <div className="flex-1 min-w-0 max-w-lg">
        <div
          className="rounded-2xl rounded-tl-sm px-5 py-3.5 shadow-sm overflow-y-auto"
          style={{ backgroundColor: bg, maxHeight: 360 }}
        >
          <div className="jugnu-markdown">
            <ReactMarkdown>{msg.content}</ReactMarkdown>
          </div>
        </div>
        <span className="text-[10px] text-gray-400 mt-1 ml-1">
          {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
    </div>
  )
}

// ─── Jugnu section with sticky header ─────────────────────────────────────────

function JugnuSection({ authorKey, messages }: { authorKey: string; messages: Message[] }) {
  const j = JUGNU[authorKey]
  if (!j) return null

  return (
    <div className="relative">
      {/* Section header — sticks to top of scroll container while messages scroll past */}
      <div
        className="sticky top-0 z-10 flex items-center gap-3 px-4 py-2.5 border-b border-gray-100/80"
        style={{
          backgroundColor: 'rgba(255,255,255,0.88)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
        }}
      >
        <div className="shrink-0 -my-1">
          <JugnuIllustration jugnuKey={authorKey} size={56} />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-bold" style={{ color: j.color }}>{j.name}</span>
          <span
            className="text-xs font-semibold px-2.5 py-0.5 rounded-full"
            style={{ backgroundColor: j.color + '28', color: j.color }}
          >
            {j.role}
          </span>
          <span className="text-sm" style={{ color: j.color }}>{j.icon}</span>
          <span className="text-xs text-gray-400">
            {new Date(messages[0].created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
      </div>

      {/* Messages — left-padded, no avatar */}
      <div className="px-5 pl-16 pt-2 pb-5 space-y-3">
        {messages.map((msg) => (
          <MessageContent key={msg.id} msg={msg} color={j.color} bg={j.bg} />
        ))}
      </div>
    </div>
  )
}

// ─── System / User standalone items ──────────────────────────────────────────

function SystemItem({ msg }: { msg: Message }) {
  return (
    <div className="flex justify-center my-3 px-4">
      <span className="text-xs text-gray-400 bg-gray-100 rounded-full px-4 py-1.5">{msg.content}</span>
    </div>
  )
}

function UserItem({ msg }: { msg: Message }) {
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

// ─── ProjectChannel ───────────────────────────────────────────────────────────

interface Props {
  projectId: string
  userId: string
  initialMessages: Message[]
  activeJugnuKey: string | null
}

export function ProjectChannel({ projectId, userId, initialMessages, activeJugnuKey: initialActive }: Props) {
  const [messages, setMessages]       = useState<Message[]>(initialMessages)
  const [activeJugnu, setActiveJugnu] = useState<string | null>(initialActive)
  const [activities, setActivities]   = useState<string[]>([])
  const [input, setInput]             = useState('')
  const [sending, setSending]         = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const db = createBrowserClient()

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
        if (msg.author_type === 'jugnu') setActivities([])
        setMessages((prev) => prev.find((m) => m.id === msg.id) ? prev : [...prev, msg])
      })
      .subscribe()

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

  const feed = buildFeed(messages)

  return (
    <>
      <style>{`
        @keyframes jugnu-bounce {
          0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
          40% { transform: translateY(-6px); opacity: 1; }
        }
      `}</style>

      <div className="flex-1 flex flex-col min-h-0">
        <div className="flex-1 overflow-y-auto py-4">
          {feed.map((item, i) => {
            if (item.type === 'jugnu') {
              return <JugnuSection key={`${item.authorKey}-${i}`} authorKey={item.authorKey} messages={item.messages} />
            }
            if (item.type === 'system') {
              return <SystemItem key={item.message.id} msg={item.message} />
            }
            return <UserItem key={item.message.id} msg={item.message} />
          })}

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
