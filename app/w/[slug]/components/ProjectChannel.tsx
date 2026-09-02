'use client'

import { useEffect, useRef, useState } from 'react'
import { createBrowserClient } from '@/lib/supabase/client'
import { JugnuIllustration } from './JugnuIllustration'

interface Message {
  id: string
  author_type: string
  author_key: string
  content: string
  created_at: string
  metadata: Record<string, unknown>
}

const JUGNU: Record<string, { name: string; color: string; bg: string; dot: string }> = {
  maya: { name: 'Maya', color: '#8b5cf6', bg: '#f5f3ff', dot: '#8b5cf6' },
  nia:  { name: 'Nia',  color: '#ec4899', bg: '#fdf2f8', dot: '#ec4899' },
  leo:  { name: 'Leo',  color: '#06b6d4', bg: '#f0fdfe', dot: '#06b6d4' },
  tara: { name: 'Tara', color: '#10b981', bg: '#f0fdf4', dot: '#10b981' },
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
        {/* You avatar */}
        <div className="shrink-0 w-9 h-9 rounded-full bg-indigo-100 flex items-center justify-center text-xs font-bold text-indigo-600 shadow-sm">
          You
        </div>
      </div>
    )
  }

  // Jugnu message — large illustrated avatar to the left
  const color = j?.color ?? '#6366f1'
  const bg    = j?.bg    ?? '#f5f3ff'
  const name  = j?.name  ?? msg.author_key
  const key   = msg.author_key

  return (
    <div className="flex items-start gap-1 px-4 py-2">
      {/* Large jugnu illustration */}
      <div className="shrink-0 -mt-2">
        <JugnuIllustration jugnuKey={key} size={88} />
      </div>

      {/* Bubble */}
      <div className="flex-1 min-w-0 max-w-lg mt-2">
        {/* Name + status dot + time */}
        <div className="flex items-center gap-1.5 mb-2">
          <span className="text-sm font-bold" style={{ color }}>{name}</span>
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
          <span className="text-xs text-gray-400">
            {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>

        <div
          className="rounded-2xl rounded-tl-sm px-5 py-3.5 text-sm text-gray-700 leading-relaxed shadow-sm whitespace-pre-wrap"
          style={{ backgroundColor: bg }}
        >
          {msg.content}
        </div>
      </div>
    </div>
  )
}

interface Props {
  projectId: string
  userId: string
  initialMessages: Message[]
}

export function ProjectChannel({ projectId, userId, initialMessages }: Props) {
  const [messages, setMessages] = useState<Message[]>(initialMessages)
  const [input, setInput]       = useState('')
  const [sending, setSending]   = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const db  = createBrowserClient()
    const sub = db
      .channel(`project-${projectId}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'messages',
        filter: `project_id=eq.${projectId}`,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }, (payload: any) => setMessages((prev) => [...prev, payload.new as Message]))
      .subscribe()
    return () => { void db.removeChannel(sub) }
  }, [projectId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

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
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex-1 overflow-y-auto py-4 space-y-1">
        {messages.map((m) => <MessageBubble key={m.id} msg={m} />)}
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
          {/* Emoji + @ + attachment icons */}
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
  )
}
