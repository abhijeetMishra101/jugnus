import { describe, it, expect, vi } from 'vitest'
import { buildProjectContext, formatContextBlock } from '@/lib/jugnus/context'
import type { ProjectContext } from '@/lib/jugnus/context'
import type { SupabaseClient } from '@supabase/supabase-js'

type TaskRow = { id: string; title: string; description: string; capability: string; jugnu_key: string; status: string; result: string | null; artifact: null }

function makeCtxDb(project: Record<string, unknown> | null, tasks: TaskRow[]) {
  return {
    from: vi.fn((table: string) => {
      if (table === 'projects') {
        return { select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: project }) }) }) }
      }
      return { select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ order: vi.fn().mockResolvedValue({ data: tasks }) }) }) }
    }),
  } as unknown as SupabaseClient
}

describe('buildProjectContext', () => {
  it('returns null when project is not found', async () => {
    const db = makeCtxDb(null, [])
    expect(await buildProjectContext('proj-1', null, db)).toBeNull()
  })

  it('returns context with correct currentTask when currentTaskId is given', async () => {
    const project = { id: 'p1', title: 'T', objective: 'O', constraints: {}, status: 'building' }
    const tasks: TaskRow[] = [
      { id: 't1', title: 'Design', description: '', capability: 'design', jugnu_key: 'nia', status: 'in_progress', result: null, artifact: null },
      { id: 't2', title: 'Build',  description: '', capability: 'build',  jugnu_key: 'leo', status: 'pending',     result: null, artifact: null },
    ]
    const ctx = await buildProjectContext('p1', 't1', makeCtxDb(project, tasks))
    expect(ctx?.currentTask?.id).toBe('t1')
    expect(ctx?.pendingTasks).toHaveLength(1)
    expect(ctx?.completedTasks).toHaveLength(0)
  })

  it('auto-finds in_progress task when no currentTaskId', async () => {
    const project = { id: 'p1', title: 'T', objective: 'O', constraints: {}, status: 'building' }
    const tasks: TaskRow[] = [
      { id: 't1', title: 'Design', description: '', capability: 'design', jugnu_key: 'nia', status: 'in_progress', result: null, artifact: null },
    ]
    const ctx = await buildProjectContext('p1', null, makeCtxDb(project, tasks))
    expect(ctx?.currentTask?.id).toBe('t1')
  })

  it('returns null currentTask when no tasks are in_progress and no id given', async () => {
    const project = { id: 'p1', title: 'T', objective: 'O', constraints: {}, status: 'planning' }
    const ctx = await buildProjectContext('p1', null, makeCtxDb(project, []))
    expect(ctx?.currentTask).toBeNull()
  })
})

const BASE_CTX: ProjectContext = {
  projectId: 'proj-123',
  title: 'Dark Mode Toggle',
  objective: 'Add a dark mode toggle button to the navigation bar.',
  constraints: { timeline: '2 days' },
  status: 'building',
  currentTask: {
    id: 'task-1',
    title: 'Design the toggle UI',
    description: 'Create an HTML mockup of the dark mode toggle.',
    capability: 'design',
    jugnu_key: 'nia',
    status: 'in_progress',
    result: null,
    artifact: null,
  },
  completedTasks: [],
  pendingTasks: [
    {
      id: 'task-2', title: 'Implement dark mode', description: '…', capability: 'build',
      jugnu_key: 'leo', status: 'pending', result: null, artifact: null,
    },
  ],
}

describe('formatContextBlock', () => {
  it('includes the project title and objective', () => {
    const block = formatContextBlock(BASE_CTX, 'nia')
    expect(block).toContain('Dark Mode Toggle')
    expect(block).toContain('Add a dark mode toggle button to the navigation bar.')
  })

  it('includes the current task description', () => {
    const block = formatContextBlock(BASE_CTX, 'nia')
    expect(block).toContain('Design the toggle UI')
    expect(block).toContain('CURRENT TASK')
  })

  it('includes the project ID', () => {
    const block = formatContextBlock(BASE_CTX, 'nia')
    expect(block).toContain('proj-123')
  })

  it('lists pending tasks', () => {
    const block = formatContextBlock(BASE_CTX, 'nia')
    expect(block).toContain('Implement dark mode')
  })

  it('lists completed tasks with results', () => {
    const ctx: ProjectContext = {
      ...BASE_CTX,
      completedTasks: [
        { id: 'done-1', title: 'Mocked up toggle', description: '', capability: 'design',
          jugnu_key: 'nia', status: 'completed', result: 'Mockup committed to GitHub', artifact: null },
      ],
    }
    const block = formatContextBlock(ctx, 'leo')
    expect(block).toContain('Mocked up toggle')
    expect(block).toContain('Mockup committed to GitHub')
  })

  it('includes the jugnu key', () => {
    const block = formatContextBlock(BASE_CTX, 'nia')
    expect(block.toLowerCase()).toContain('nia')
  })

  it('includes constraints', () => {
    const block = formatContextBlock(BASE_CTX, 'leo')
    expect(block).toContain('timeline')
    expect(block).toContain('2 days')
  })

  it('handles no current task gracefully', () => {
    const ctx: ProjectContext = { ...BASE_CTX, currentTask: null }
    const block = formatContextBlock(ctx, 'maya')
    expect(block).toContain('No current task assigned')
  })

  it('omits constraints section when constraints is empty', () => {
    const ctx: ProjectContext = { ...BASE_CTX, constraints: {} }
    const block = formatContextBlock(ctx, 'nia')
    expect(block).not.toContain('CONSTRAINTS')
  })

  it('omits completed section when completedTasks is empty', () => {
    const ctx: ProjectContext = { ...BASE_CTX, completedTasks: [] }
    const block = formatContextBlock(ctx, 'nia')
    expect(block).not.toContain('COMPLETED TASKS')
  })

  it('omits pending section when pendingTasks is empty', () => {
    const ctx: ProjectContext = { ...BASE_CTX, pendingTasks: [] }
    const block = formatContextBlock(ctx, 'nia')
    expect(block).not.toContain('UPCOMING TASKS')
  })

  it('includes artifact url in completed tasks when present', () => {
    const ctx: ProjectContext = {
      ...BASE_CTX,
      completedTasks: [
        { id: 'done-1', title: 'Mockup', description: '', capability: 'design',
          jugnu_key: 'nia', status: 'completed', result: null,
          artifact: { url: 'https://example.com/file.html' } as Record<string, unknown> },
      ],
    }
    const block = formatContextBlock(ctx, 'leo')
    expect(block).toContain('https://example.com/file.html')
  })
})
