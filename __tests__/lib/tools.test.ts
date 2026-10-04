import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { buildToolsForJugnu } from '@/lib/jugnus/tools'

// ── Mocks ──────────────────────────────────────────────────────────────────────

vi.mock('@/lib/feature-flags', () => ({
  flags: {
    DYNAMIC_AGENT_ROUTING: false,
    OPENAI_AGENTS_EXECUTION: false,
    ASTRA_EXPERT_ESCALATION: false,
    OPENAI_IMAGE_25: false,
  },
}))

vi.mock('@/lib/storage/files', () => ({
  writeFile: vi.fn().mockResolvedValue({ ok: true }),
  readFile: vi.fn().mockResolvedValue({ content: '' }),
  listFiles: vi.fn().mockResolvedValue({ files: [] }),
}))

vi.mock('@/lib/jugnus/deploy-static', () => ({
  getPreviewUrl: vi.fn().mockReturnValue('http://localhost:3000/preview/test-project'),
}))

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeProjectId() { return 'proj-test-1234' }
function makeTaskId()    { return 'task-test-5678' }

/** Minimal Supabase mock for write_file / run_sql tests — only messages.insert needed */
function makeSimpleDb(tier = 'balanced') {
  const insertedMessages: Array<Record<string, unknown>> = []
  const db = {
    from: vi.fn((table: string) => {
      if (table === 'messages') {
        return {
          insert: vi.fn((data: Record<string, unknown>) => {
            insertedMessages.push(data)
            return Promise.resolve({ data: null, error: null })
          }),
        }
      }
      if (table === 'projects') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({ data: { constraints: { build_tier: tier } } }),
            })),
          })),
        }
      }
      return {}
    }),
    _messages: insertedMessages,
  }
  return db
}

/** Supabase mock for create_task_plan — supports count queries, inserts, updates */
// Generates founder_constraints entries with category tags.
// allCategories order: tier first, then all 6 required categories, then wrap_up.
// With count=8, all 6 required categories are covered. With count=3 only 2 are.
const QUIZ_CATEGORIES = ['build_tier', 'core_action', 'all_features', 'data', 'empty_error', 'users_access', 'explicit_exclusions', 'wrap_up'] as const
function makeFounderQAs(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    question: `Q${i}`,
    answer: `A${i}`,
    ...(i < QUIZ_CATEGORIES.length ? { category: QUIZ_CATEGORIES[i] } : {}),
  }))
}

function makeTaskPlanDb(opts: { activeTasks?: number; isRevision?: boolean; founderQAs?: number; revisionQAs?: number } = {}) {
  const { activeTasks = 0, isRevision = false, founderQAs = 8, revisionQAs = 1 } = opts
  // founderQAs: total entries in founder_constraints (includes tier Q as first entry).
  // Default 8 = tier + all 6 required categories + wrap_up, satisfies the category-coverage gate.
  // revisionQAs: revision-tagged entries appended after the initial quiz entries (default 1 with core_action).
  const insertedTasks: Array<Record<string, unknown>> = []
  const projectUpdates: Array<Record<string, unknown>> = []
  const taskUpdates: Array<Record<string, unknown>> = []
  const insertedMessages: Array<Record<string, unknown>> = []
  let taskInsertCount = 0

  const db = {
    from: vi.fn((table: string) => {
      if (table === 'tasks') {
        return {
          select: vi.fn((_fields: unknown, opts?: { head?: boolean }) => {
            if (opts?.head) {
              // Idempotency count query
              return {
                eq: vi.fn(() => ({
                  neq: vi.fn(() => ({
                    in: vi.fn().mockResolvedValue({ count: activeTasks }),
                  })),
                })),
              }
            }
            return { eq: vi.fn(() => ({ single: vi.fn().mockResolvedValue({ data: null }) })) }
          }),
          insert: vi.fn((data: Record<string, unknown>) => {
            taskInsertCount++
            const id = `task-${taskInsertCount}`
            insertedTasks.push({ ...data, id })
            return { select: vi.fn(() => ({ single: vi.fn().mockResolvedValue({ data: { id } }) })) }
          }),
          update: vi.fn((data: Record<string, unknown>) => {
            taskUpdates.push(data)
            return { eq: vi.fn().mockResolvedValue({ error: null }) }
          }),
        }
      }
      if (table === 'projects') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: {
                  constraints: isRevision
                    ? {
                        revision_mode: true,
                        founder_constraints: [
                          ...makeFounderQAs(founderQAs),
                          ...Array.from({ length: revisionQAs }, (_, i) => ({
                            question: `Revision Q${i}`,
                            answer: `Revision A${i}`,
                            category: i === 0 ? 'core_action' : 'all_features',
                            is_revision: true,
                          })),
                        ],
                      }
                    : { founder_constraints: makeFounderQAs(founderQAs) },
                  objective: 'test brief',
                },
              }),
            })),
          })),
          update: vi.fn((data: Record<string, unknown>) => {
            projectUpdates.push(data)
            return { eq: vi.fn().mockResolvedValue({ error: null }) }
          }),
        }
      }
      if (table === 'messages') {
        return {
          insert: vi.fn((data: Record<string, unknown>) => {
            insertedMessages.push(data)
            return Promise.resolve({ error: null })
          }),
        }
      }
      return {}
    }),
    _insertedTasks: insertedTasks,
    _projectUpdates: projectUpdates,
    _taskUpdates: taskUpdates,
    _messages: insertedMessages,
  }
  return db
}

