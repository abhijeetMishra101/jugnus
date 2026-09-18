import Anthropic from '@anthropic-ai/sdk'
import type {
  ProviderAdapter,
  ProviderEvent,
  ProviderStreamParams,
  UnifiedMessage,
  TokenUsage,
} from './types'

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  defaultHeaders: process.env.ANTHROPIC_WORKSPACE_ID
    ? { 'anthropic-workspace-id': process.env.ANTHROPIC_WORKSPACE_ID }
    : {},
})

function toAnthropicMessages(messages: UnifiedMessage[]): Anthropic.MessageParam[] {
  return messages.map((m) => {
    if (typeof m.content === 'string') {
      return { role: m.role, content: m.content }
    }
    const blocks: Anthropic.ContentBlockParam[] = m.content.map((b) => {
      if (b.type === 'image') {
        return { type: 'image' as const, source: { type: 'url' as const, url: b.url } }
      }
      return { type: 'text' as const, text: b.text }
    })
    return { role: m.role, content: blocks }
  })
}

export function createAnthropicAdapter(): ProviderAdapter {
  let _lastAssistantContent: unknown = null

  return {
    get lastAssistantContent() { return _lastAssistantContent },

    async *streamTurn(params: ProviderStreamParams): AsyncIterable<ProviderEvent> {
      const { model, systemPrompt, contextBlock, messages, tools, forceToolUse } = params

      const systemContent: Anthropic.TextBlockParam[] = [
        { type: 'text', text: contextBlock, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: systemPrompt },
      ]

      const anthropicTools: Anthropic.Tool[] = tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema as Anthropic.Tool['input_schema'],
      }))

      const stream = client.messages.stream({
        model,
        max_tokens: 8192,
        system: systemContent as Anthropic.MessageCreateParams['system'],
        tools: anthropicTools,
        tool_choice: forceToolUse ? { type: 'any' } : { type: 'auto' },
        messages: toAnthropicMessages(messages),
      })

      for await (const event of stream) {
        if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
          yield { type: 'tool_start', name: event.content_block.name, id: event.content_block.id }
        }

        if (event.type === 'content_block_delta') {
          if (event.delta.type === 'text_delta') {
            yield { type: 'text_delta', text: event.delta.text }
          }
          if (event.delta.type === 'input_json_delta') {
            yield { type: 'tool_input_delta', partialJson: event.delta.partial_json }
          }
        }
      }

      const final = await stream.finalMessage()
      _lastAssistantContent = final.content

      // Emit tool_end for each tool use block
      for (const block of final.content) {
        if (block.type === 'tool_use') {
          yield { type: 'tool_end', name: block.name, id: block.id, input: block.input as Record<string, unknown> }
        }
      }

      const usage: TokenUsage = {
        inputTokens: final.usage.input_tokens ?? 0,
        cachedTokens: (final.usage as unknown as Record<string, number>).cache_read_input_tokens ?? 0,
        outputTokens: final.usage.output_tokens ?? 0,
      }

      const stopReason =
        final.stop_reason === 'end_turn' ? 'end_turn'
        : final.stop_reason === 'max_tokens' ? 'max_tokens'
        : 'tool_use'

      yield { type: 'turn_done', stopReason, usage }
    },

    appendToolResults(messages, assistantContent, toolResults) {
      const results: Anthropic.ToolResultBlockParam[] = toolResults.map((r) => ({
        type: 'tool_result',
        tool_use_id: r.toolUseId,
        content: r.content,
        is_error: r.isError,
      }))
      return [
        ...messages,
        { role: 'assistant' as const, content: assistantContent as unknown as string },
        { role: 'user' as const, content: results as unknown as string },
      ] as import('./types').UnifiedMessage[]
    },
  }
}
