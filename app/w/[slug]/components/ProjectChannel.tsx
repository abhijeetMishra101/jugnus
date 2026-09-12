'use client'

import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import { createBrowserClient } from '@/lib/supabase/client'
import { JugnuIllustration } from './JugnuIllustration'
import { useProjectEvents } from '../hooks/useProjectEvents'

interface Attachment {
  url: string
  name: string
  type: string
  size: number
  isImage: boolean
  textContent?: string | null
}

interface Message {
  id: string
  project_id: string
  author_type: string
  author_key: string
  content: string
  created_at: string
  metadata: Record<string, unknown>
}

function AttachmentChip({ att, onRemove }: { att: Attachment; onRemove?: () => void }) {
  if (att.isImage) {
    return (
      <div className="relative inline-block">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={att.url} alt={att.name} className="h-20 w-20 object-cover rounded-xl border border-white/20 shadow" />
        {onRemove && (
          <button onClick={onRemove} className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-black/70 text-white/80 flex items-center justify-center text-xs hover:bg-black transition-colors">×</button>
        )}
      </div>
    )
  }
  return (
    <div className="relative flex items-center gap-2 px-3 py-2 rounded-xl text-xs text-white/80" style={{ background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)' }}>
      <svg className="w-4 h-4 shrink-0 text-white/50" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path d="M9 2H4a1 1 0 00-1 1v10a1 1 0 001 1h8a1 1 0 001-1V6L9 2z" strokeLinecap="round" strokeLinejoin="round"/>
        <path d="M9 2v4h4" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
      <a href={att.url} target="_blank" rel="noopener noreferrer" className="truncate max-w-[120px] hover:text-white">{att.name}</a>
      <span className="text-white/30">{(att.size / 1024).toFixed(0)}KB</span>
      {onRemove && (
        <button onClick={onRemove} className="ml-1 text-white/40 hover:text-white/80 transition-colors">×</button>
      )}
    </div>
  )
}

const JUGNU: Record<string, { name: string; color: string; bg: string; role: string; icon: string }> = {
  maya: { name: 'Maya', color: '#f9a8d4', bg: 'rgba(35, 12, 45, 0.82)', role: 'Planner',  icon: '🎯' },
  nia:  { name: 'Nia',  color: '#93c5fd', bg: 'rgba(10, 22, 50, 0.82)', role: 'Designer', icon: '🎨' },
  leo:  { name: 'Leo',  color: '#86efac', bg: 'rgba(8,  28, 18, 0.82)', role: 'Builder',  icon: '</>' },
  tara: { name: 'Tara', color: '#fdba74', bg: 'rgba(30, 14, 6,  0.82)', role: 'Reviewer', icon: '✓'  },
}

// Stagger each jugnu's float phase so they never oscillate in lockstep
const FLOAT_DELAY: Record<string, string> = {
  maya: '0s',
  nia:  '0.65s',
  leo:  '1.3s',
  tara: '1.95s',
}

// ─── Feed grouping ────────────────────────────────────────────────────────────

// isNew = first message of this section arrived via Realtime (not from initial load)
type JugnuGroup = { type: 'jugnu'; authorKey: string; messages: Message[]; isNew: boolean }
type SoloItem   = { type: 'system' | 'user'; message: Message }
type FeedItem   = JugnuGroup | SoloItem

function buildFeed(messages: Message[], initialIds: Set<string>): FeedItem[] {
  const feed: FeedItem[] = []
  for (const msg of messages) {
    if (msg.author_type === 'activity') continue
    if (msg.author_type === 'jugnu') {
      const last = feed[feed.length - 1]
      if (last?.type === 'jugnu' && last.authorKey === msg.author_key) {
        last.messages.push(msg)
      } else {
        feed.push({ type: 'jugnu', authorKey: msg.author_key, messages: [msg], isNew: !initialIds.has(msg.id) })
      }
    } else {
      feed.push({ type: msg.author_type as 'system' | 'user', message: msg })
    }
  }
  return feed
}

// ─── TypingBubble ─────────────────────────────────────────────────────────────

const THINKING_PHRASES = [
  'Reading the brief…',
  'Thinking it through…',
  'Considering options…',
  'Almost there…',
  'Crafting a response…',
  'Putting it together…',
]

function TypingBubble({ jugnuKey, activities }: { jugnuKey: string; activities: string[] }) {
  const j = JUGNU[jugnuKey]
  const [phraseIdx, setPhraseIdx] = useState(0)

  useEffect(() => {
    const id = setInterval(() => setPhraseIdx((p) => (p + 1) % THINKING_PHRASES.length), 3000)
    return () => clearInterval(id)
  }, [])

  if (!j) return null

  const lastActivity = activities[activities.length - 1]

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
        <div className="rounded-2xl rounded-tl-sm px-4 py-3 shadow-sm" style={{ backgroundColor: j.bg, border: `1px solid ${j.color}22` }}>
          {lastActivity && (
            <p className="text-xs font-mono mb-2.5" style={{ color: j.color, opacity: 0.8 }}>{lastActivity}</p>
          )}
          <div className="flex items-center gap-1.5">
            {[0, 1, 2].map((i) => (
              <span key={i} className="block w-2 h-2 rounded-full" style={{ backgroundColor: j.color, animation: `jugnu-bounce 1.2s ease-in-out ${i * 0.2}s infinite` }} />
            ))}
            {!lastActivity && (
              <span className="text-xs ml-1.5" style={{ color: j.color, opacity: 0.5 }}>
                {THINKING_PHRASES[phraseIdx]}
              </span>
            )}
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
          className="rounded-2xl rounded-tl-sm px-5 py-3.5 shadow-sm"
          style={{ backgroundColor: bg }}
        >
          <div className="jugnu-markdown">
            <ReactMarkdown>{msg.content}</ReactMarkdown>
          </div>
        </div>
        <span className="text-[10px] text-white/40 mt-1 ml-1">
          {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>
      </div>
    </div>
  )
}

// ─── Jugnu section — illustration sticky on the left ─────────────────────────

function JugnuSection({ authorKey, messages, isNew, pendingMsgId, projectId, userId }: {
  authorKey: string; messages: Message[]; isNew: boolean
  pendingMsgId: string | null; projectId: string; userId: string
}) {
  const j = JUGNU[authorKey]
  if (!j) return null

  // Two nested wrappers so fly-in and float transforms don't overwrite each other.
  // Outer: sticky positioning + one-shot fly-in (new sections only).
  // Inner: continuous float — delayed until fly-in finishes for new sections.
  const floatDelay  = FLOAT_DELAY[authorKey] ?? '0s'
  const flyDuration = 1.4

  return (
    <div className="flex items-start gap-1 px-3 py-1.5">
      <div
        className="shrink-0 self-start sticky top-4"
        style={isNew ? { animation: `jugnu-fly-in ${flyDuration}s cubic-bezier(0.22,1,0.36,1) forwards`, willChange: 'transform' } : {}}
      >
        <div style={{ animation: `jugnu-float 2.6s ease-in-out ${isNew ? `${flyDuration}s` : floatDelay} infinite` }}>
          <JugnuIllustration jugnuKey={authorKey} size={120} />
        </div>
      </div>

      {/* Right column: name + role shown once, then all messages stacked */}
      <div className="flex-1 min-w-0 max-w-lg mt-8">
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <span className="text-base font-bold" style={{ color: j.color }}>{j.name}</span>
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

        <div className="space-y-3">
          {messages.map((msg, i) => {
            const meta = (msg.metadata ?? {}) as Record<string, unknown>
            const isClarification = msg.id === pendingMsgId && meta.event_type === 'CLARIFICATION_REQUIRED'
            const questions = isClarification
              ? (meta.questions as ClarificationQuestion[] | undefined) ?? []
              : []
            return (
              <div key={msg.id}>
                <div
                  className="rounded-2xl rounded-tl-sm px-5 py-3.5 shadow-sm jugnu-dark-bubble"
                  style={{ backgroundColor: j.bg, border: `1px solid ${j.color}22` }}
                >
                  {isClarification && questions.length > 0 ? (
                    <InlineClarification
                      questions={questions}
                      projectId={projectId}
                      userId={userId}
                      accentColor={j.color}
                    />
                  ) : (
                    <div className="jugnu-markdown" style={{ color: 'rgba(240,240,255,0.92)' }}>
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    </div>
                  )}
                </div>
                {i > 0 && (
                  <span className="block text-[10px] text-white/40 mt-0.5 ml-1">
                    {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ─── System / User standalone items ──────────────────────────────────────────

function SystemItem({ msg }: { msg: Message }) {
  const meta = (msg.metadata ?? {}) as Record<string, unknown>
  const deployUrl = meta.deploy_url as string | null | undefined
  const isCompleted = meta.event_type === 'PROJECT_COMPLETED' && deployUrl

  const label = isCompleted
    ? '✨ All tasks completed. Your Jugnus finished the project.'
    : msg.content

  return (
    <div className="flex flex-col items-center gap-2 my-3 px-4">
      <span className="text-xs text-white/70 rounded-full px-4 py-1.5" style={{ background: 'rgba(0,0,0,0.45)', backdropFilter: 'blur(6px)' }}>{label}</span>
      {isCompleted && (
        <a
          href={deployUrl!}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-xs font-medium px-4 py-1.5 rounded-full transition-opacity hover:opacity-80"
          style={{ background: 'rgba(99,102,241,0.55)', color: '#c7d2fe', backdropFilter: 'blur(6px)', border: '1px solid rgba(99,102,241,0.4)' }}
        >
          <svg className="w-3 h-3" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M6 3H3a1 1 0 00-1 1v9a1 1 0 001 1h9a1 1 0 001-1v-3M10 2h4m0 0v4m0-4L7 9" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          View Preview
        </a>
      )}
    </div>
  )
}

function UserItem({ msg }: { msg: Message }) {
  const attachments = (msg.metadata?.attachments ?? []) as Attachment[]
  return (
    <div className="flex items-end gap-3 justify-end px-8 py-1">
      <div className="flex flex-col items-end gap-2 max-w-md">
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 justify-end">
            {attachments.map((att, i) => <AttachmentChip key={i} att={att} />)}
          </div>
        )}
        {msg.content && (
          <div className="bg-indigo-600 text-white rounded-2xl rounded-br-sm px-5 py-3 text-sm leading-relaxed shadow-sm">
            {msg.content}
          </div>
        )}
      </div>
      <div className="shrink-0 w-9 h-9 rounded-full bg-indigo-100 flex items-center justify-center text-xs font-bold text-indigo-600 shadow-sm">
        You
      </div>
    </div>
  )
}

// ─── DesignPreviewCard ───────────────────────────────────────────────────────

function DesignPreviewCard({ projectId, isRevising }: { projectId: string; isRevising: boolean }) {
  return (
    <div className="ml-[136px] mr-6 mb-3">
      <div className={`rounded-2xl border overflow-hidden shadow-sm transition-all ${isRevising ? 'border-amber-200 bg-white' : 'border-blue-100 bg-white'}`}>
        {/* Scaled iframe thumbnail */}
        <div className="relative w-full overflow-hidden" style={{ height: 220 }}>
          <iframe
            src={`/preview/design/${projectId}`}
            title="Design preview"
            className="border-0 pointer-events-none"
            style={{
              width: '250%',
              height: '550px',
              transform: 'scale(0.4)',
              transformOrigin: 'top left',
            }}
          />
          {isRevising && (
            <div className="absolute inset-0 bg-white/60 backdrop-blur-[2px] flex items-center justify-center">
              <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-full px-4 py-2 shadow-sm">
                <span className="block w-2 h-2 rounded-full bg-amber-400" style={{ animation: 'jugnu-bounce 1.2s ease-in-out infinite' }} />
                <span className="text-xs font-semibold text-amber-700">Nia is updating the design…</span>
              </div>
            </div>
          )}
        </div>
        <div className={`px-4 py-3 flex items-center justify-between border-t ${isRevising ? 'border-amber-100 bg-amber-50' : 'border-blue-100 bg-blue-50'}`}>
          <div className="flex items-center gap-2">
            <span>🎨</span>
            <span className="text-sm font-semibold text-gray-800">Nia&apos;s design</span>
            <span className={`text-xs ${isRevising ? 'text-amber-600 font-medium' : 'text-gray-400'}`}>
              {isRevising ? 'being revised' : 'ready for review'}
            </span>
          </div>
          {!isRevising && (
            <a
              href={`/preview/design/${projectId}`}
              target="_blank"
              rel="noreferrer"
              className="text-xs font-semibold text-blue-600 hover:text-blue-800 transition-colors"
            >
              Open full design →
            </a>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── ApprovalCard ────────────────────────────────────────────────────────────

function ApprovalCard({ projectId, taskId }: { projectId: string; taskId: string | null }) {
  const [feedback, setFeedback] = useState('')
  const [showFeedback, setShowFeedback] = useState(false)
  const [loading, setLoading] = useState<'approved' | 'changes' | null>(null)

  const submit = async (verdict: 'approved' | 'changes') => {
    setLoading(verdict)
    await fetch(`/api/projects/${projectId}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ verdict, feedback: verdict === 'changes' ? feedback : undefined, taskId }),
    })
    setLoading(null)
    setShowFeedback(false)
    setFeedback('')
  }

  return (
    // relative gives this div position:relative so it sits in the same CSS stacking layer
    // as the absolute wallpaper background (layer 4) and paints on top due to DOM order.
    <div className="relative mx-6 mb-4 rounded-2xl overflow-hidden" style={{ background: 'rgba(15, 20, 50, 0.88)', backdropFilter: 'blur(14px)', border: '1px solid rgba(139,92,246,0.35)' }}>
      <div className="px-5 py-4">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-lg">👀</span>
          <p className="text-sm font-semibold text-white/90">Ready for your review</p>
        </div>
        <p className="text-xs text-white/50 mb-4">
          Approve the direction or share feedback for Nia to revise.
        </p>

        {showFeedback ? (
          <div className="space-y-3">
            <textarea
              autoFocus
              rows={3}
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              placeholder="What should be changed or clarified?"
              className="w-full text-sm rounded-xl px-4 py-2.5 resize-none outline-none text-white/90 placeholder-white/30 transition-colors"
              style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(139,92,246,0.4)' }}
            />
            <div className="flex gap-2">
              <button
                onClick={() => void submit('changes')}
                disabled={!feedback.trim() || loading !== null}
                className="flex-1 py-2 rounded-xl text-sm font-medium bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-40 transition-colors"
              >
                {loading === 'changes' ? 'Sending…' : 'Send feedback'}
              </button>
              <button
                onClick={() => { setShowFeedback(false); setFeedback('') }}
                className="px-4 py-2 rounded-xl text-sm font-medium text-white/50 hover:text-white/80 transition-colors"
                style={{ border: '1px solid rgba(255,255,255,0.15)' }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="flex gap-2">
            <button
              onClick={() => void submit('approved')}
              disabled={loading !== null}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-40 transition-colors shadow-sm"
            >
              {loading === 'approved' ? 'Approving…' : '✅ Approve & Build'}
            </button>
            <button
              onClick={() => setShowFeedback(true)}
              disabled={loading !== null}
              className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-violet-300 hover:text-violet-200 disabled:opacity-40 transition-colors"
              style={{ border: '1px solid rgba(139,92,246,0.4)' }}
            >
              ✏️ Request changes
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Inline clarification form — rendered inside Maya's bubble ────────────────

interface ClarificationQuestion { text: string; options: string[] }

function InlineClarification({
  questions, projectId, userId, accentColor,
}: { questions: ClarificationQuestion[]; projectId: string; userId: string; accentColor: string }) {
  const [selected, setSelected] = useState<Record<number, Set<string>>>({})
  const [custom, setCustom]     = useState<Record<number, string>>({})
  const [sending, setSending]   = useState(false)

  const isOther = (opt: string) =>
    opt.toLowerCase().includes('other') || opt.toLowerCase().includes('something else')

  const toggle = (qi: number, opt: string) => {
    setSelected((prev) => {
      const s = new Set(prev[qi] ?? [])
      if (s.has(opt)) s.delete(opt); else s.add(opt)
      return { ...prev, [qi]: s }
    })
  }

  const canSubmit = questions.every((_, qi) => {
    const sel = selected[qi] ?? new Set<string>()
    if (sel.size === 0) return false
    if ([...sel].some(isOther)) return (custom[qi]?.trim() ?? '').length > 0
    return true
  })

  const submit = async () => {
    setSending(true)
    const parts = questions.map((q, qi) => {
      const sel = [...(selected[qi] ?? [])]
      const customVal = custom[qi]?.trim()
      const answers = [
        ...sel.filter((o) => !isOther(o)),
        ...(sel.some(isOther) && customVal ? [customVal] : []),
      ]
      return `${qi + 1}. ${answers.join(', ') || '(no answer)'}`
    })
    await fetch('/api/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, content: parts.join('\n'), userId }),
    })
    setSending(false)
  }

  return (
    <div className="mt-3 space-y-4">
      {questions.map((q, qi) => (
        <div key={qi}>
          <p className="text-xs font-semibold mb-2" style={{ color: accentColor }}>{q.text}</p>
          <div className="space-y-1.5">
            {q.options.map((opt) => {
              const checked = selected[qi]?.has(opt) ?? false
              return (
                <div key={opt}>
                  <label className="flex items-center gap-2.5 cursor-pointer group">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(qi, opt)}
                      className="w-4 h-4 rounded cursor-pointer shrink-0"
                      style={{ accentColor }}
                    />
                    <span className="text-sm leading-snug" style={{ color: checked ? 'rgba(240,240,255,1)' : 'rgba(240,240,255,0.65)' }}>
                      {isOther(opt) ? 'Enter your own…' : opt}
                    </span>
                  </label>
                  {isOther(opt) && checked && (
                    <input
                      type="text"
                      autoFocus
                      value={custom[qi] ?? ''}
                      onChange={(e) => setCustom((prev) => ({ ...prev, [qi]: e.target.value }))}
                      placeholder="Type your answer…"
                      className="mt-1.5 ml-6 w-[calc(100%-1.5rem)] text-sm rounded-lg px-3 py-1.5 text-white placeholder-white/35 outline-none"
                      style={{ background: 'rgba(255,255,255,0.08)', border: `1px solid ${accentColor}55` }}
                    />
                  )}
                </div>
              )
            })}
          </div>
        </div>
      ))}
      <button
        onClick={() => void submit()}
        disabled={!canSubmit || sending}
        className="w-full mt-1 py-2 rounded-xl text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        style={{ background: accentColor + '33', color: accentColor, border: `1px solid ${accentColor}55` }}
      >
        {sending ? 'Sending…' : 'Send answers →'}
      </button>
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
  const [messages, setMessages]         = useState<Message[]>(initialMessages)
  const [activities, setActivities]     = useState<string[]>([])
  const [input, setInput]               = useState('')
  const [sending, setSending]           = useState(false)
  const [pendingFiles, setPendingFiles] = useState<Attachment[]>([])
  const [uploading, setUploading]       = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const bottomRef    = useRef<HTMLDivElement>(null)
  // IDs of messages that existed at load time — those sections never play the fly-in
  const initialIds   = useRef(new Set(initialMessages.map((m) => m.id)))

  // Derive all event-driven state from the messages event stream (reliable) rather
  // than the jugnus table (drops Realtime events under pipeline burst load).
  const events = useProjectEvents(projectId)

  // activeJugnu: last TASK_ASSIGNED says who's working; any completion event clears it.
  // Falls back to the server-rendered snapshot for projects predating event vocabulary.
  const activeJugnu = useMemo(() => {
    if (!events.length) return initialActive
    const last = [...events].reverse().find((e) =>
      ['TASK_ASSIGNED', 'TASK_COMPLETED', 'PROJECT_COMPLETED', 'REVIEW_PASSED'].includes(e.event_type)
    )
    if (!last || last.event_type !== 'TASK_ASSIGNED') return null
    return last.jugnu_key ?? null
  }, [events, initialActive])

  const lastRelevant = [...events].reverse().find((e) =>
    ['APPROVAL_REQUIRED', 'PROTOTYPE_APPROVED', 'PROTOTYPE_REVISED', 'PROJECT_COMPLETED'].includes(e.event_type)
  )
  const approvalTask = lastRelevant?.event_type === 'APPROVAL_REQUIRED'
    ? { taskId: lastRelevant.task_id ?? null }
    : null

  // Pending clarification: last CLARIFICATION_REQUIRED message with no user reply after it
  const lastClarification = useMemo(() =>
    [...messages].reverse().find(
      (m) => (m.metadata as Record<string, unknown>)?.event_type === 'CLARIFICATION_REQUIRED'
    ) ?? null
  , [messages])

  // pendingMsgId: the CLARIFICATION_REQUIRED message ID that still has no user reply after it
  // (used by JugnuSection to render the inline MCQ form inside the bubble)
  const pendingMsgId = useMemo((): string | null => {
    if (!lastClarification) return null
    const answered = messages.some(
      (m) => m.author_type === 'user' && new Date(m.created_at) > new Date(lastClarification.created_at)
    )
    return answered ? null : lastClarification.id
  }, [lastClarification, messages])

  useEffect(() => {
    const db = createBrowserClient()

    const msgSub = db
      .channel(`project-messages-${projectId}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'messages',
        filter: `project_id=eq.${projectId}`,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }, (payload: any) => {
        const msg = payload.new as Message
        if (msg.author_type === 'activity') {
          setActivities((prev) => [...prev, msg.content])
          return
        }
        if (msg.author_type === 'jugnu') setActivities([])
        setMessages((prev) => prev.find((m) => m.id === msg.id) ? prev : [...prev, msg])
      })
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'messages',
        filter: `project_id=eq.${projectId}`,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }, (payload: any) => {
        const msg = payload.new as Message
        if (msg.author_type !== 'jugnu') return
        // Streaming: update content of an existing live row in place
        setMessages((prev) =>
          prev.map((m) => m.id === msg.id ? { ...m, content: msg.content } : m)
        )
      })
      .subscribe()

    db.from('messages')
      .select('id,project_id,author_type,author_key,content,created_at,metadata')
      .eq('project_id', projectId)
      .order('created_at', { ascending: true })
      .limit(100)
      .then(({ data }) => {
        if (data?.length) {
          // Mark gap-fill results as initial before the re-render so they
          // don't trigger fly-in animations (they already existed in the DB).
          ;(data as Message[]).forEach((m) => initialIds.current.add(m.id))
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

    return () => { void db.removeChannel(msgSub) }
  }, [projectId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, activeJugnu])

  const handleFiles = useCallback(async (files: FileList | null) => {
    if (!files?.length) return
    setUploading(true)
    const uploads = await Promise.all(
      Array.from(files).map(async (file) => {
        const fd = new FormData()
        fd.append('file', file)
        fd.append('projectId', projectId)
        const res = await fetch('/api/upload', { method: 'POST', body: fd })
        if (!res.ok) return null
        return res.json() as Promise<Attachment>
      })
    )
    setPendingFiles((prev) => [...prev, ...(uploads.filter(Boolean) as Attachment[])])
    setUploading(false)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [projectId])

  const send = async () => {
    const content = input.trim()
    if ((!content && !pendingFiles.length) || sending) return
    setSending(true)
    setInput('')
    const attachments = pendingFiles.length ? pendingFiles : undefined
    setPendingFiles([])
    await fetch('/api/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, content: content || '(attachment)', userId, attachments }),
    })
    setSending(false)
  }

  // eslint-disable-next-line react-hooks/refs
  const feed = buildFeed(messages, initialIds.current)

  // Show inline design preview after Nia's last message group once she completes
  const niaCompleted = events.some((e) => e.event_type === 'TASK_COMPLETED' && e.jugnu_key === 'nia')
  const lastNiaFeedIndex = feed.reduce((acc, item, i) =>
    item.type === 'jugnu' && item.authorKey === 'nia' ? i : acc, -1)

  return (
    <>
      <style>{`
        @keyframes jugnu-bounce {
          0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
          40% { transform: translateY(-6px); opacity: 1; }
        }
        @keyframes jugnu-float {
          0%, 100% { transform: translateY(0px); }
          50%       { transform: translateY(-8px); }
        }
        /* Bee flies in from the right (where the send button lives).
           Keeps Y movement small so the path is correct whether the
           section appears near the top or bottom of the chat. */
        /* ── Night scene animations ───────────────────────────── */
        @keyframes lantern-flicker {
          0%,100% { opacity: 0.65; transform: scale(1);    }
          18%     { opacity: 1;    transform: scale(1.12); }
          35%     { opacity: 0.55; transform: scale(0.92); }
          55%     { opacity: 0.9;  transform: scale(1.06); }
          78%     { opacity: 0.7;  transform: scale(0.98); }
        }
        @keyframes firefly-wander {
          0%   { transform: translate(0px,   0px);  opacity: 0.5; }
          20%  { transform: translate(14px,  -9px); opacity: 1;   }
          45%  { transform: translate(-7px, -16px); opacity: 0.7; }
          65%  { transform: translate(10px,  -5px); opacity: 1;   }
          85%  { transform: translate(-4px,  -2px); opacity: 0.6; }
          100% { transform: translate(0px,   0px);  opacity: 0.5; }
        }
        @keyframes water-drift {
          0%,100% { transform: translateX(0);    opacity: 0.28; }
          50%     { transform: translateX(-18px); opacity: 0.42; }
        }
        @keyframes jugnu-fly-in {
          0%   { transform: translate(280px, 30px) scale(0.5) rotate(18deg);  opacity: 0; }
          8%   { opacity: 1; }
          28%  { transform: translate(110px, -14px) scale(0.78) rotate(-10deg); }
          52%  { transform: translate(22px,   9px)  scale(0.94) rotate(5deg);  }
          72%  { transform: translate(-9px,  -3px)  scale(1)    rotate(-2deg); }
          87%  { transform: translate(4px,    1px)  scale(1)    rotate(1deg);  }
          100% { transform: translate(0px,   0px)   scale(1)    rotate(0deg);  opacity: 1; }
        }
      `}</style>

      <div className="flex-1 flex flex-col min-h-0 relative">
        {/* ── Background + animated overlays — outside scroll container so they never scroll away ── */}
        <div
          className="absolute inset-0 pointer-events-none overflow-hidden"
          style={{ backgroundImage: 'linear-gradient(rgba(0,0,0,0.45), rgba(0,0,0,0.45)), url(/chat-bg.png)', backgroundSize: 'cover', backgroundPosition: 'center 55%' }}
        >
          {/* Lantern glows */}
          {[
            { left: '17%', top: '20%', delay: '0s',    dur: '3.1s', size: 100 },
            { left: '11%', top: '52%', delay: '1.3s',  dur: '4.0s', size:  80 },
            { left: '26%', top: '72%', delay: '0.7s',  dur: '2.8s', size:  70 },
            { left: '78%', top: '38%', delay: '1.9s',  dur: '3.6s', size:  90 },
          ].map((g, i) => (
            <div key={i} className="absolute" style={{ left: g.left, top: g.top, animation: `lantern-flicker ${g.dur} ease-in-out ${g.delay} infinite` }}>
              <div style={{ width: g.size, height: g.size, borderRadius: '50%', background: `radial-gradient(circle, rgba(255,185,60,0.38) 0%, rgba(255,140,20,0.12) 50%, transparent 72%)` }} />
            </div>
          ))}
          {/* Fireflies */}
          {[
            { left: '38%', top: '30%', delay: '0s',   dur: '5.2s' },
            { left: '55%', top: '18%', delay: '1.1s', dur: '6.8s' },
            { left: '22%', top: '44%', delay: '2.4s', dur: '4.6s' },
            { left: '70%', top: '55%', delay: '0.6s', dur: '7.1s' },
            { left: '45%', top: '68%', delay: '3.2s', dur: '5.8s' },
            { left: '62%', top: '25%', delay: '1.8s', dur: '6.3s' },
          ].map((f, i) => (
            <div key={i} className="absolute" style={{ left: f.left, top: f.top, animation: `firefly-wander ${f.dur} ease-in-out ${f.delay} infinite` }}>
              <div style={{ width: 5, height: 5, borderRadius: '50%', background: 'rgba(255,230,100,0.9)', boxShadow: '0 0 6px 3px rgba(255,210,50,0.5)' }} />
            </div>
          ))}
          {/* Water shimmer — bottom 32% */}
          <div className="absolute bottom-0 left-0 right-0" style={{ height: '32%' }}>
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, transparent 0%, rgba(15,30,80,0.22) 100%)', animation: `water-drift 5.5s ease-in-out infinite` }} />
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, transparent 0%, rgba(15,30,80,0.22) 100%)', animation: `water-drift 7.2s ease-in-out 1.5s infinite reverse` }} />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto py-4 relative">
          {feed.map((item, i) => {
            const key = item.type === 'jugnu' ? `${item.authorKey}-${i}` : item.message.id
            const inner = (() => {
              if (item.type === 'jugnu') {
                return <JugnuSection
                  authorKey={item.authorKey} messages={item.messages} isNew={item.isNew}
                  pendingMsgId={pendingMsgId}
                  projectId={projectId} userId={userId}
                />
              }
              if (item.type === 'system') return <SystemItem msg={item.message} />
              return <UserItem msg={item.message} />
            })()
            return (
              <div key={key}>
                {inner}
                {niaCompleted && i === lastNiaFeedIndex && (
                  <DesignPreviewCard projectId={projectId} isRevising={activeJugnu === 'nia'} />
                )}
              </div>
            )
          })}

          {activeJugnu && <TypingBubble jugnuKey={activeJugnu} activities={activities} />}

          <div ref={bottomRef} />
        </div>

        {/* Approval gate card — shown when APPROVAL_REQUIRED fires */}
        {approvalTask && (
          <ApprovalCard projectId={projectId} taskId={approvalTask.taskId} />
        )}

        {/* Input bar — always visible; MCQ appears inline inside Maya's bubble */}
        <div className="shrink-0 border-t border-white/10 px-6 py-4" style={{ background: 'rgba(8, 14, 35, 0.75)', backdropFilter: 'blur(10px)' }}>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,text/*,application/json,.ts,.tsx,.js,.jsx,.md,.sql,.py"
            className="hidden"
            onChange={(e) => void handleFiles(e.target.files)}
          />
          {pendingFiles.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-3">
              {pendingFiles.map((att, i) => (
                <AttachmentChip
                  key={i}
                  att={att}
                  onRemove={() => setPendingFiles((prev) => prev.filter((_, j) => j !== i))}
                />
              ))}
            </div>
          )}
          <div className="flex items-center gap-3 rounded-2xl px-5 py-3 transition-all" style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.13)' }}>
            <textarea
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() } }}
              placeholder="Message your team…"
              className="flex-1 resize-none text-sm text-white/90 placeholder-white/35 bg-transparent outline-none leading-5"
              style={{ maxHeight: '120px' }}
              disabled={sending}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="text-white/40 hover:text-white/70 transition-colors disabled:opacity-30"
              title="Attach file"
            >
              {uploading
                ? <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" strokeLinecap="round"/></svg>
                : <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" strokeLinecap="round" strokeLinejoin="round"/></svg>
              }
            </button>
            <button
              onClick={() => void send()}
              disabled={(!input.trim() && !pendingFiles.length) || sending}
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
