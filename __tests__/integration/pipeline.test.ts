// @vitest-environment node
/**
 * End-to-end mock pipeline integration test.
 *
 * MOCK_DISPATCH=true bypasses LLM calls so the full pipeline mechanics
 * (task creation, file writes, state transitions, messages) are tested
 * against real Supabase without spending any tokens.
 *
 * Skipped automatically when credentials look like placeholders
 * (e.g. the unit-test CI job). Runs in the integration-test CI job
 * which supplies real secrets via GitHub Actions repository secrets.
 *
 * Setup required in GitHub: Settings → Secrets → Actions
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY, INTERNAL_API_SECRET
 */

// Stub LLM provider modules so their SDK clients don't initialize at import time.
// In MOCK_DISPATCH mode these adapters are never called — we only need them to be importable.
import { vi } from 'vitest'
vi.mock('@/lib/providers/anthropic',     () => ({ createAnthropicAdapter:   vi.fn() }))
vi.mock('@/lib/providers/openai-chat',   () => ({ createOpenAIChatAdapter:  vi.fn() }))
vi.mock('@/lib/providers/openai-agents', () => ({ runAgentsSandbox:         vi.fn() }))

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { dispatchJugnu } from '@/lib/jugnus/dispatch'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

// Skip the entire suite when credentials are placeholders or absent.
// Real service role JWTs are always >100 chars; placeholders never are.
const isRealSupabase =
  SUPABASE_URL.includes('.supabase.co') &&
  !SUPABASE_URL.includes('placeholder') &&
  SERVICE_KEY.length > 100

