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

/**
 * Core jugnu invocation loop.
 * Builds full project context, injects it above conversation history,
 * and runs the agentic loop until the jugnu calls complete_task or runs out of turns.
 */
export async function dispatchJugnu(input: DispatchInput): Promise<DispatchResult> {
  const { projectId, taskId, jugnuKey, db } = input
  const jugnu = getJugnu(jugnuKey)

  // 1. Build full project context — no channel history inference needed
  const ctx = await buildProjectContext(projectId, taskId, db)
  if (!ctx) return { posted: false, toolsUsed: [], finalMessage: null }

  const contextBlock = formatContextBlock(ctx, jugnuKey)

  // 2. Fetch recent project messages as conversation history (last 30)
  const { data: recentMessages } = await db
    .from('messages')
    .select('author_type, author_key, content')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(30)

  const rawHistory = ((recentMessages ?? []) as { author_type: string; author_key: string; content: string }[])
    .reverse()
    .filter((m) => m.author_type === 'user' || m.author_type === 'jugnu') // drop system messages
    .map((m) => ({
      role: (m.author_type === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
      content: m.author_type === 'jugnu'
        ? `[${m.author_key.toUpperCase()}]: ${m.content}`
        : m.content,
    }))

  // Strip ALL trailing assistant messages — Claude rejects assistant-prefill
  let endIdx = rawHistory.length - 1
  while (endIdx >= 0 && rawHistory[endIdx].role === 'assistant') endIdx--
  const history = rawHistory.slice(0, endIdx + 1)

  // 3. Build tool set for this jugnu
  const tools = buildToolsForJugnu(jugnuKey, projectId, taskId, db)

  // 4. Agentic loop — jugnu acts until complete_task or max turns
  const systemPrompt = `${contextBlock}\n\n${jugnu.systemPrompt}`
  let messages: Anthropic.MessageParam[] = history.length > 0
    ? history
    : [{ role: 'user', content: 'Begin your assigned task.' }]

  const toolsUsed: string[] = []
  let finalMessage: string | null = null
  let done = false

  for (let turn = 0; turn < 10 && !done; turn++) {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: systemPrompt,
      tools: tools.definitions,
      messages,
    })

    // Post any text content as a message in the project channel
    const textContent = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim()

    if (textContent) {
      await db.from('messages').insert({
        project_id: projectId,
        author_type: 'jugnu',
        author_key: jugnuKey,
        content: textContent,
        task_id: taskId,
      })
      finalMessage = textContent
    }

    if (response.stop_reason === 'end_turn') {
      done = true
      break
    }

    if (response.stop_reason !== 'tool_use') break

    // Execute tool calls
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

      // Post a live activity update so the UI shows what the jugnu is doing right now
      const inp = toolUse.input as Record<string, unknown>
      const activityLabel: Record<string, string> = {
        write_file:        `📝 Writing \`${inp.path ?? 'file'}\``,
        read_file:         `👁️ Reading \`${inp.path ?? 'file'}\``,
        create_task_plan:  `📋 Building task plan`,
        complete_task:     `✅ Wrapping up`,
        submit_for_review: `🔍 Submitting for review`,
        approve:           `✅ Approving`,
        request_changes:   `✏️ Requesting changes`,
      }
      const label = activityLabel[toolUse.name] ?? `🔧 ${toolUse.name}`
      await db.from('messages').insert({
        project_id: projectId,
        author_type: 'activity',
        author_key: jugnuKey,
        content: label,
        metadata: { tool: toolUse.name, jugnu: jugnuKey },
      })

      try {
        const result = await handler(toolUse.input as Record<string, unknown>)
        toolResults.push({ type: 'tool_result', tool_use_id: toolUse.id, content: JSON.stringify(result) })

        if (['complete_task', 'submit_for_review', 'approve', 'request_changes'].includes(toolUse.name)) {
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
