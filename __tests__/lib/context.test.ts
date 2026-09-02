import { describe, it, expect, vi, beforeEach } from 'vitest'
import { formatContextBlock } from '@/lib/jugnus/context'
import type { ProjectContext } from '@/lib/jugnus/context'

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
})
