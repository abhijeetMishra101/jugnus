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

/**
 * DecisionEngine — shadow mode initially.
 * Phase 1: records Jev vs current disagreements but always uses deterministic/LLM decision.
 * Phase 6: progressively allows Jev to control low-risk decisions after evidence accumulates.
 */
export async function decide(
  type: string,
  ctx: DecisionContext,
  db: SupabaseClient,
  projectId: string,
  taskId: string | null = null
): Promise<DecisionOutcome> {
  const deterministic = deterministicDecision(type, ctx)

  let jevDecision: DecisionOutcome | null = null
  let jevConfidence: number | null = null

  // Jev integration point — shadow mode when flag is on
  if (flags.JEV_DECISION_ENGINE && process.env.JEV_API_KEY) {
    try {
      // TODO: replace with real Jev API call when TypeSafe provides the endpoint
      // const jevResult = await callJev({ type, ctx })
      // jevDecision = jevResult.decision
      // jevConfidence = jevResult.confidence
    } catch { /* shadow mode — never block on Jev failure */ }
  }

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
