import type { SupabaseClient } from '@supabase/supabase-js'
import { getJugnu, type JugnuKey } from './registry'
import { buildProjectContext, formatContextBlock } from './context'
import { buildToolsForJugnu } from './tools'
import { createAnthropicAdapter } from '../providers/anthropic'
import { createOpenAIChatAdapter } from '../providers/openai-chat'
import { flags } from '../feature-flags'
import type { UnifiedMessage, ProviderAdapter } from '../providers/types'
import { writeFile } from '../storage/files'

// ── Model routing ──────────────────────────────────────────────────────────────

const MODEL_SONNET = 'claude-sonnet-4-6'
const MODEL_HAIKU  = 'claude-haiku-4-5-20251001'
const MODEL_ASTRA  = 'claude-opus-4-8'
const MODEL_GPT41  = 'gpt-4.1'

// Default model per jugnu — provider is determined by model prefix
const MODEL_FOR_JUGNU: Partial<Record<JugnuKey, string>> = {
  nia:  MODEL_HAIKU,
  leo:  MODEL_HAIKU,
  tara: MODEL_HAIKU,
  // maya falls through to MODEL_SONNET (planning quality matters)
}

// Pricing per 1M tokens
const PRICING: Record<string, { input: number; cacheRead: number; output: number }> = {
  [MODEL_SONNET]: { input: 3.00,  cacheRead: 0.30,  output: 15.00 },
  [MODEL_HAIKU]:  { input: 0.80,  cacheRead: 0.08,  output: 4.00  },
  [MODEL_ASTRA]:  { input: 15.00, cacheRead: 1.50,  output: 60.00 },
  [MODEL_GPT41]:  { input: 2.00,  cacheRead: 0.50,  output: 8.00  },
}

function isOpenAIModel(model: string) {
  return model.startsWith('gpt-') || model.startsWith('o1') || model.startsWith('o3') || model.startsWith('o4')
}

function getAdapter(model: string): ProviderAdapter {
  if (isOpenAIModel(model)) return createOpenAIChatAdapter()
  return createAnthropicAdapter()
}

/**
 * Resolve the model to use for this jugnu/retry combination.
 * On retry ≥ 2 with ASTRA_EXPERT_ESCALATION enabled, escalate to gpt-6-astra.
 */
function resolveModel(jugnuKey: JugnuKey, retryCount = 0): string {
  if (flags.ASTRA_EXPERT_ESCALATION && retryCount >= 2) {
    return MODEL_ASTRA
  }
  return MODEL_FOR_JUGNU[jugnuKey] ?? MODEL_SONNET
}

// ── Streaming flush interval ───────────────────────────────────────────────────

const STREAM_FLUSH_INTERVAL = 150

// ── Types ──────────────────────────────────────────────────────────────────────

export interface DispatchInput {
  projectId: string
  taskId: string | null
  jugnuKey: JugnuKey
  db: SupabaseClient
  nudge?: string
  retryCount?: number
}

export interface DispatchResult {
  posted: boolean
  toolsUsed: string[]
  finalMessage: string | null
  escalatedToAstra?: boolean
}

// ── Leo Agents API sandbox path ────────────────────────────────────────────────

