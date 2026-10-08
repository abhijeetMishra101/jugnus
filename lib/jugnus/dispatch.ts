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

// Default model per jugnu for balanced/custom tiers. quick→Haiku everywhere, premium→Sonnet everywhere.
// On balanced: Leo gets Sonnet; everything else (including Maya) stays on Haiku.
// Maya on Haiku still plans well and costs 4× less than Sonnet.
const MODEL_FOR_JUGNU: Partial<Record<JugnuKey, string>> = {
  maya: MODEL_HAIKU,
  nia:  MODEL_HAIKU,
  leo:  MODEL_HAIKU,
  tara: MODEL_HAIKU,
}

// Pricing per 1M tokens (cacheWrite = 1.25× input; cacheRead = 0.1× input)
const PRICING: Record<string, { input: number; cacheWrite: number; cacheRead: number; output: number }> = {
  [MODEL_SONNET]: { input: 3.00,  cacheWrite: 3.75,  cacheRead: 0.30,  output: 15.00 },
  [MODEL_HAIKU]:  { input: 0.80,  cacheWrite: 1.00,  cacheRead: 0.08,  output: 4.00  },
  [MODEL_ASTRA]:  { input: 15.00, cacheWrite: 18.75, cacheRead: 1.50,  output: 60.00 },
  [MODEL_GPT41]:  { input: 2.00,  cacheWrite: 2.50,  cacheRead: 0.50,  output: 8.00  },
}

function isOpenAIModel(model: string) {
  return model.startsWith('gpt-') || model.startsWith('o1') || model.startsWith('o3') || model.startsWith('o4')
}

function getAdapter(model: string): ProviderAdapter {
  if (isOpenAIModel(model)) return createOpenAIChatAdapter()
  return createAnthropicAdapter()
}

/**
 * Resolve the model to use for this jugnu/tier/retry combination.
 *
 * Tier routing:
 *   quick    → all Haiku  (cheapest, fastest)
 *   balanced → Haiku for Nia/Tara, Sonnet for Leo  (recommended)
 *   premium  → Sonnet everywhere  (highest quality)
 *
 * On retry ≥ 2 with ASTRA_EXPERT_ESCALATION enabled, escalate to Astra regardless of tier.
 */
