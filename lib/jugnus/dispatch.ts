import Anthropic from '@anthropic-ai/sdk'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getJugnu, type JugnuKey } from './registry'
import { buildProjectContext, formatContextBlock } from './context'
import { buildToolsForJugnu } from './tools'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  ...(process.env.ANTHROPIC_WORKSPACE_ID
    ? { defaultHeaders: { 'anthropic-workspace-id': process.env.ANTHROPIC_WORKSPACE_ID } }
    : {}),
})

const MODEL = 'claude-sonnet-4-6'
const MAX_TOKENS = 8192
// Flush streaming content to DB every N characters to keep UI live without hammering Supabase
const STREAM_FLUSH_INTERVAL = 150

export interface DispatchInput {
  projectId: string
  taskId: string | null
  jugnuKey: JugnuKey
  db: SupabaseClient
}

export interface DispatchResult {
  posted: boolean
  toolsUsed: string[]
  finalMessage: string | null
}

export async function dispatchJugnu(input: DispatchInput): Promise<DispatchResult> {
  const { projectId, taskId, jugnuKey, db } = input
  const jugnu = getJugnu(jugnuKey)

  const ctx = await buildProjectContext(projectId, taskId, db)
  if (!ctx) return { posted: false, toolsUsed: [], finalMessage: null }

  const contextBlock = formatContextBlock(ctx, jugnuKey)

  const { data: recentMessages } = await db
    .from('messages')
    .select('author_type, author_key, content')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(30)

  const rawHistory = ((recentMessages ?? []) as { author_type: string; author_key: string; content: string }[])
    .reverse()
    .filter((m) => m.author_type === 'user' || m.author_type === 'jugnu')
    .map((m) => ({
      role: (m.author_type === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
      content: m.author_type === 'jugnu'
        ? `[${m.author_key.toUpperCase()}]: ${m.content}`
        : m.content,
    }))

  let endIdx = rawHistory.length - 1
  while (endIdx >= 0 && rawHistory[endIdx].role === 'assistant') endIdx--
  const history = rawHistory.slice(0, endIdx + 1)

  const tools = buildToolsForJugnu(jugnuKey, projectId, taskId, db)

  // System prompt with prompt caching on the large context block
  const systemContent: Anthropic.TextBlockParam[] = [
    {
      type: 'text',
      text: contextBlock,
      cache_control: { type: 'ephemeral' },
    },
    { type: 'text', text: jugnu.systemPrompt },
  ]

  let messages: Anthropic.MessageParam[] = history.length > 0
    ? history
    : [{ role: 'user', content: 'Begin your assigned task.' }]

  const toolsUsed: string[] = []
  let finalMessage: string | null = null
  let done = false

  for (let turn = 0; turn < 10 && !done; turn++) {
    // Activity indicator while waiting for first token
    await db.from('messages').insert({
      project_id: projectId,
      author_type: 'activity',
      author_key: jugnuKey,
      content: turn === 0 ? `💭 Reviewing task and planning approach…` : `💭 Continuing work (turn ${turn + 1})…`,
      metadata: { event_type: 'JUGNU_THINKING', jugnu_key: jugnuKey, turn },
    })

    // Streaming API call
    const stream = anthropic.messages.stream({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: systemContent as Anthropic.MessageCreateParams['system'],
      tools: tools.definitions,
      messages,
    })

    // Stream text tokens to DB in batches
    let liveRowId: string | null = null
    let textBuffer = ''
    let lastFlushedLen = 0

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        textBuffer += event.delta.text

        if (!liveRowId && textBuffer.length > 0) {
          // Create the live row on first text so UI shows something immediately
          const { data: row } = await db.from('messages').insert({
            project_id: projectId,
            author_type: 'jugnu',
            author_key: jugnuKey,
            content: textBuffer,
            task_id: taskId,
            metadata: { event_type: 'JUGNU_STARTED', streaming: true, jugnu_key: jugnuKey },
          }).select('id').single()
          liveRowId = row?.id ?? null
          lastFlushedLen = textBuffer.length
        } else if (liveRowId && textBuffer.length - lastFlushedLen >= STREAM_FLUSH_INTERVAL) {
          await db.from('messages').update({ content: textBuffer }).eq('id', liveRowId)
          lastFlushedLen = textBuffer.length
        }
      }
    }

    // Finalize the streaming row with complete text + correct event_type
    if (liveRowId) {
      const finalText = textBuffer.trim()
      if (finalText) {
        await db.from('messages').update({
          content: finalText,
          metadata: { event_type: 'JUGNU_SPOKE', jugnu_key: jugnuKey },
        }).eq('id', liveRowId)
        finalMessage = finalText
      } else {
        // No text was generated (tool-only turn) — delete the placeholder row
        await db.from('messages').delete().eq('id', liveRowId)
      }
    }

    const response = await stream.finalMessage()

    if (response.stop_reason === 'end_turn') {
      done = true
      break
    }

    if (response.stop_reason !== 'tool_use') break

    const toolUseBlocks = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
    )

    const toolResults: Anthropic.ToolResultBlockParam[] = []

    for (const toolUse of toolUseBlocks) {
      toolsUsed.push(toolUse.name)
      const handler = tools.handlers[toolUse.name]
      if (!handler) {
        toolResults.push({ type: 'tool_result', tool_use_id: toolUse.id, content: 'Unknown tool' })
        continue
      }

      const inp = toolUse.input as Record<string, unknown>
      const activityLabel: Record<string, string> = {
        write_file:        `📝 Writing \`${inp.path ?? 'file'}\``,
        read_file:         `👁️ Reading \`${inp.path ?? 'file'}\``,
        create_task_plan:  `📋 Building task plan`,
        complete_task:     `✅ Wrapping up`,
        submit_for_review: `🔍 Submitting for review`,
        approve:           `✅ Approving`,
        request_changes:   `✏️ Requesting changes`,
        ask_founder:       `💬 Asking for your input`,
      }
      await db.from('messages').insert({
        project_id: projectId,
        author_type: 'activity',
        author_key: jugnuKey,
        content: activityLabel[toolUse.name] ?? `🔧 ${toolUse.name}`,
        metadata: { event_type: 'JUGNU_THINKING', tool: toolUse.name, jugnu_key: jugnuKey },
      })

      try {
        const result = await handler(toolUse.input as Record<string, unknown>)
        toolResults.push({ type: 'tool_result', tool_use_id: toolUse.id, content: JSON.stringify(result) })

        // Terminal tools — stop the agentic loop after this turn
        if (['complete_task', 'submit_for_review', 'approve', 'request_changes', 'ask_founder'].includes(toolUse.name)) {
          done = true
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        toolResults.push({ type: 'tool_result', tool_use_id: toolUse.id, content: `Error: ${msg}`, is_error: true })
      }
    }

    messages = [
      ...messages,
      { role: 'assistant', content: response.content },
      { role: 'user', content: toolResults },
    ]
  }

  return { posted: true, toolsUsed, finalMessage }
}