async function dispatchLeoSandbox(input: DispatchInput): Promise<DispatchResult> {
  const { projectId, taskId, db } = input

  // Load design files for context (Nia's output)
  const { data: snapshots } = await db
    .from('file_snapshots')
    .select('path, content')
    .eq('project_id', projectId)

  const designFiles: Record<string, string> = {}
  for (const f of snapshots ?? []) {
    designFiles[f.path as string] = f.content as string
  }

  // Task description from the task record
  const { data: taskRow } = taskId
    ? await db.from('tasks').select('description, title').eq('id', taskId).single()
    : { data: null }
  const taskDescription = (taskRow?.description as string | null)
    ?? (taskRow?.title as string | null)
    ?? 'Build the project according to the design specifications.'

  const onProgress = async (msg: string) => {
    await db.from('messages').insert({
      project_id: projectId,
      author_type: 'activity',
      author_key: 'leo',
      content: msg,
      metadata: { event_type: 'JUGNU_THINKING', jugnu_key: 'leo' },
    })
  }

  const { runAgentsSandbox } = await import('../providers/openai-agents')
  const startMs = Date.now()
  const result = await runAgentsSandbox({ taskDescription, designFiles, projectId, onProgress })
  const durationMs = Date.now() - startMs

  // Write output files to file_snapshots
  for (const [path, content] of Object.entries(result.outputFiles)) {
    await writeFile(projectId, taskId, path, content, db)
  }

  // Rough container cost: OpenAI charges ~$0.003/s for code_interpreter compute
  const containerCostUsd = (durationMs / 1000) * 0.003

  // Update task record with execution evidence
  if (taskId) {
    await db.from('tasks').update({
      status: result.success ? 'completed' : 'failed',
      result: result.success
        ? `Sandbox build succeeded in ${Math.round(durationMs / 1000)}s. Files: ${result.evidence.filesCreated.join(', ')}`
        : result.errorMessage ?? 'Build failed.',
      completed_at: result.success ? new Date().toISOString() : null,
      model: 'gpt-5.3-codex',
      estimated_cost_usd: containerCostUsd,
      build_evidence: result.evidence as unknown as Record<string, unknown>,
    }).eq('id', taskId)
  }

  if (containerCostUsd > 0) {
    await db.rpc('increment_project_cost', { p_project_id: projectId, p_cost: containerCostUsd }).maybeSingle()
  }

  const evidenceLine = [
    result.evidence.buildSucceeded ? '✅ Build' : '❌ Build failed',
    result.evidence.testsPassed === true ? '· ✅ Tests' : result.evidence.testsPassed === false ? '· ❌ Tests failed' : '',
    `· ⏱️ ${Math.round(durationMs / 1000)}s`,
    result.evidence.filesCreated.length > 0 ? `· 📁 ${result.evidence.filesCreated.length} files` : '',
  ].filter(Boolean).join(' ')

  const messageContent = result.success
    ? `✅ Built and tested in ${Math.round(durationMs / 1000)}s.\n\n${evidenceLine}`
    : `Build encountered issues after ${Math.round(durationMs / 1000)}s. ${result.errorMessage ?? ''}\n\n${evidenceLine}`

  await db.from('messages').insert({
    project_id: projectId,
    author_type: 'jugnu',
    author_key: 'leo',
    content: messageContent,
    task_id: taskId,
    metadata: {
      event_type: result.success ? 'TASK_COMPLETED' : 'BUILD_FAILED',
      jugnu_key: 'leo',
      execution_evidence: result.evidence,
    },
  })

  return { posted: true, toolsUsed: ['agents_sandbox'], finalMessage: messageContent, escalatedToAstra: false }
}

// ── Main dispatch function ─────────────────────────────────────────────────────