function resolveModel(jugnuKey: JugnuKey, tier: string, retryCount = 0): string {
  if (flags.ASTRA_EXPERT_ESCALATION && retryCount >= 2) return MODEL_ASTRA
  if (tier === 'quick')   return MODEL_HAIKU
  if (tier === 'premium') return MODEL_SONNET
  // balanced: Leo gets Sonnet, Nia/Tara stay on Haiku
  if (jugnuKey === 'leo') return MODEL_SONNET
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

// ── Test-only mock dispatch ────────────────────────────────────────────────────
// Set MOCK_DISPATCH=true in .env.local to exercise the full pipeline without
// spending LLM tokens. Each jugnu runs a scripted tool sequence using the real
// handlers (real DB writes, real task state transitions) but no API calls.

async function dispatchMock(input: DispatchInput): Promise<DispatchResult> {
  const { projectId, taskId, jugnuKey, db } = input
  const tools = buildToolsForJugnu(jugnuKey, projectId, taskId, db)

  type MockStep = { name: string; input: Record<string, unknown> }
  const SCRIPTS: Partial<Record<JugnuKey, MockStep[]>> = {
    maya: [{
      name: 'create_task_plan',
      input: {
        tasks: [
          {
            title: 'Build the app',
            description: 'Write index.html with a complete, working single-page app per the project brief.',
            capability: 'build',
            jugnu_key: 'leo',
            eta: '~30s',
            depends_on_indices: [],
          },
          {
            title: 'Review and approve',
            description: 'Review the built HTML output and approve if it passes quality checks. ACCEPTANCE CRITERIA: (1) task list renders, (2) add task works, (3) empty state shown.',
            capability: 'review',
            jugnu_key: 'tara',
            eta: '~10s',
            depends_on_indices: [0],
          },
        ],
        build_tier: 'quick',
        acceptance_criteria: [
          { id: 'ac-1', description: 'Task list renders with all existing tasks visible', category: 'Core action', question: 'What is the primary action?', founder_answer: 'View and manage tasks', source: 'founder' },
          { id: 'ac-2', description: 'Add task form submits and new task appears in the list', category: 'Core action', question: 'How does the user add a task?', founder_answer: 'Fill form and submit', source: 'founder' },
          { id: 'ac-3', description: 'Empty state message shown when no tasks exist', category: 'Empty & error states', source: 'inferred' },
        ],
      },
    }],
    nia: [
      { name: 'write_file', input: { path: 'design/assembled.html', content: '<!DOCTYPE html><html><head><title>Mock Design</title></head><body><h1>Mock Design</h1><p>Placeholder.</p></body></html>' } },
      { name: 'complete_task', input: { result: 'Mock design complete — assembled.html written.' } },
    ],
    leo: [
      { name: 'write_file', input: { path: 'index.html', content: '<!DOCTYPE html><html><head><title>Mock Build</title></head><body><h1>Mock Build</h1><p>Generated by MOCK_DISPATCH.</p></body></html>' } },
      { name: 'submit_for_review', input: { summary: 'Mock build complete. Wrote index.html.' } },
    ],
    tara: [
      { name: 'approve', input: { comment: 'Mock review passed — MOCK_DISPATCH mode.' } },
    ],
  }

  const script = SCRIPTS[jugnuKey]
  if (!script) {
    return { posted: false, toolsUsed: [], finalMessage: `No mock script for jugnu: ${jugnuKey}` }
  }

  const toolsUsed: string[] = []
  let finalMessage: string | null = `[MOCK_DISPATCH] ${jugnuKey} completed`

  for (const step of script) {
    const handler = tools.handlers[step.name]
    if (!handler) continue
    toolsUsed.push(step.name)
    try {
      const result = await handler(step.input)
      finalMessage = `[MOCK] ${step.name}: ${JSON.stringify(result)}`
    } catch (err) {
      finalMessage = `[MOCK error] ${step.name}: ${err instanceof Error ? err.message : String(err)}`
      break
    }
  }

  return { posted: true, toolsUsed, finalMessage }
}

// ── Main dispatch function ─────────────────────────────────────────────────────

export async function dispatchJugnu(input: DispatchInput): Promise<DispatchResult> {
  const { projectId, taskId, jugnuKey, db, retryCount = 0 } = input
  const jugnu = getJugnu(jugnuKey)

  // Read build_tier from project constraints — determines model quality for this run
  const { data: projData } = await db.from('projects').select('constraints').eq('id', projectId).single()
  const tier = ((projData?.constraints as Record<string, unknown>)?.build_tier as string) ?? 'balanced'

  const MODEL = resolveModel(jugnuKey, tier, retryCount)
  const escalatedToAstra = MODEL === MODEL_ASTRA

  // MOCK_DISPATCH=true bypasses LLM calls — runs scripted tool sequences instead.
  // Use this to test pipeline mechanics locally without spending tokens.
  if (process.env.MOCK_DISPATCH === 'true') {
    return dispatchMock(input)
  }

  // Phase 4: Leo Agents API sandbox — only active on quick tier (single-file HTML fast path)
  // Balanced/premium tiers use the normal Sonnet tool loop for higher-quality multi-screen builds
  if (jugnuKey === 'leo' && flags.OPENAI_AGENTS_EXECUTION && process.env.OPENAI_API_KEY && tier === 'quick') {
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

  const ctx = await buildProjectContext(projectId, taskId, db, jugnuKey)
  if (!ctx) return { posted: false, toolsUsed: [], finalMessage: null }

  // Phase 7: dynamic routing decisions via Jev
  let dynamicNudge: string | undefined = input.nudge

  // Tara depth routing — skip compare_with_design on minor revisions
  if (jugnuKey === 'tara' && flags.DYNAMIC_AGENT_ROUTING) {
    const { count: leoRevisions } = await db
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .eq('jugnu_key', 'leo')
      .eq('status', 'completed')
      .gte('sort_order', 100)

    const { decide } = await import('../engines/decision')
    const depthDec = await decide('tara_review_depth', {
      objective: '',
      briefLength: 0,
      hasAttachments: false,
      previousClarificationCount: 0,
      retryCount,
      taskFailureCount: 0,
      leoRevisionCount: leoRevisions ?? 0,
    }, db, projectId, taskId)

    if (depthDec === 'REVIEW_LITE') {
      dynamicNudge = (dynamicNudge ? dynamicNudge + '\n\n' : '') +
        '[ROUTING] Jev depth assessment → LITE review. This is a minor revision — skip compare_with_design and focus on browse_app to check for functional regressions only.'
    }
  }

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
      dynamicNudge = (dynamicNudge ? dynamicNudge + '\n\n' : '') +
        '[ROUTING] Brief is well-specified. Run your standard question protocol (tier + priority + constraints). Do not add questions beyond the mandatory 3.'
    }

    // Jev tier routing — assess complexity and guide Maya's build_tier choice
    const tierDec = await decide('build_tier', {
      objective,
      briefLength: objective.length,
      hasAttachments,
      previousClarificationCount: clarCount ?? 0,
      retryCount,
      taskFailureCount: 0,
    }, db, projectId, taskId)

    if (tierDec === 'TIER_QUICK' || tierDec === 'TIER_BALANCED' || tierDec === 'TIER_PREMIUM') {
      const suggestedTier = tierDec === 'TIER_QUICK' ? 'quick' : tierDec === 'TIER_PREMIUM' ? 'premium' : 'balanced'
      const rationale = tierDec === 'TIER_QUICK'
        ? 'simple single-page project — Haiku is sufficient, do not over-engineer'
        : tierDec === 'TIER_PREMIUM'
        ? 'complex project with attachments or advanced features — use full quality'
        : 'medium complexity — balanced tier recommended'
      dynamicNudge = (dynamicNudge ? dynamicNudge + '\n\n' : '') +
        `[ROUTING] Jev complexity assessment → build_tier="${suggestedTier}" (${rationale}). Set this tier in create_task_plan unless the founder's answers justify a change.`
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

  // ── Leo pre-planning turn ──────────────────────────────────────────────────
  // Force Leo to commit to a build plan before any tool calls.
  // Eliminates drift: photo searches, re-reading files every turn, scope creep.
  // Costs ~200 output tokens. Competitors (Devin, Bolt, Lovable) all do this.
  if (jugnuKey === 'leo') {
    const planPrompt = [
      'Before writing any code, output your build plan in bullet points:',
      '1. Every file you will write + approximate line count',
      '2. Every screen or section, listed by name',
      '3. Routing and state strategy (one sentence)',
      '4. Images/photos needed? (yes or no — if no, do NOT call search_photos)',
      '5. What you will NOT build (scope boundary)',
      '',
      'Short and specific. No code blocks. This commits you — you will follow it exactly.',
    ].join('\n')

    await db.from('messages').insert({
      project_id: projectId,
      author_type: 'activity',
      author_key: 'leo',
      content: '📋 Planning the build…',
      metadata: { event_type: 'JUGNU_THINKING', jugnu_key: 'leo', turn: -1 },
    })

    let planText = ''
    for await (const event of adapter.streamTurn({
      model: MODEL,
      systemPrompt: jugnu.systemPrompt,
      contextBlock,
      messages: [...messages, { role: 'user', content: planPrompt }],
      tools: [],         // no tools — pure text commitment
      forceToolUse: false,
    })) {
      if (event.type === 'text_delta') planText += event.text
      if (event.type === 'turn_done') {
        const p = PRICING[MODEL] ?? PRICING[MODEL_SONNET]
        const { inputTokens, cachedTokens, cacheWriteTokens, outputTokens } = event.usage
        totalInputTokens  += inputTokens
        totalCachedTokens += cachedTokens
        totalOutputTokens += outputTokens
        totalModelCalls   += 1
        totalCost += (inputTokens * p.input + cacheWriteTokens * p.cacheWrite + cachedTokens * p.cacheRead + outputTokens * p.output) / 1_000_000
        break
      }
    }

    planText = planText.trim()
    if (planText) {
      await db.from('messages').insert({
        project_id: projectId,
        author_type: 'jugnu',
        author_key: 'leo',
        content: `📋 **Build plan**\n\n${planText}`,
        task_id: taskId,
        metadata: { event_type: 'BUILD_PLAN', jugnu_key: 'leo' },
      })

      // Commit Leo to his plan — this context carries through every subsequent turn
      messages = [
        ...messages,
        { role: 'user',      content: planPrompt },
        { role: 'assistant', content: planText   },
        { role: 'user',      content: 'Good. Execute that plan now. Write the first file immediately — no reading, no searching, just write.' },
      ]
    }
  }

  const turn0Label: Partial<Record<JugnuKey, string>> = {
    maya: '📋 Planning the project…',
    nia:  '🎨 Starting design…',
    leo:  '⚙️ Starting build…',
    tara: '🔍 Starting review…',
  }

  const turnLabel = (key: JugnuKey, turn: number): string => {
    if (key === 'leo') {
      if (turn < 3)  return '⚙️ Writing structure…'
      if (turn < 7)  return '⚙️ Building screens…'
      if (turn < 11) return '⚙️ Adding functionality…'
      if (turn < 16) return '⚙️ Wiring data & logic…'
      if (turn < 20) return '⚙️ Polishing…'
      return '⚙️ Finalising…'
    }
    if (key === 'nia') {
      return turn < 4 ? '🎨 Designing screens…' : '🎨 Refining design…'
    }
    if (key === 'maya') {
      return '📋 Thinking through the plan…'
    }
    if (key === 'tara') {
      return turn < 3 ? '🔍 Checking flows…' : '🔍 Writing feedback…'
    }
    return '💭 Working…'
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
        (budgetProj.total_cost_usd ?? 0) + totalCost >= budgetProj.credit_ceiling_usd
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
      content: turn === 0 ? (turn0Label[jugnuKey] ?? '💭 Starting…') : turnLabel(jugnuKey, turn),
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
    const seenCriteria = new Set<string>()

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

        // Stream create_task_plan acceptance criteria as they appear
        if (activeToolName === 'create_task_plan') {
          const criteriaRe = /"description"\s*:\s*"((?:[^"\\]|\\.)*)"/g
          let m: RegExpExecArray | null
          while ((m = criteriaRe.exec(toolInputBuffer)) !== null) {
            const desc = m[1].replace(/\\n/g, ' ').replace(/\\"/g, '"').trim()
            if (desc.length > 15 && !seenCriteria.has(desc)) {
              seenCriteria.add(desc)
              void db.from('messages').insert({
                project_id: projectId,
                author_type: 'activity',
                author_key: jugnuKey,
                content: `✓ ${desc}`,
                metadata: { event_type: 'JUGNU_THINKING', jugnu_key: jugnuKey },
              })
            }
          }
        }

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
        const { inputTokens, cachedTokens, cacheWriteTokens, outputTokens } = event.usage
        const turnCost = (inputTokens * p.input + cacheWriteTokens * p.cacheWrite + cachedTokens * p.cacheRead + outputTokens * p.output) / 1_000_000
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

    const toolResults: Array<{ toolUseId: string; content: import('../providers/types').ToolResultContent; isError?: boolean }> = []

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
        call_api:            `🌐 Testing API…`,
        browse_app:          `🌐 Running browser test…`,
        compare_with_design: `🎨 Comparing against approved design…`,
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
        // Array results are content blocks (e.g. images) — pass directly; objects get JSON-stringified
        const content = Array.isArray(result) ? result : JSON.stringify(result)
        toolResults.push({ toolUseId: toolCall.id, content })

        const terminalTools = ['complete_task', 'create_task_plan', 'submit_for_review', 'approve', 'request_changes', 'ask_founder', 'join_v2_waitlist', 'request_info']
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
