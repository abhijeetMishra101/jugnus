'use client'

import { useEffect, useRef, useState } from 'react'
import { createBrowserClient } from '@/lib/supabase/client'

interface Message {
  id: string
  author_type: string
  author_key: string
  content: string
  created_at: string
  metadata: Record<string, unknown>
}

const JUGNU: Record<string, { name: string; color: string; bg: string }> = {
  maya: { name: 'Maya',  color: '#8b5cf6', bg: '#f5f3ff' },
  nia:  { name: 'Nia',   color: '#ec4899', bg: '#fdf2f8' },
  leo:  { name: 'Leo',   color: '#06b6d4', bg: '#f0fdfe' },
  tara: { name: 'Tara',  color: '#10b981', bg: '#f0fdf4' },
}

function MessageBubble({ msg }: { msg: Message }) {
  const isUser   = msg.author_type === 'user'
  const isSystem = msg.author_type === 'system'
  const j = JUGNU[msg.author_key]

  if (isSystem) {
    return (
      <div className="flex justify-center my-2">
        <span className="text-xs text-gray-400 bg-gray-100 rounded-full px-3 py-1">{msg.content}</span>
      </div>
    )
  }

  if (isUser) {
    return (
      <div className="flex justify-end px-6">
        <div className="max-w-lg bg-indigo-600 text-white rounded-2xl rounded-tr-sm px-4 py-3 text-sm leading-relaxed shadow-sm">
          {msg.content}
        </div>
      </div>
    )
  }

  // Jugnu message
  const initials = j ? j.name.slice(0, 2).toUpperCase() : msg.author_key.slice(0, 2).toUpperCase()
  const color    = j?.color ?? '#6366f1'
  const bg       = j?.bg    ?? '#f5f3ff'
  const name     = j?.name  ?? msg.author_key

  return (
    <div className="flex items-start gap-3 px-6 group">
      {/* Avatar */}
      <div
        className="shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white shadow-md ring-2 ring-white"
        style={{ backgroundColor: color }}
      >
        {initials}
      </div>

      <div className="flex-1 min-w-0">
        {/* Name + time */}
        <div className="flex items-baseline gap-2 mb-1.5">
          <span className="text-sm font-semibold" style={{ color }}>{name}</span>
          <span className="text-xs text-gray-400">
            {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>

        {/* Bubble */}
        <div
          className="inline-block max-w-lg rounded-2xl rounded-tl-sm px-4 py-3 text-sm text-gray-800 leading-relaxed shadow-sm whitespace-pre-wrap"
          style={{ backgroundColor: bg, borderLeft: `3px solid ${color}33` }}
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
      {/* Messages */}
      <div className="flex-1 overflow-y-auto py-6 space-y-5">
        {messages.map((m) => <MessageBubble key={m.id} msg={m} />)}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="shrink-0 border-t border-gray-100 px-6 py-4">
        <div className="flex items-end gap-3 bg-gray-50 border border-gray-200 rounded-2xl px-4 py-3 focus-within:border-indigo-400 focus-within:bg-white transition-all shadow-sm">
          <textarea
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() } }}
            placeholder="Message your jugnus…"
            className="flex-1 resize-none text-sm text-gray-900 placeholder-gray-400 bg-transparent outline-none leading-5"
            style={{ maxHeight: '120px' }}
            disabled={sending}
          />
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
        <p className="text-xs text-gray-400 mt-1.5 text-center">Enter to send · Shift+Enter for new line</p>
      </div>
    </div>
  )
}