export async function dispatchJugnu(input: DispatchInput): Promise<DispatchResult> {
  const { projectId, taskId, jugnuKey, db, retryCount = 0 } = input
  const jugnu = getJugnu(jugnuKey)
  const MODEL = resolveModel(jugnuKey, retryCount)
  const escalatedToAstra = MODEL === MODEL_ASTRA

  // Phase 4: Leo Agents API sandbox — bypasses normal tool loop entirely
  if (jugnuKey === 'leo' && flags.OPENAI_AGENTS_EXECUTION && process.env.OPENAI_API_KEY) {
    return dispatchLeoSandbox(input)
  }

  if (escalatedToAstra) {
    await db.from('messages').insert({
      project_id: projectId,
      author_type: 'system',
      author_key: 'system',
      content: `🧠 Escalating to expert model (Astra) after ${retryCount} retries…`,
      metadata: { event_type: 'ASTRA_ESCALATION', jugnu_key: jugnuKey, retry_count: retryCount },
    })
  }

  const adapter = getAdapter(MODEL)

  const ctx = await buildProjectContext(projectId, taskId, db)
  if (!ctx) return { posted: false, toolsUsed: [], finalMessage: null }

  // Phase 7: dynamic routing decision for Maya — skip clarification for clear briefs
  let dynamicNudge: string | undefined = input.nudge
  if (jugnuKey === 'maya' && flags.DYNAMIC_AGENT_ROUTING) {
    const { decide } = await import('../engines/decision')
    const { data: proj } = await db.from('projects').select('objective').eq('id', projectId).single()
    const objective = (proj?.objective as string) ?? ''
    const { count: clarCount } = await db.from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .contains('metadata', { event_type: 'CLARIFICATION_REQUIRED' })
    const { data: userMsgs } = await db.from('messages')
      .select('metadata').eq('project_id', projectId).eq('author_type', 'user').limit(5)
    const hasAttachments = (userMsgs ?? []).some(
      (m) => Array.isArray((m.metadata as Record<string, unknown>)?.attachments)
    )
    const clarDec = await decide('needs_clarification', {
      objective,
      briefLength: objective.length,
      hasAttachments,
      previousClarificationCount: clarCount ?? 0,
      retryCount,
      taskFailureCount: 0,
    }, db, projectId, taskId)
    if (clarDec === 'PROCEED') {
      // Brief is clear enough — allow one design question but don't interrogate
      dynamicNudge = (dynamicNudge ? dynamicNudge + '\n\n' : '') +
        '[ROUTING] The brief is clear enough to plan. Ask at most ONE concise design preference question (e.g. style, colour palette, or a single key feature choice), then call create_task_plan immediately after the founder answers. Do not ask multiple questions.'
    }
  }

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

      const imageBlocks: { type: 'image'; url: string }[] = []

      if (m.author_type === 'user' && m.metadata?.attachments) {
        const atts = m.metadata.attachments as Att[]
        const textParts = atts
          .filter((a) => !a.isImage && a.textContent)
          .map((a) => `\n\n[Attached file: ${a.name}]\n\`\`\`\n${a.textContent}\n\`\`\``)
        if (textParts.length) text += textParts.join('')
        imageBlocks.push(...atts.filter((a) => a.isImage && a.url).map((a) => ({ type: 'image' as const, url: a.url })))
      }

      if (imageBlocks.length > 0) {
        return {
          role: 'user' as const,
          content: [...imageBlocks, { type: 'text' as const, text }],
        }
      }

      return {
        role: (m.author_type === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
        content: text,
      }
    })

  // Strip trailing assistant messages (provider requirement)
  let endIdx = rawHistory.length - 1
  while (endIdx >= 0 && rawHistory[endIdx].role === 'assistant') endIdx--
  const history = rawHistory.slice(0, endIdx + 1)

  const tools = buildToolsForJugnu(jugnuKey, projectId, taskId, db)

  // Convert tool definitions to unified format
  const unifiedTools = tools.definitions.map((t) => ({
    name: t.name,
    description: t.description ?? '',
    inputSchema: (t.input_schema ?? {}) as Record<string, unknown>,
  }))

  let messages: UnifiedMessage[] = history.length > 0
    ? history
    : [{ role: 'user', content: dynamicNudge ?? 'Begin your assigned task.' }]

  if (dynamicNudge && history.length > 0) {
    messages = [...messages, { role: 'user', content: dynamicNudge }]
  }

  const toolsUsed: string[] = []
  let finalMessage: string | null = null
  let done = false

  // Telemetry
  let totalInputTokens = 0
  let totalCachedTokens = 0
  let totalOutputTokens = 0
  let totalModelCalls = 0
  let totalCost = 0

  const turn0Label: Partial<Record<JugnuKey, string>> = {
    maya: '📋 Planning the project…',
    nia:  '🎨 Starting design…',
    leo:  '⚙️ Starting build…',
    tara: '🔍 Starting review…',
  }

  const earlyActivityLabel: Record<string, string> = {
    write_file:        '📝 Writing file…',
    read_file:         '👁️ Reading file…',
    create_task_plan:  '📋 Building task plan…',
    complete_task:     '✅ Wrapping up…',
    submit_for_review: '🔍 Preparing review…',
    approve:           '✅ Reviewing output…',
    request_changes:   '✏️ Preparing feedback…',
    ask_founder:       '💬 Composing question…',
    generate_image:    '🎨 Generating image…',
    search_photos:     '🖼️ Searching photos…',
  }

  for (let turn = 0; turn < 25 && !done; turn++) {
    // Budget ceiling check
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

    await db.from('messages').insert({
      project_id: projectId,
      author_type: 'activity',
      author_key: jugnuKey,
      content: turn === 0 ? (turn0Label[jugnuKey] ?? '💭 Starting…') : `💭 Continuing (turn ${turn + 1})…`,
      metadata: { event_type: 'JUGNU_THINKING', jugnu_key: jugnuKey, turn, model: MODEL },
    })

    // ── Stream a single turn via the provider adapter ──────────────────────────

    let liveRowId: string | null = null
    let textBuffer = ''
    let lastFlushedLen = 0

    // Tool input streaming state
    let activeToolName: string | null = null
    let activeToolId: string | null = null
    let toolInputBuffer = ''
    let toolStreamRowId: string | null = null
    let toolStreamPath: string | null = null
    let toolStreamLastFlush = 0

    // Completed tool calls this turn (name → input) for handler dispatch
    const completedTools: Array<{ name: string; id: string; input: Record<string, unknown> }> = []

    for await (const event of adapter.streamTurn({
      model: MODEL,
      systemPrompt: jugnu.systemPrompt,
      contextBlock,
      messages,
      tools: unifiedTools,
      forceToolUse: true,
    })) {

      if (event.type === 'tool_start') {
        activeToolName = event.name
        activeToolId = event.id
        toolInputBuffer = ''
        toolStreamRowId = null
        toolStreamPath = null
        toolStreamLastFlush = 0
        void db.from('messages').insert({
          project_id: projectId,
          author_type: 'activity',
          author_key: jugnuKey,
          content: earlyActivityLabel[event.name] ?? `🔧 ${event.name}…`,
          metadata: { event_type: 'JUGNU_THINKING', tool: event.name, jugnu_key: jugnuKey },
        })
      }

      if (event.type === 'tool_input_delta') {
        toolInputBuffer += event.partialJson

        // Stream write_file content in real-time
        if (activeToolName === 'write_file') {
          if (!toolStreamPath) {
            const m = toolInputBuffer.match(/"path"\s*:\s*"([^"]+)"/)
            if (m) toolStreamPath = m[1]
          }
          const contentMatch = toolInputBuffer.match(/"content":"((?:[^"\\]|\\[\s\S])*)/)
          if (contentMatch && toolStreamPath) {
            const partial = contentMatch[1]
              .replace(/\\n/g, '\n').replace(/\\t/g, '\t')
              .replace(/\\r/g, '\r').replace(/\\"/g, '"').replace(/\\\\/g, '\\')

            if (partial.length - toolStreamLastFlush >= STREAM_FLUSH_INTERVAL * 2) {
              if (!toolStreamRowId) {
                const { data: row } = await db.from('messages').insert({
                  project_id: projectId,
                  author_type: 'jugnu',
                  author_key: jugnuKey,
                  content: partial,
                  task_id: taskId,
                  metadata: { event_type: 'FILE_STREAM', streaming: true, jugnu_key: jugnuKey, file_path: toolStreamPath },
                }).select('id').single()
                toolStreamRowId = row?.id ?? null
              } else {
                await db.from('messages').update({ content: partial }).eq('id', toolStreamRowId)
              }
              toolStreamLastFlush = partial.length
            }
          }
        }
      }

      if (event.type === 'tool_end') {
        // Finalize write_file stream row
        if (event.name === 'write_file' && toolStreamRowId) {
          try {
            const parsed = JSON.parse(toolInputBuffer) as { path?: string; content?: string }
            if (parsed.content) {
              await db.from('messages').update({
                content: parsed.content,
                metadata: { event_type: 'FILE_STREAM', streaming: false, jugnu_key: jugnuKey, file_path: toolStreamPath ?? parsed.path },
              }).eq('id', toolStreamRowId)
            }
          } catch { /* partial buffer */ }
        }

        completedTools.push({ name: event.name, id: event.id, input: event.input })
        activeToolName = null
        activeToolId = null
        toolInputBuffer = ''
        toolStreamRowId = null
        toolStreamPath = null
        toolStreamLastFlush = 0
      }

      if (event.type === 'text_delta') {
        textBuffer += event.text
        if (!liveRowId && textBuffer.length > 0) {
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

      if (event.type === 'turn_done') {
        // Finalize streaming text row
        if (liveRowId) {
          const finalText = textBuffer.trim()
          if (finalText) {
            await db.from('messages').update({
              content: finalText,
              metadata: { event_type: 'JUGNU_SPOKE', jugnu_key: jugnuKey },
            }).eq('id', liveRowId)
            finalMessage = finalText
          } else {
            await db.from('messages').delete().eq('id', liveRowId)
          }
        }

        // Accumulate telemetry
        const p = PRICING[MODEL] ?? PRICING[MODEL_SONNET]
        const { inputTokens, cachedTokens, outputTokens } = event.usage
        const turnCost = (inputTokens * p.input + cachedTokens * p.cacheRead + outputTokens * p.output) / 1_000_000
        totalInputTokens += inputTokens
        totalCachedTokens += cachedTokens
        totalOutputTokens += outputTokens
        totalModelCalls += 1
        totalCost += turnCost

        if (event.stopReason === 'end_turn') { done = true; break }
        if (event.stopReason !== 'tool_use') break
      }
    }

    // ── Dispatch tool handlers ─────────────────────────────────────────────────

    if (completedTools.length === 0) break

    const toolResults: Array<{ toolUseId: string; content: string; isError?: boolean }> = []

    for (const toolCall of completedTools) {
      toolsUsed.push(toolCall.name)
      const handler = tools.handlers[toolCall.name]

      const activityLabel: Record<string, string> = {
        write_file:        `📝 Writing \`${(toolCall.input.path as string) ?? 'file'}\``,
        read_file:         `👁️ Reading \`${(toolCall.input.path as string) ?? 'file'}\``,
        search_photos:     `🖼️ Searching photos for "${(toolCall.input.query as string) ?? ''}"…`,
        generate_image:    `🎨 Generating image…`,
        create_task_plan:  `📋 Building task plan`,
        complete_task:     `✅ Wrapping up`,
        submit_for_review: `🔍 Submitting for review`,
        approve:           `✅ Approving`,
        request_changes:   `✏️ Requesting changes`,
        ask_founder:       `💬 Asking for your input`,
        call_api:          `🌐 Testing API…`,
        browse_app:        `🌐 Running browser test…`,
      }

      await db.from('messages').insert({
        project_id: projectId,
        author_type: 'activity',
        author_key: jugnuKey,
        content: activityLabel[toolCall.name] ?? `🔧 ${toolCall.name}`,
        metadata: { event_type: 'JUGNU_THINKING', tool: toolCall.name, jugnu_key: jugnuKey },
      })

      if (!handler) {
        toolResults.push({ toolUseId: toolCall.id, content: 'Unknown tool' })
        continue
      }

      try {
        const result = await handler(toolCall.input)
        toolResults.push({ toolUseId: toolCall.id, content: JSON.stringify(result) })

        const terminalTools = ['complete_task', 'submit_for_review', 'approve', 'request_changes', 'ask_founder', 'join_v2_waitlist', 'request_info']
        if (terminalTools.includes(toolCall.name)) {
          done = true
          break
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        toolResults.push({ toolUseId: toolCall.id, content: msg, isError: true })
      }
    }

    messages = adapter.appendToolResults(messages, adapter.lastAssistantContent, toolResults)
  }

  // ── Write telemetry ────────────────────────────────────────────────────────

  if (taskId && totalModelCalls > 0) {
    const { data: rawTask } = await db
      .from('tasks')
      .select('input_tokens, cached_tokens, output_tokens, model_calls, estimated_cost_usd')
      .eq('id', taskId)
      .single()

    await db.from('tasks').update({
      model: MODEL,
      input_tokens:      (rawTask?.input_tokens  ?? 0) + totalInputTokens,
      cached_tokens:     (rawTask?.cached_tokens  ?? 0) + totalCachedTokens,
      output_tokens:     (rawTask?.output_tokens  ?? 0) + totalOutputTokens,
      model_calls:       (rawTask?.model_calls    ?? 0) + totalModelCalls,
      estimated_cost_usd: ((rawTask?.estimated_cost_usd as number) ?? 0) + totalCost,
    }).eq('id', taskId)
  }

  if (totalCost > 0) {
    await db.rpc('increment_project_cost', { p_project_id: projectId, p_cost: totalCost }).maybeSingle()
      .then(({ error }) => {
        if (error) {
          return db.from('projects').select('total_cost_usd').eq('id', projectId).single()
            .then(({ data }) => {
              const current = (data?.total_cost_usd as number) ?? 0
              return db.from('projects').update({ total_cost_usd: current + totalCost }).eq('id', projectId)
            })
        }
      })
  }

  return { posted: true, toolsUsed, finalMessage, escalatedToAstra }
}
