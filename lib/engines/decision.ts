import type { SupabaseClient } from '@supabase/supabase-js'
import { flags } from '../feature-flags'

export type DecisionOutcome =
  | 'ASK_CLARIFICATION'
  | 'PROCEED'
  | 'SKIP_NIA'
  | 'SKIP_MAYA'
  | 'ESCALATE_ASTRA'
  | 'RETRY'
  | 'STOP'

export interface DecisionContext {
  objective: string
  briefLength: number
  hasAttachments: boolean
  previousClarificationCount: number
  retryCount: number
  taskFailureCount: number
}

export interface DecisionRecord {
  projectId: string
  taskId: string | null
  decisionType: string
  deterministicDecision: DecisionOutcome
  jevDecision: DecisionOutcome | null
  jevConfidence: number | null
  agreement: boolean | null
  appliedDecision: DecisionOutcome
  metadata: Record<string, unknown>
}

/**
 * Deterministic rules — fast, free, no model calls.
 * These fire first; Jev/LLM only runs when deterministic rules can't decide.
 */
function deterministicDecision(type: string, ctx: DecisionContext): DecisionOutcome | null {
  if (type === 'needs_clarification') {
    // Full brief: long, has attachments, or has prior answers → proceed
    if (ctx.briefLength > 300 || ctx.hasAttachments || ctx.previousClarificationCount > 0) return 'PROCEED'
    // Very short brief → always ask
    if (ctx.briefLength < 50) return 'ASK_CLARIFICATION'
    return null // ambiguous — let Jev/LLM decide
  }

  if (type === 'needs_nia') {
    // Tiny deterministic edits (< 80 chars) — skip Nia
    if (ctx.briefLength < 80 && ctx.previousClarificationCount === 0) return 'SKIP_NIA'
    return null
  }

  if (type === 'should_escalate') {
    // Too many failures → stop, not escalate (prevents infinite burn)
    if (ctx.taskFailureCount >= 3) return 'STOP'
    if (ctx.retryCount >= 2) return 'ESCALATE_ASTRA'
    return 'RETRY'
  }

  return null
}

/** Call Claude Haiku to make a routing decision when deterministic rules are ambiguous. */
async function callJevDecision(
  type: string,
  ctx: DecisionContext
): Promise<{ decision: DecisionOutcome; confidence: number } | null> {
  if (!process.env.ANTHROPIC_API_KEY) return null
  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default
    const client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      defaultHeaders: process.env.ANTHROPIC_WORKSPACE_ID
        ? { 'anthropic-workspace-id': process.env.ANTHROPIC_WORKSPACE_ID }
        : {},
    })

    const optionsMap: Record<string, string[]> = {
      needs_clarification: ['ASK_CLARIFICATION', 'PROCEED'],
      needs_nia:           ['SKIP_NIA', 'PROCEED'],
      should_escalate:     ['RETRY', 'ESCALATE_ASTRA', 'STOP'],
    }
    const options = optionsMap[type] ?? ['PROCEED']

    const contextSummary = [
      `Brief length: ${ctx.briefLength} chars`,
      ctx.hasAttachments ? 'Has attachments' : 'No attachments',
      ctx.previousClarificationCount > 0 ? `Prior clarifications: ${ctx.previousClarificationCount}` : '',
      ctx.retryCount > 0 ? `Retry count: ${ctx.retryCount}` : '',
      ctx.taskFailureCount > 0 ? `Task failures: ${ctx.taskFailureCount}` : '',
    ].filter(Boolean).join('. ')

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 64,
      system: `You are Jev, a routing decision engine for an AI product team. Output ONLY valid JSON with no explanation: {"decision":"<one of: ${options.join(', ')}>","confidence":<float 0-1>}`,
      messages: [{
        role: 'user',
        content: `Decision: ${type}\nContext: ${contextSummary}\nObjective: ${ctx.objective.slice(0, 200)}`,
      }],
    })

    const text = response.content[0]?.type === 'text' ? response.content[0].text.trim() : ''
    const parsed = JSON.parse(text) as { decision: string; confidence: number }
    if (options.includes(parsed.decision) && typeof parsed.confidence === 'number') {
      return { decision: parsed.decision as DecisionOutcome, confidence: parsed.confidence }
    }
    return null
  } catch { return null }
}

/**
 * DecisionEngine — deterministic rules first, Jev (Claude Haiku) for ambiguous cases.
 * Every decision is logged to decision_log for analysis.
 */
export async function decide(
  type: string,
  ctx: DecisionContext,
  db: SupabaseClient,
  projectId: string,
  taskId: string | null = null
): Promise<DecisionOutcome> {
  const deterministic = deterministicDecision(type, ctx)

  // Only call Jev when deterministic rules are ambiguous — keeps cost low
  const jevResult = (flags.JEV_DECISION_ENGINE && deterministic === null)
    ? await callJevDecision(type, ctx)
    : null

  const jevDecision: DecisionOutcome | null = jevResult?.decision ?? null
  const jevConfidence: number | null = jevResult?.confidence ?? null

  const applied = deterministic ?? jevDecision ?? 'PROCEED'
  const agreement = jevDecision !== null ? jevDecision === applied : null

  // Log every decision for future analysis
  try {
    await db.from('decision_log').insert({
      project_id: projectId,
      task_id: taskId,
      decision_type: type,
      deterministic_decision: deterministic,
      jev_decision: jevDecision,
      jev_confidence: jevConfidence,
      agreement,
      applied_decision: applied,
      context: ctx,
    } as Record<string, unknown>).select('id').single()
  } catch { /* table may not exist yet — non-fatal */ }

  return applied
}