// ── write_file: Nia section visibility ────────────────────────────────────────

describe('write_file handler', () => {
  const projectId = makeProjectId()
  const taskId = makeTaskId()

  it('emits author_type=jugnu when Nia writes a design/ path', async () => {
    const db = makeSimpleDb()
    const tools = buildToolsForJugnu('nia', projectId, taskId, db as unknown as SupabaseClient)
    await tools.handlers['write_file']({ path: 'design/hero.html', content: '<section>Hero</section>' })

    const msg = db._messages[0]
    expect(msg?.author_type).toBe('jugnu')
    expect(msg?.author_key).toBe('nia')
  })

  it('emits author_type=jugnu when Nia writes design/assembled.html specifically', async () => {
    const db = makeSimpleDb()
    const tools = buildToolsForJugnu('nia', projectId, taskId, db as unknown as SupabaseClient)
    await tools.handlers['write_file']({ path: 'design/assembled.html', content: '<html>mock</html>' })

    const msg = db._messages[0]
    expect(msg?.author_type).toBe('jugnu')
    expect(String(msg?.content)).toContain('🖼️')
  })

  it('emits author_type=activity when Nia writes outside design/', async () => {
    const db = makeSimpleDb()
    const tools = buildToolsForJugnu('nia', projectId, taskId, db as unknown as SupabaseClient)
    await tools.handlers['write_file']({ path: 'index.html', content: '<html>app</html>' })

    const msg = db._messages[0]
    expect(msg?.author_type).toBe('activity')
  })

  it('emits author_type=activity when Leo writes any path including design/', async () => {
    const db = makeSimpleDb()
    const tools = buildToolsForJugnu('leo', projectId, taskId, db as unknown as SupabaseClient)
    await tools.handlers['write_file']({ path: 'design/assembled.html', content: '<html>mock</html>' })

    const msg = db._messages[0]
    expect(msg?.author_type).toBe('activity')
  })
})

// ── run_sql: Leo DDL handler ───────────────────────────────────────────────────

describe('run_sql handler', () => {
  const projectId = makeProjectId()
  const taskId = makeTaskId()

  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://localhost:3000')
    vi.stubEnv('INTERNAL_API_SECRET', 'test-secret')
  })

  it('POSTs to /api/internal/run-sql with correct Bearer auth', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ ok: true, rowCount: 1 }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const db = makeSimpleDb()
    const tools = buildToolsForJugnu('leo', projectId, taskId, db as unknown as SupabaseClient)
    const result = await tools.handlers['run_sql']({
      sql: 'CREATE TABLE IF NOT EXISTS public.p_test_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid())',
      description: 'Create items table',
    })

    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:3000/api/internal/run-sql')
    expect(opts.method).toBe('POST')
    expect(opts.headers['Authorization']).toBe('Bearer test-secret')
    expect(JSON.parse(opts.body)).toMatchObject({ sql: expect.stringContaining('CREATE TABLE'), projectId })
    expect(result).toEqual({ ok: true, rowCount: 1 })
  })

  it('returns ok:false when the API returns an error', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: vi.fn().mockResolvedValue({ ok: false, error: 'permission denied' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const db = makeSimpleDb()
    const tools = buildToolsForJugnu('leo', projectId, taskId, db as unknown as SupabaseClient)
    const result = await tools.handlers['run_sql']({
      sql: 'DROP TABLE IF EXISTS public.p_test_items',
      description: 'Drop items table',
    })

    expect(result).toEqual({ ok: false, error: 'permission denied' })
  })

  it('emits a jugnu message with the description before running SQL', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ ok: true, rowCount: 0 }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const db = makeSimpleDb()
    const tools = buildToolsForJugnu('leo', projectId, taskId, db as unknown as SupabaseClient)
    await tools.handlers['run_sql']({ sql: 'SELECT 1', description: 'Health check' })

    const msg = db._messages[0]
    expect(msg?.author_type).toBe('jugnu')
    expect(String(msg?.content)).toContain('Health check')
  })
})

