import OpenAI from 'openai'
import type {
  ProviderAdapter,
  ProviderEvent,
  ProviderStreamParams,
  UnifiedMessage,
  TokenUsage,
} from './types'

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

function toOpenAIMessages(
  systemPrompt: string,
  contextBlock: string,
  messages: UnifiedMessage[]
): OpenAI.Chat.ChatCompletionMessageParam[] {
  const system: OpenAI.Chat.ChatCompletionSystemMessageParam = {
    role: 'system',
    content: `${contextBlock}\n\n${systemPrompt}`,
  }

  const history: OpenAI.Chat.ChatCompletionMessageParam[] = messages.map((m) => {
    if (m.role === 'user') {
      if (typeof m.content === 'string') return { role: 'user', content: m.content }
      const parts: OpenAI.Chat.ChatCompletionContentPart[] = m.content.map((b) => {
        if (b.type === 'image') return { type: 'image_url' as const, image_url: { url: b.url } }
        return { type: 'text' as const, text: b.text }
      })
      return { role: 'user', content: parts }
    }
    // assistant messages may contain tool calls or text
    if (Array.isArray(m.content)) {
      // This branch handles reconstructed assistant messages with tool calls
      return m.content as unknown as OpenAI.Chat.ChatCompletionMessageParam
    }
    return { role: 'assistant', content: typeof m.content === 'string' ? m.content : '' }
  })

  return [system, ...history]
}

export function createOpenAIChatAdapter(): ProviderAdapter {
  let _lastAssistantContent: unknown = null

  return {
    get lastAssistantContent() { return _lastAssistantContent },

    async *streamTurn(params: ProviderStreamParams): AsyncIterable<ProviderEvent> {
      const { model, systemPrompt, contextBlock, messages, tools } = params

      const openaiTools: OpenAI.Chat.ChatCompletionTool[] = tools.map((t) => ({
        type: 'function' as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: t.inputSchema,
        },
      }))

      const stream = await client.chat.completions.create({
        model,
        stream: true,
        stream_options: { include_usage: true },
        tools: openaiTools.length > 0 ? openaiTools : undefined,
        tool_choice: openaiTools.length > 0 ? 'required' : undefined,
        messages: toOpenAIMessages(systemPrompt, contextBlock, messages),
      })

      // Accumulate tool call state across chunks
      const toolCalls: Record<number, { id: string; name: string; args: string }> = {}
      let textContent = ''
      let usage: TokenUsage = { inputTokens: 0, cachedTokens: 0, outputTokens: 0 }
      let stopReason: 'end_turn' | 'tool_use' | 'max_tokens' = 'end_turn'

      for await (const chunk of stream) {
        const choice = chunk.choices?.[0]

        if (chunk.usage) {
          usage = {
            inputTokens: chunk.usage.prompt_tokens ?? 0,
            cachedTokens: (chunk.usage as unknown as Record<string, number>).cached_tokens ?? 0,
            outputTokens: chunk.usage.completion_tokens ?? 0,
          }
        }

        if (!choice) continue
        const delta = choice.delta

        if (delta.content) {
          textContent += delta.content
          yield { type: 'text_delta', text: delta.content }
        }

        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index
            if (!toolCalls[idx]) {
              toolCalls[idx] = { id: tc.id ?? '', name: tc.function?.name ?? '', args: '' }
              yield { type: 'tool_start', name: tc.function?.name ?? '', id: tc.id ?? '' }
            } else {
              if (tc.id) toolCalls[idx].id = tc.id
              if (tc.function?.name) toolCalls[idx].name = tc.function.name
            }
            if (tc.function?.arguments) {
              toolCalls[idx].args += tc.function.arguments
              yield { type: 'tool_input_delta', partialJson: tc.function.arguments }
            }
          }
        }

        if (choice.finish_reason === 'tool_calls') stopReason = 'tool_use'
        if (choice.finish_reason === 'length') stopReason = 'max_tokens'
      }

      // Build OpenAI-format assistant message for history
      const assistantMsg: OpenAI.Chat.ChatCompletionAssistantMessageParam = {
        role: 'assistant',
        content: textContent || null,
        tool_calls: Object.values(toolCalls).map((tc) => ({
          id: tc.id,
          type: 'function' as const,
          function: { name: tc.name, arguments: tc.args },
        })),
      }
      _lastAssistantContent = assistantMsg

      // Emit tool_end for each completed tool call
      for (const tc of Object.values(toolCalls)) {
        let parsed: Record<string, unknown> = {}
        try { parsed = JSON.parse(tc.args) } catch { /* partial */ }
        yield { type: 'tool_end', name: tc.name, id: tc.id, input: parsed }
      }

      yield { type: 'turn_done', stopReason, usage }
    },

    appendToolResults(messages, assistantContent, toolResults) {
      const assistantMsg = assistantContent as OpenAI.Chat.ChatCompletionAssistantMessageParam
      const resultMsgs: OpenAI.Chat.ChatCompletionToolMessageParam[] = toolResults.map((r) => ({
        role: 'tool' as const,
        tool_call_id: r.toolUseId,
        content: r.isError ? `Error: ${r.content}` : r.content,
      }))
      return [
        ...messages,
        { role: 'assistant' as const, content: assistantMsg as unknown as string },
        ...resultMsgs.map((r) => ({ role: 'user' as const, content: r as unknown as string })),
      ]
    },
  }
}
