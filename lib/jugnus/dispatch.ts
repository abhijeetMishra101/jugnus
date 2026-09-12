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

const MODEL_SONNET = 'claude-sonnet-4-6'
const MODEL_HAIKU  = 'claude-haiku-4-5-20251001'
const MAX_TOKENS = 8192

// Per-jugnu model selection: Nia uses Haiku (10x faster for HTML section generation, 4x cheaper)
const MODEL_FOR_JUGNU: Partial<Record<JugnuKey, string>> = {
  nia: MODEL_HAIKU,
}

// Pricing per 1M tokens
const PRICING: Record<string, { input: number; cacheRead: number; output: number }> = {
  [MODEL_SONNET]: { input: 3.00, cacheRead: 0.30, output: 15.00 },
  [MODEL_HAIKU]:  { input: 0.80, cacheRead: 0.08, output: 4.00  },
}
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
  const MODEL = MODEL_FOR_JUGNU[jugnuKey] ?? MODEL_SONNET

  const ctx = await buildProjectContext(projectId, taskId, db)
  if (!ctx) return { posted: false, toolsUsed: [], finalMessage: null }

  const contextBlock = formatContextBlock(ctx, jugnuKey)

  const { data: recentMessages } = await db
    .from('messages')
    .select('author_type, author_key, content, metadata')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(30)

  type RawMsg = { author_type: string; author_key: string; content: string; metadata?: Record<string, unknown> }
  type Att = { url: string; name: string; isImage: boolean; textContent?: string | null }

  const rawHistory = ((recentMessages ?? []) as RawMsg[])
    .reverse()
    .filter((m) => m.author_type === 'user' || m.author_type === 'jugnu')
    .map((m) => {
      let text = m.author_type === 'jugnu'
        ? `[${m.author_key.toUpperCase()}]: ${m.content}`
        : m.content

      // Append text attachment content so jugnus can read uploaded files
      if (m.author_type === 'user' && m.metadata?.attachments) {
        const atts = (m.metadata.attachments as Att[])
        const textParts = atts
          .filter((a) => !a.isImage && a.textContent)
          .map((a) => `\n\n[Attached file: ${a.name}]\n\`\`\`\n${a.textContent}\n\`\`\``)
        if (textParts.length) text += textParts.join('')
      }

      return {
        role: (m.author_type === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
        content: text,
      }
    })

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

  // Telemetry accumulators for this dispatch run
  let totalInputTokens = 0
  let totalCachedTokens = 0
  let totalOutputTokens = 0
  let totalModelCalls = 0
  let totalCost = 0

  for (let turn = 0; turn < 25 && !done; turn++) {
    // Budget ceiling check before each model call
    if (taskId) {
      const { data: budgetProj } = await db
        .from('projects')
        .select('total_cost_usd, credit_ceiling_usd')
        .eq('id', projectId)
        .single()
      if (
        budgetProj?.credit_ceiling_usd != null &&
        (budgetProj.total_cost_usd ?? 0) >= budgetProj.credit_ceiling_usd
      ) {
        await db.from('messages').insert({
          project_id: projectId,
          author_type: 'system',
          author_key: 'system',
          content: `Project paused: execution budget of $${budgetProj.credit_ceiling_usd} reached. Resume from your project settings.`,
          metadata: { event_type: 'BUDGET_EXCEEDED', ceiling: budgetProj.credit_ceiling_usd, spent: budgetProj.total_cost_usd },
        })
        break
      }
    }

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

    const earlyActivityLabel: Record<string, string> = {
      write_file:        `📝 Writing file…`,
      read_file:         `👁️ Reading file…`,
      create_task_plan:  `📋 Building task plan…`,
      complete_task:     `✅ Wrapping up…`,
      submit_for_review: `🔍 Preparing review…`,
      approve:           `✅ Reviewing output…`,
      request_changes:   `✏️ Preparing feedback…`,
      ask_founder:       `💬 Composing question…`,
    }

    for await (const event of stream) {
      // Emit activity the moment Claude begins generating a tool call — not after it finishes.
      // This closes the silent gap where Nia generates a large HTML file for several minutes.
      if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
        const toolName = event.content_block.name
        void db.from('messages').insert({
          project_id: projectId,
          author_type: 'activity',
          author_key: jugnuKey,
          content: earlyActivityLabel[toolName] ?? `🔧 ${toolName}…`,
          metadata: { event_type: 'JUGNU_THINKING', tool: toolName, jugnu_key: jugnuKey },
        })
      }

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

    // Accumulate token usage with per-model pricing
    if (response.usage) {
      const inputTok = response.usage.input_tokens ?? 0
      const cacheTok = (response.usage as unknown as Record<string, unknown>).cache_read_input_tokens as number ?? 0
      const outputTok = response.usage.output_tokens ?? 0
      const p = PRICING[MODEL] ?? PRICING[MODEL_SONNET]
      const turnCost = (inputTok * p.input + cacheTok * p.cacheRead + outputTok * p.output) / 1_000_000
      totalInputTokens += inputTok
      totalCachedTokens += cacheTok
      totalOutputTokens += outputTok
      totalModelCalls += 1
      totalCost += turnCost
    }

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

        // Terminal tools — stop the agentic loop and skip any remaining tools in this response
        if (['complete_task', 'submit_for_review', 'approve', 'request_changes', 'ask_founder'].includes(toolUse.name)) {
          done = true
          break
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

  // Write telemetry to DB after the loop completes
  if (taskId && totalModelCalls > 0) {
    const { data: rawTask } = await db
      .from('tasks')
      .select('input_tokens, cached_tokens, output_tokens, model_calls, estimated_cost_usd')
      .eq('id', taskId)
      .single()

    await db.from('tasks').update({
      model: MODEL,
      input_tokens: (rawTask?.input_tokens ?? 0) + totalInputTokens,
      cached_tokens: (rawTask?.cached_tokens ?? 0) + totalCachedTokens,
      output_tokens: (rawTask?.output_tokens ?? 0) + totalOutputTokens,
      model_calls: (rawTask?.model_calls ?? 0) + totalModelCalls,
      estimated_cost_usd: ((rawTask?.estimated_cost_usd as number) ?? 0) + totalCost,
    }).eq('id', taskId)
  }

  // Increment project total cost using a raw SQL increment to avoid read-modify-write race
  if (totalCost > 0) {
    await db.rpc('increment_project_cost', { p_project_id: projectId, p_cost: totalCost }).maybeSingle()
      .then(({ error }) => {
        if (error) {
          // Fallback: read-modify-write if rpc not available
          return db
            .from('projects')
            .select('total_cost_usd')
            .eq('id', projectId)
            .single()
            .then(({ data }) => {
              const current = (data?.total_cost_usd as number) ?? 0
              return db.from('projects').update({ total_cost_usd: current + totalCost }).eq('id', projectId)
            })
        }
      })
  }

  return { posted: true, toolsUsed, finalMessage }
}