// ── create_task_plan: idempotency + revision sort ──────────────────────────────

describe('create_task_plan handler', () => {
  const projectId = makeProjectId()
  const taskId = makeTaskId()

  const minimalPlan = {
    tasks: [
      {
        title: 'Build the app',
        description: 'Write index.html',
        capability: 'build',
        jugnu_key: 'leo',
        eta: '~1 min',
        depends_on_indices: [],
      },
    ],
    build_tier: 'quick',
  }

  // Minimal plan with enough criteria for a revision (≥3 items required)
  const minimalRevisionPlan = {
    ...minimalPlan,
    acceptance_criteria: [
      { id: 'rc-1', description: 'Delete button shows confirmation dialog before removing', source: 'founder' },
      { id: 'rc-2', description: 'Confirming deletion removes the item from the list',      source: 'founder' },
      { id: 'rc-3', description: 'Cancel dismisses the dialog without deleting',            source: 'founder' },
    ],
  }

  // Plan with enough acceptance_criteria to pass the quiz gate (≥10 items required)
  const minimalPlanWithCriteria = {
    ...minimalPlan,
    acceptance_criteria: [
      { id: 'ac-1',  description: 'User can view the main page',                source: 'founder' },
      { id: 'ac-2',  description: 'User can add an item via the form',           source: 'founder' },
      { id: 'ac-3',  description: 'User can delete an item',                     source: 'founder' },
      { id: 'ac-4',  description: 'User can edit an existing item',              source: 'founder' },
      { id: 'ac-5',  description: 'Empty state shown when no items exist',       source: 'inferred' },
      { id: 'ac-6',  description: 'Error message shown on failed action',        source: 'inferred' },
      { id: 'ac-7',  description: 'Data persists across page refreshes',         source: 'founder' },
      { id: 'ac-8',  description: 'Only the owner can delete their own items',   source: 'founder' },
      { id: 'ac-9',  description: 'Real-time updates visible without refresh',   source: 'inferred' },
      { id: 'ac-10', description: 'Mobile responsive layout on all breakpoints', source: 'inferred' },
    ],
  }

  it('blocks when acceptance_criteria is missing on a new (non-revision) project', async () => {
    const db = makeTaskPlanDb({ activeTasks: 0, isRevision: false })
    const tools = buildToolsForJugnu('maya', projectId, taskId, db as unknown as SupabaseClient)
    const result = await tools.handlers['create_task_plan'](minimalPlan) as Record<string, unknown>

    expect(result.success).toBe(false)
    expect(String(result.error)).toContain('Quiz incomplete')
    expect(db._insertedTasks).toHaveLength(0)
  })

  it('blocks when acceptance_criteria has fewer than 10 items on a new project', async () => {
    const db = makeTaskPlanDb({ activeTasks: 0, isRevision: false })
    const tools = buildToolsForJugnu('maya', projectId, taskId, db as unknown as SupabaseClient)
    const result = await tools.handlers['create_task_plan']({
      ...minimalPlan,
      acceptance_criteria: [
        { id: 'ac-1', description: 'Feature A', source: 'founder' },
        { id: 'ac-2', description: 'Feature B', source: 'founder' },
        { id: 'ac-3', description: 'Feature C', source: 'founder' },
      ],
    }) as Record<string, unknown>

    expect(result.success).toBe(false)
    expect(String(result.error)).toContain('Quiz incomplete')
    expect(String(result.error)).toContain('3 acceptance criteria')
  })

  it('blocks when required categories are missing from founder_constraints', async () => {
    // founderQAs: 3 total = build_tier + core_action + all_features → missing data, empty_error, users_access, explicit_exclusions
    const db = makeTaskPlanDb({ activeTasks: 0, isRevision: false, founderQAs: 3 })
    const tools = buildToolsForJugnu('maya', projectId, taskId, db as unknown as SupabaseClient)
    const result = await tools.handlers['create_task_plan'](minimalPlanWithCriteria) as Record<string, unknown>

    expect(result.success).toBe(false)
    expect(String(result.error)).toContain('Quiz incomplete')
    expect(String(result.error)).toContain('categories')
  })

  it('blocks when founder_constraints have entries but no category tags at all', async () => {
    // Simulate old-format entries with no category field — gate must reject
    const db = {
      ...makeTaskPlanDb({ activeTasks: 0, isRevision: false }),
      from: vi.fn((table: string) => {
        if (table === 'tasks') return makeTaskPlanDb({ activeTasks: 0 }).from('tasks')
        if (table === 'projects') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn().mockResolvedValue({
                  data: {
                    constraints: {
                      founder_constraints: [
                        { question: 'Q0', answer: 'A0' }, // no category
                        { question: 'Q1', answer: 'A1' }, // no category
                        { question: 'Q2', answer: 'A2' }, // no category
                        { question: 'Q3', answer: 'A3' }, // no category
                        { question: 'Q4', answer: 'A4' }, // no category
                        { question: 'Q5', answer: 'A5' }, // no category
                        { question: 'Q6', answer: 'A6' }, // no category
                        { question: 'Q7', answer: 'A7' }, // no category
                      ],
                    },
                  },
                }),
              })),
            })),
            update: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) })),
          }
        }
        return makeTaskPlanDb({ activeTasks: 0 }).from(table)
      }),
    } as unknown as ReturnType<typeof makeTaskPlanDb>
    const tools = buildToolsForJugnu('maya', projectId, taskId, db as unknown as SupabaseClient)
    const result = await tools.handlers['create_task_plan'](minimalPlanWithCriteria) as Record<string, unknown>

    expect(result.success).toBe(false)
    expect(String(result.error)).toContain('Quiz incomplete')
    expect(String(result.error)).toContain('categories')
  })

  it('allows create_task_plan on a revision project when revision quiz is complete', async () => {
    const db = makeTaskPlanDb({ activeTasks: 0, isRevision: true })
    const tools = buildToolsForJugnu('maya', projectId, taskId, db as unknown as SupabaseClient)
    const result = await tools.handlers['create_task_plan'](minimalRevisionPlan) as Record<string, unknown>

    expect(result.ok).toBe(true)
  })

  it('blocks revision when core_action category is missing from revision Q&As', async () => {
    const db = makeTaskPlanDb({ activeTasks: 0, isRevision: true, revisionQAs: 0 })
    const tools = buildToolsForJugnu('maya', projectId, taskId, db as unknown as SupabaseClient)
    const result = await tools.handlers['create_task_plan'](minimalRevisionPlan) as Record<string, unknown>

    expect(result.success).toBe(false)
    expect(String(result.error)).toContain('Revision quiz incomplete')
    expect(String(result.error)).toContain('core_action')
  })

  it('blocks revision when fewer than 3 acceptance criteria provided', async () => {
    const db = makeTaskPlanDb({ activeTasks: 0, isRevision: true })
    const tools = buildToolsForJugnu('maya', projectId, taskId, db as unknown as SupabaseClient)
    const result = await tools.handlers['create_task_plan']({
      ...minimalPlan,
      acceptance_criteria: [{ id: 'rc-1', description: 'One criterion only', source: 'founder' }],
    }) as Record<string, unknown>

    expect(result.success).toBe(false)
    expect(String(result.error)).toContain('Revision quiz incomplete')
  })

  it('blocks when active (pending/in_progress) pipeline tasks already exist', async () => {
    const db = makeTaskPlanDb({ activeTasks: 2 })
    const tools = buildToolsForJugnu('maya', projectId, taskId, db as unknown as SupabaseClient)
    const result = await tools.handlers['create_task_plan'](minimalPlan) as Record<string, unknown>

    expect(result.success).toBe(false)
    expect(String(result.error)).toContain('Active pipeline tasks')
    // Verify no tasks were inserted
    expect(db._insertedTasks).toHaveLength(0)
  })

  it('succeeds and uses sort_order starting at 0 in normal mode', async () => {
    const db = makeTaskPlanDb({ activeTasks: 0, isRevision: false })
    const tools = buildToolsForJugnu('maya', projectId, taskId, db as unknown as SupabaseClient)
    const result = await tools.handlers['create_task_plan'](minimalPlanWithCriteria) as Record<string, unknown>

    expect(result.ok).toBe(true)
    expect(db._insertedTasks).toHaveLength(1)
    expect(db._insertedTasks[0].sort_order).toBe(0)
  })

  it('uses sort_order starting at 10000 in revision mode', async () => {
    const db = makeTaskPlanDb({ activeTasks: 0, isRevision: true })
    const tools = buildToolsForJugnu('maya', projectId, taskId, db as unknown as SupabaseClient)
    const result = await tools.handlers['create_task_plan']({
      ...minimalRevisionPlan,
      tasks: [
        { ...minimalPlan.tasks[0], title: 'Revision task 1' },
        { title: 'Revision task 2', description: 'Fix something', capability: 'build', jugnu_key: 'leo', depends_on_indices: [0] },
      ],
    }) as Record<string, unknown>

    expect(result.ok).toBe(true)
    expect(db._insertedTasks[0].sort_order).toBe(10000)
    expect(db._insertedTasks[1].sort_order).toBe(10001)
  })

  it('auto-completes Maya task after creating plan', async () => {
    const db = makeTaskPlanDb({ activeTasks: 0, isRevision: false })
    const tools = buildToolsForJugnu('maya', projectId, taskId, db as unknown as SupabaseClient)
    await tools.handlers['create_task_plan'](minimalPlanWithCriteria)

    const mayaAutoComplete = db._taskUpdates.find((u) => (u as Record<string, unknown>).status === 'completed')
    expect(mayaAutoComplete).toBeDefined()
  })

  it('does not auto-complete when taskId is null', async () => {
    const db = makeTaskPlanDb({ activeTasks: 0, isRevision: true })
    const tools = buildToolsForJugnu('maya', projectId, null, db as unknown as SupabaseClient)
    await tools.handlers['create_task_plan'](minimalRevisionPlan)

    // No task update should happen (no taskId)
    expect(db._taskUpdates).toHaveLength(0)
  })

  it('succeeds even when completed tasks exist from a prior run (revision scenario)', async () => {
    // activeTasks=0 means only completed old tasks; revision gate still requires core_action + 3 criteria
    const db = makeTaskPlanDb({ activeTasks: 0, isRevision: true })
    const tools = buildToolsForJugnu('maya', projectId, taskId, db as unknown as SupabaseClient)
    const result = await tools.handlers['create_task_plan'](minimalRevisionPlan) as Record<string, unknown>

    expect(result.ok).toBe(true)
  })

  it('stores acceptance_criteria in project constraints when provided', async () => {
    const db = makeTaskPlanDb({ activeTasks: 0, isRevision: false })
    const tools = buildToolsForJugnu('maya', projectId, taskId, db as unknown as SupabaseClient)
    const criteria = minimalPlanWithCriteria.acceptance_criteria
    await tools.handlers['create_task_plan']({ ...minimalPlan, acceptance_criteria: criteria })

    const projectUpdate = db._projectUpdates.find((u) =>
      (u as Record<string, unknown>).status === 'building'
    ) as Record<string, unknown> | undefined
    const stored = (projectUpdate?.constraints as Record<string, unknown>)?.acceptance_criteria
    expect(stored).toEqual(criteria)
  })

  it('stores revision acceptance_criteria in project constraints', async () => {
    const db = makeTaskPlanDb({ activeTasks: 0, isRevision: true })
    const tools = buildToolsForJugnu('maya', projectId, taskId, db as unknown as SupabaseClient)
    await tools.handlers['create_task_plan'](minimalRevisionPlan)

    const projectUpdate = db._projectUpdates.find((u) =>
      (u as Record<string, unknown>).status === 'building'
    ) as Record<string, unknown> | undefined
    const stored = (projectUpdate?.constraints as Record<string, unknown>)?.acceptance_criteria
    expect(stored).toEqual(minimalRevisionPlan.acceptance_criteria)
  })

  it('preserves existing constraints (including revision_mode) when storing acceptance_criteria', async () => {
    const db = makeTaskPlanDb({ activeTasks: 0, isRevision: true })
    const tools = buildToolsForJugnu('maya', projectId, taskId, db as unknown as SupabaseClient)
    await tools.handlers['create_task_plan'](minimalRevisionPlan)

    const projectUpdate = db._projectUpdates.find((u) =>
      (u as Record<string, unknown>).status === 'building'
    ) as Record<string, unknown> | undefined
    const constraints = projectUpdate?.constraints as Record<string, unknown>
    expect(constraints?.revision_mode).toBe(true)
    expect(constraints?.acceptance_criteria).toEqual(minimalRevisionPlan.acceptance_criteria)
  })
})