describe.skipIf(!isRealSupabase)('[integration] mock dispatch pipeline', () => {
  let db: SupabaseClient
  const testProjectId  = crypto.randomUUID()
  const testWorkspaceId = crypto.randomUUID()

  // Shared task IDs populated progressively as the pipeline runs
  let mayaTaskId: string
  let leoTaskId:  string
  let taraTaskId: string

  beforeAll(async () => {
    vi.stubEnv('MOCK_DISPATCH', 'true')

    db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

    // ── Seed test workspace ──────────────────────────────────────────────────
    const { error: wsErr } = await db.from('workspaces').insert({
      id:       testWorkspaceId,
      name:     '[CI] Mock Pipeline Workspace',
      slug:     `ci-mock-${testWorkspaceId.slice(0, 8)}`,
      owner_id: crypto.randomUUID(),
    })
    if (wsErr) throw new Error(`Workspace insert failed: ${wsErr.message}`)

    // ── Seed test project (objective >500 chars so needs_clarification
    //    resolves deterministically to PROCEED — no LLM call) ───────────────
    const { error: projErr } = await db.from('projects').insert({
      id:           testProjectId,
      workspace_id: testWorkspaceId,
      title:        '[CI] Mock Pipeline Project',
      objective: [
        `[CI-TEST-${testProjectId.slice(0, 8)}] Automated integration test for the mock-dispatch pipeline.`,
        'This project is created by the CI system and will be automatically deleted after the test completes.',
        'Purpose: verify that Maya creates the correct task plan, Leo writes HTML files to file_snapshots,',
        'and Tara can approve the build. No LLM API calls are made because MOCK_DISPATCH=true intercepts',
        'all dispatch requests and runs a scripted tool sequence instead. Pipeline sequence: Maya → Leo → Tara.',
        'If you are reading this as a real project brief, please disregard — this is test automation only.',
      ].join(' '),
      constraints:  {},
      status:       'building',
    })
    if (projErr) throw new Error(`Project insert failed: ${projErr.message}`)

    // ── Seed Maya task (in_progress — simulates jugnu-respond claiming it) ──
    const { data: mayaTask, error: mayaErr } = await db.from('tasks').insert({
      project_id:  testProjectId,
      title:       'Plan the project',
      description: 'Create a minimal task plan using MOCK_DISPATCH.',
      capability:  'planning',
      jugnu_key:   'maya',
      depends_on:  [],
      sort_order:  0,
      status:      'in_progress',
      started_at:  new Date().toISOString(),
    }).select('id').single()
    if (mayaErr || !mayaTask) throw new Error(`Maya task insert failed: ${mayaErr?.message}`)
    mayaTaskId = mayaTask.id
  })

  afterAll(async () => {
    // Cascade delete handles tasks, messages, file_snapshots, escalations
    await db.from('projects').delete().eq('id', testProjectId)
    await db.from('workspaces').delete().eq('id', testWorkspaceId)
    vi.unstubAllEnvs()
  })

  // ── Step 1: Maya ──────────────────────────────────────────────────────────

  it('Maya creates leo + tara tasks and auto-completes herself', async () => {
    const result = await dispatchJugnu({
      projectId: testProjectId,
      taskId:    mayaTaskId,
      jugnuKey:  'maya',
      db,
    })

    expect(result.posted).toBe(true)
    expect(result.toolsUsed).toContain('create_task_plan')

    // Maya's own task must be auto-completed
    const { data: maya } = await db.from('tasks').select('status').eq('id', mayaTaskId).single()
    expect(maya?.status).toBe('completed')

    // Two new tasks: leo then tara
    const { data: created } = await db.from('tasks')
      .select('id, jugnu_key, status, sort_order')
      .eq('project_id', testProjectId)
      .neq('jugnu_key', 'maya')
      .order('sort_order', { ascending: true })

    expect(created).toHaveLength(2)
    expect(created![0].jugnu_key).toBe('leo')
    expect(created![0].status).toBe('pending')
    expect(created![1].jugnu_key).toBe('tara')
    expect(created![1].status).toBe('pending')

    leoTaskId  = created![0].id as string
    taraTaskId = created![1].id as string

    // Tara must depend on Leo
    const { data: taraRow } = await db.from('tasks').select('depends_on').eq('id', taraTaskId).single()
    expect((taraRow?.depends_on as string[])?.includes(leoTaskId)).toBe(true)
  })

  // ── Step 2: Leo ───────────────────────────────────────────────────────────

  it('Leo writes index.html, passes build validation, and submits for review', async () => {
    // Claim the Leo task before dispatching (jugnu-respond normally does this)
    await db.from('tasks')
      .update({ status: 'in_progress', started_at: new Date().toISOString() })
      .eq('id', leoTaskId)

    const result = await dispatchJugnu({
      projectId: testProjectId,
      taskId:    leoTaskId,
      jugnuKey:  'leo',
      db,
    })

    expect(result.posted).toBe(true)
    expect(result.toolsUsed).toContain('write_file')
    expect(result.toolsUsed).toContain('submit_for_review')

    // index.html must be in file_snapshots
    const { data: file } = await db.from('file_snapshots')
      .select('path, content')
      .eq('project_id', testProjectId)
      .eq('path', 'index.html')
      .single()
    expect(file?.path).toBe('index.html')
    expect(String(file?.content)).toContain('<body')

    // Leo's task must be completed with build evidence
    const { data: leo } = await db.from('tasks')
      .select('status, artifact')
      .eq('id', leoTaskId)
      .single()
    expect(leo?.status).toBe('completed')
    expect((leo?.artifact as Record<string, unknown>)?.html_valid).toBe(true)
  })

  // ── Step 3: Tara ──────────────────────────────────────────────────────────

  it('Tara finds Leo build evidence, approves, and marks her task completed', async () => {
    // Claim the Tara task
    await db.from('tasks')
      .update({ status: 'in_progress', started_at: new Date().toISOString() })
      .eq('id', taraTaskId)

    const result = await dispatchJugnu({
      projectId: testProjectId,
      taskId:    taraTaskId,
      jugnuKey:  'tara',
      db,
    })

    expect(result.posted).toBe(true)
    expect(result.toolsUsed).toContain('approve')

    // Tara's task must be completed
    const { data: tara } = await db.from('tasks')
      .select('status')
      .eq('id', taraTaskId)
      .single()
    expect(tara?.status).toBe('completed')
  })

  // ── Step 4: Messages audit ────────────────────────────────────────────────

  it('pipeline emits expected chat messages throughout', async () => {
    const { data: messages } = await db.from('messages')
      .select('author_type, author_key, metadata')
      .eq('project_id', testProjectId)
      .order('created_at', { ascending: true })

    const jugnuMsgs = (messages ?? []).filter((m) => m.author_type === 'jugnu')
    const authorKeys = jugnuMsgs.map((m) => m.author_key as string)

    // At minimum: Maya plan message, Leo build message, Tara approval
    expect(authorKeys).toContain('maya')
    expect(authorKeys).toContain('leo')
    expect(authorKeys).toContain('tara')
  })
})
