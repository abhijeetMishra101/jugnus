/**
 * Provider-neutral types for the Jugnus agentic loop.
 * Every model provider (Anthropic, OpenAI chat, OpenAI Agents sandbox) implements
 * ProviderAdapter so dispatch.ts stays provider-agnostic.
 */

export interface UnifiedImageBlock {
  type: 'image'
  url: string
}

export interface UnifiedTextBlock {
  type: 'text'
  text: string
}

export type UnifiedContentBlock = UnifiedTextBlock | UnifiedImageBlock

export interface UnifiedMessage {
  role: 'user' | 'assistant'
  content: string | UnifiedContentBlock[]
}

export interface UnifiedToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface TokenUsage {
  inputTokens: number
  cachedTokens: number
  outputTokens: number
}

// Events emitted by a provider during a single agentic turn
export type ProviderEvent =
  | { type: 'text_delta';       text: string }
  | { type: 'tool_start';       name: string; id: string }
  | { type: 'tool_input_delta'; partialJson: string }
  | { type: 'tool_end';         name: string; id: string; input: Record<string, unknown> }
  | { type: 'turn_done';        stopReason: 'end_turn' | 'tool_use' | 'max_tokens'; usage: TokenUsage }

export interface ProviderStreamParams {
  model: string
  systemPrompt: string
  contextBlock: string
  messages: UnifiedMessage[]
  tools: UnifiedToolDefinition[]
  forceToolUse: boolean
}

export interface ProviderAdapter {
  /** Stream a single agentic turn, yielding unified events. */
  streamTurn(params: ProviderStreamParams): AsyncIterable<ProviderEvent>
  /** Build the next set of messages after a tool-use turn completes. */
  appendToolResults(
    messages: UnifiedMessage[],
    assistantContent: unknown,
    toolResults: Array<{ toolUseId: string; content: string; isError?: boolean }>
  ): UnifiedMessage[]
  /** Raw assistant content from the last turn (provider-specific format, for appendToolResults). */
  lastAssistantContent: unknown
}

export interface ExecutionEvidence {
  filesCreated: string[]
  dependenciesInstalled: boolean
  buildSucceeded: boolean
  buildOutput: string
  serverStarted: boolean
  httpResponseOk: boolean
  browserRenderOk: boolean
  testsPassed: boolean | null
  testOutput: string
  containerDurationMs: number
}
