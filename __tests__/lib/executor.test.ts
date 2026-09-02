import { describe, it, expect, vi } from 'vitest'
import { getNextReadyTask, advanceProject } from '@/lib/orchestration/executor'
import type { SupabaseClient } from '@supabase/supabase-js'

function makeDb(tasks: Array<{ id: string; jugnu_key: string; depends_on: string[]; status: string; sort_order: number }>) {
  return {
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({ data: tasks }),
        }),
      }),
    }),
  } as unknown as SupabaseClient
}

describe('getNextReadyTask', () => {
  it('returns first pending task with no dependencies', async () => {
    const db = makeDb([
      { id: 'a', jugnu_key: 'nia', depends_on: [], status: 'pending', sort_order: 0 },
      { id: 'b', jugnu_key: 'leo', depends_on: ['a'], status: 'pending', sort_order: 1 },
    ])
    const task = await getNextReadyTask('proj-1', db)
    expect(task?.id).toBe('a')
  })

  it('returns null when all pending tasks are blocked by incomplete deps', async () => {
    const db = makeDb([
      { id: 'a', jugnu_key: 'nia', depends_on: [], status: 'in_progress', sort_order: 0 },
      { id: 'b', jugnu_key: 'leo', depends_on: ['a'], status: 'pending', sort_order: 1 },
    ])
    const task = await getNextReadyTask('proj-1', db)
    expect(task).toBeNull()
  })

  it('returns dependent task once its dep is completed', async () => {
    const db = makeDb([
      { id: 'a', jugnu_key: 'nia', depends_on: [], status: 'completed', sort_order: 0 },
      { id: 'b', jugnu_key: 'leo', depends_on: ['a'], status: 'pending', sort_order: 1 },
    ])
    const task = await getNextReadyTask('proj-1', db)
    expect(task?.id).toBe('b')
  })

  it('returns null when all tasks are completed', async () => {
    const db = makeDb([
      { id: 'a', jugnu_key: 'nia', depends_on: [], status: 'completed', sort_order: 0 },
    ])
    const task = await getNextReadyTask('proj-1', db)
    expect(task).toBeNull()
  })

  it('returns null when there are no tasks', async () => {
    const db = makeDb([])
    const task = await getNextReadyTask('proj-1', db)
    expect(task).toBeNull()
  })

  it('treats null depends_on as empty array (no blocking deps)', async () => {
    const db = makeDb([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { id: 'a', jugnu_key: 'nia', depends_on: null as any, status: 'pending', sort_order: 0 },
    ])
    const task = await getNextReadyTask('proj-1', db)
    expect(task?.id).toBe('a')
  })
})

type AdvanceTask = { id: string; title: string; jugnu_key: string; depends_on: string[]; status: string }

function makeAdvanceDb(opts: {
  inProgressTask?: { id: string } | null
  tasks?: AdvanceTask[]
  nonCompletedCount?: number
}) {
  const { inProgressTask = null, tasks = [], nonCompletedCount = 0 } = opts
  let tasksSelectCalls = 0

  const tasksFrom = {
    select: vi.fn().mockImplementation(() => {
      tasksSelectCalls++
      if (tasksSelectCalls === 1) {
        return {
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              limit: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: inProgressTask }),
              }),
            }),
          }),
        }
      }
      if (tasksSelectCalls === 2) {
        return {
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({ data: tasks }),
          }),
        }
      }
      return {
        eq: vi.fn().mockReturnValue({
          neq: vi.fn().mockResolvedValue({ count: nonCompletedCount }),
        }),
      }
    }),
    update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
  }

  return {
    from: vi.fn((table: string) => {
      if (table === 'tasks') return tasksFrom
      if (table === 'projects') return {
        select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { workspace_id: 'ws-1' } }) }) }),
        update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
      }
      if (table === 'jugnus') return {
        update: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }) }),
      }
      if (table === 'messages') return { insert: vi.fn().mockResolvedValue({ error: null }) }
      return {}
    }),
  } as unknown as SupabaseClient
}

describe('advanceProject', () => {
  it('returns dispatched:false when an in-progress task already exists', async () => {
    const db = makeAdvanceDb({ inProgressTask: { id: 'task-ip' } })
    const result = await advanceProject('proj-1', db)
    expect(result.dispatched).toBe(false)
    expect(result.taskId).toBe('task-ip')
  })

  it('dispatches the next ready task', async () => {
    const db = makeAdvanceDb({
      tasks: [{ id: 'task-1', title: 'Design mockup', jugnu_key: 'nia', depends_on: [], status: 'pending' }],
    })
    const result = await advanceProject('proj-1', db)
    expect(result.dispatched).toBe(true)
    expect(result.jugnuKey).toBe('nia')
    expect(result.taskId).toBe('task-1')
  })

  it('returns dispatched:false when the next task is blocked by incomplete deps', async () => {
    const db = makeAdvanceDb({
      tasks: [
        { id: 'a', title: 'Design', jugnu_key: 'nia', depends_on: [], status: 'in_progress' },
        { id: 'b', title: 'Build',  jugnu_key: 'leo', depends_on: ['a'], status: 'pending'  },
      ],
      nonCompletedCount: 2,
    })
    const result = await advanceProject('proj-1', db)
    expect(result.dispatched).toBe(false)
    expect(result.taskId).toBeNull()
  })

  it('marks project completed when all tasks are done', async () => {
    const db = makeAdvanceDb({
      tasks: [{ id: 'a', title: 'Done', jugnu_key: 'nia', depends_on: [], status: 'completed' }],
      nonCompletedCount: 0,
    })
    const result = await advanceProject('proj-1', db)
    expect(result.dispatched).toBe(false)
    const fromCalls = (db.from as ReturnType<typeof vi.fn>).mock.calls.map((c: string[]) => c[0])
    expect(fromCalls).toContain('projects')
    expect(fromCalls).toContain('messages')
  })
})
