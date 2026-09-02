import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getNextReadyTask } from '@/lib/orchestration/executor'
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
})
