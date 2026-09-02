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

const JUGNU_COLORS: Record<string, string> = {
  maya: '#8b5cf6',
  nia:  '#ec4899',
  leo:  '#06b6d4',
  tara: '#10b981',
}

const JUGNU_NAMES: Record<string, string> = {
  maya: 'Maya',
  nia:  'Nia',
  leo:  'Leo',
  tara: 'Tara',
}

function MessageBubble({ msg, userId }: { msg: Message; userId: string }) {
  const isUser = msg.author_type === 'user'
  const isSystem = msg.author_type === 'system'
  const jugnu = JUGNU_NAMES[msg.author_key]
  const color = JUGNU_COLORS[msg.author_key]

  if (isSystem) {
    return (
      <div className="flex justify-center my-1">
        <span className="text-xs text-gray-400 bg-gray-100 rounded-full px-3 py-1">{msg.content}</span>
      </div>
    )
  }

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-lg bg-indigo-600 text-white rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm">
          {msg.content}
        </div>
      </div>
    )
  }

  // Jugnu message
  const initials = (jugnu ?? msg.author_key).slice(0, 2).toUpperCase()
  return (
    <div className="flex items-start gap-3">
      <div
        className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white"
        style={{ backgroundColor: color ?? '#6366f1' }}
      >
        {initials}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold mb-1" style={{ color: color ?? '#6366f1' }}>
          {jugnu ?? msg.author_key}
          <span className="text-gray-400 font-normal ml-2">
            {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        </p>
        <div className="bg-white border border-gray-200 rounded-2xl rounded-tl-sm px-4 py-2.5 text-sm text-gray-800 whitespace-pre-wrap">
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
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  // Real-time subscription
  useEffect(() => {
    const db = createBrowserClient()
    const sub = db
      .channel(`project-${projectId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `project_id=eq.${projectId}`,
      }, (payload: { new: Message }) => {
        setMessages((prev) => [...prev, payload.new])
      })
      .subscribe()
    return () => { void db.removeChannel(sub) }
  }, [projectId])

  // Auto-scroll
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
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {messages.map((m) => (
          <MessageBubble key={m.id} msg={m} userId={userId} />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="shrink-0 border-t border-gray-200 px-4 py-3 bg-white">
        <div className="flex items-end gap-2 border border-gray-300 rounded-xl px-3 py-2 focus-within:border-indigo-500 transition-colors">
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
            className="shrink-0 px-4 py-1.5 text-sm font-medium rounded-lg text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {sending ? '…' : 'Send'}
          </button>
        </div>
        <p className="text-xs text-gray-400 mt-1">Enter to send · Shift+Enter for new line</p>
      </div>
    </div>
  )
}
