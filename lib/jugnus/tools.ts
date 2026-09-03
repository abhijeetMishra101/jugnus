import type Anthropic from '@anthropic-ai/sdk'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { JugnuKey } from './registry'
import { writeFile, readFile, listFiles } from '../storage/files'
import { pushProjectToGitHub } from './github'

export interface ToolSet {
  definitions: Anthropic.Tool[]
  handlers: Record<string, (input: Record<string, unknown>) => Promise<unknown>>
}

export function buildToolsForJugnu(
  jugnuKey: JugnuKey,
  projectId: string,
  taskId: string | null,
  db: SupabaseClient
): ToolSet {
  const definitions: Anthropic.Tool[] = []
  const handlers: Record<string, (input: Record<string, unknown>) => Promise<unknown>> = {}

  // ── complete_task — all jugnus ───────────────────────────────────────────────
  definitions.push({
    name: 'complete_task',
    description: 'Mark your current task as completed and record your result. Call this when your work is done.',
    input_schema: {
      type: 'object' as const,
      properties: {
        result: { type: 'string', description: 'Summary of what you did and what was produced.' },
      },
      required: ['result'],
    },
  })

  handlers['complete_task'] = async (input) => {
    if (taskId) {
      await db.from('tasks').update({
        status: 'completed',
        result: input.result,
        completed_at: new Date().toISOString(),
      }).eq('id', taskId)
    }
    await db.from('messages').insert({
      project_id: projectId,
      author_type: 'jugnu',
      author_key: jugnuKey,
      content: String(input.result),
      task_id: taskId,
    })
    return { ok: true }
  }

  // ── Maya tools ───────────────────────────────────────────────────────────────
  if (jugnuKey === 'maya') {
    definitions.push({
      name: 'ask_founder',
      description: 'Ask the founder a clarifying question. Use sparingly — only for genuine blockers.',
      input_schema: {
        type: 'object' as const,
        properties: {
          question: { type: 'string' },
          options: {
            type: 'array',
            items: { type: 'object', properties: { label: { type: 'string' }, value: { type: 'string' } } },
          },
        },
        required: ['question'],
      },
    })

    handlers['ask_founder'] = async (input) => {
      await db.from('escalations').insert({
        project_id: projectId, task_id: taskId, jugnu_key: 'maya',
        question: input.question, options: input.options ?? null, status: 'pending',
      })
      await db.from('messages').insert({
        project_id: projectId, author_type: 'jugnu', author_key: 'maya',
        content: `⚠️ **Maya needs your input.**\n\n${input.question}`,
        task_id: taskId, metadata: { escalation: true },
      })
      return { ok: true, waiting_for_founder: true }
    }

    definitions.push({
      name: 'create_task_plan',
      description: 'Create the task plan for this project. Call once after understanding the objective. Tasks execute in dependency order.',
      input_schema: {
        type: 'object' as const,
        properties: {
          tasks: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                description: { type: 'string', description: 'Detailed instructions for the jugnu. For Leo: specify exactly which files to create and what each should contain.' },
                capability: { type: 'string', enum: ['design', 'build', 'review'] },
                jugnu_key: { type: 'string', enum: ['nia', 'leo', 'tara'] },
                depends_on_indices: {
                  type: 'array',
                  items: { type: 'number' },
                  description: '0-based indices of tasks that must complete first.',
                },
              },
              required: ['title', 'description', 'capability', 'jugnu_key'],
            },
          },
        },
        required: ['tasks'],
      },
    })

    handlers['create_task_plan'] = async (input) => {
      const rawTasks = input.tasks as Array<{
        title: string; description: string; capability: string
        jugnu_key: string; depends_on_indices?: number[]
      }>
      const insertedIds: string[] = []
      for (let i = 0; i < rawTasks.length; i++) {
        const t = rawTasks[i]
        const dependsOn = (t.depends_on_indices ?? []).map((idx) => insertedIds[idx]).filter(Boolean)
        const { data } = await db.from('tasks').insert({
          project_id: projectId, title: t.title, description: t.description,
          capability: t.capability, jugnu_key: t.jugnu_key,
          depends_on: dependsOn, sort_order: i, status: 'pending',
        }).select('id').single()
        insertedIds.push(data?.id ?? '')
      }
      await db.from('projects').update({ status: 'building' }).eq('id', projectId)
      await db.from('messages').insert({
        project_id: projectId, author_type: 'jugnu', author_key: jugnuKey,
        content: `✨ Plan assembled — ${rawTasks.length} task${rawTasks.length !== 1 ? 's' : ''} queued for the team.`,
      })
      return { ok: true, task_count: rawTasks.length, ids: insertedIds }
    }
  }

  // ── File tools — Leo, Nia, Tara (readers) ────────────────────────────────────
  if (['leo', 'nia', 'tara'].includes(jugnuKey)) {
    definitions.push({
      name: 'list_files',
      description: 'List all files written for this project so far.',
      input_schema: { type: 'object' as const, properties: {}, required: [] },
    })
    handlers['list_files'] = async () => listFiles(projectId, db)

    definitions.push({
      name: 'read_file',
      description: 'Read the content of a specific file in the project.',
      input_schema: {
        type: 'object' as const,
        properties: { path: { type: 'string', description: 'File path, e.g. "src/components/Button.tsx"' } },
        required: ['path'],
      },
    })
    handlers['read_file'] = async (input) => readFile(projectId, input.path as string, db)
  }

  // ── Write tools — Leo and Nia ────────────────────────────────────────────────
  if (jugnuKey === 'leo' || jugnuKey === 'nia') {
    definitions.push({
      name: 'write_file',
      description: 'Write or update a file in the project. Call once per file. Write complete file content — no placeholders.',
      input_schema: {
        type: 'object' as const,
        properties: {
          path: { type: 'string', description: 'File path relative to project root, e.g. "src/index.ts"' },
          content: { type: 'string', description: 'Complete file content.' },
        },
        required: ['path', 'content'],
      },
    })
    handlers['write_file'] = async (input) => {
      const result = await writeFile(projectId, taskId, input.path as string, input.content as string, db)
      await db.from('messages').insert({
        project_id: projectId, author_type: 'activity', author_key: jugnuKey,
        content: `📄 Wrote \`${input.path}\``,
        task_id: taskId, metadata: { file_write: true, path: input.path },
      })
      return result
    }
  }

  // ── Submit for review — Leo only ─────────────────────────────────────────────
  if (jugnuKey === 'leo') {
    definitions.push({
      name: 'submit_for_review',
      description: 'Submit all written files for Tara\'s review. Call this after writing all files — it ends your turn.',
      input_schema: {
        type: 'object' as const,
        properties: {
          summary: { type: 'string', description: 'What you built and which files were written.' },
        },
        required: ['summary'],
      },
    })

    handlers['submit_for_review'] = async (input) => {
      const { files } = await listFiles(projectId, db)
      if (taskId) {
        await db.from('tasks').update({
          status: 'completed',
          result: input.summary,
          artifact: { type: 'files', paths: files.map((f) => f.path) },
          completed_at: new Date().toISOString(),
        }).eq('id', taskId)
      }

      // Fetch full file contents for GitHub push (listFiles only returns paths)
      const { data: fullFiles } = await db
        .from('file_snapshots')
        .select('path, content')
        .eq('project_id', projectId)
        .order('path', { ascending: true })

      // Push files to GitHub and get a PR URL for a Vercel preview
      const { data: proj } = await db.from('projects').select('title').eq('id', projectId).single()
      const { prUrl, error: ghError } = await pushProjectToGitHub({
        files: (fullFiles ?? []) as { path: string; content: string }[],
        projectTitle: proj?.title ?? 'Jugnus project',
        projectId,
      })

      const prLine = prUrl
        ? `\n\n[**→ View PR + Vercel preview**](${prUrl})`
        : ghError ? `\n\n⚠️ GitHub push skipped: ${ghError}` : ''

      await db.from('messages').insert({
        project_id: projectId, author_type: 'jugnu', author_key: 'leo',
        content: `🔀 **Leo submitted ${files.length} file${files.length !== 1 ? 's' : ''} for review.**\n\n${input.summary}${prLine}`,
        task_id: taskId, metadata: { review_ready: true, file_count: files.length, pr_url: prUrl },
      })
      return { ok: true, files_submitted: files.length }
    }
  }

  // ── Review tools — Tara only ─────────────────────────────────────────────────
  if (jugnuKey === 'tara') {
    definitions.push({
      name: 'approve',
      description: 'Approve the files. The project will be marked complete and the founder notified.',
      input_schema: {
        type: 'object' as const,
        properties: {
          comment: { type: 'string', description: 'Review summary for the founder.' },
        },
        required: ['comment'],
      },
    })

    handlers['approve'] = async (input) => {
      if (taskId) {
        await db.from('tasks').update({
          status: 'completed',
          result: input.comment,
          completed_at: new Date().toISOString(),
        }).eq('id', taskId)
      }
      await db.from('messages').insert({
        project_id: projectId, author_type: 'jugnu', author_key: 'tara',
        content: `✅ **Tara approved the work.**\n\n${input.comment}`,
        task_id: taskId, metadata: { review_verdict: 'approved' },
      })
      return { ok: true, verdict: 'approved' }
    }

    definitions.push({
      name: 'request_changes',
      description: 'Request changes from Leo. Describe exactly what needs to be fixed.',
      input_schema: {
        type: 'object' as const,
        properties: {
          feedback: { type: 'string', description: 'Specific changes required, file by file if possible.' },
        },
        required: ['feedback'],
      },
    })

    handlers['request_changes'] = async (input) => {
      if (taskId) {
        await db.from('tasks').update({
          status: 'completed',
          result: `Changes requested: ${input.feedback}`,
          completed_at: new Date().toISOString(),
        }).eq('id', taskId)
      }

      // Queue a new Leo build task for the revision
      const { data: project } = await db.from('projects').select('workspace_id').eq('id', projectId).single()
      await db.from('tasks').insert({
        project_id: projectId,
        title: 'Revise implementation based on Tara\'s feedback',
        description: `Tara requested these changes:\n\n${input.feedback}\n\nFix the issues in the existing files using write_file, then call submit_for_review again.`,
        capability: 'build', jugnu_key: 'leo',
        depends_on: taskId ? [taskId] : [],
        sort_order: 999, status: 'pending',
      })

      await db.from('messages').insert({
        project_id: projectId, author_type: 'jugnu', author_key: 'tara',
        content: `🔁 **Tara requested changes.**\n\n${input.feedback}`,
        task_id: taskId, metadata: { review_verdict: 'changes_requested' },
      })

      return { ok: true, verdict: 'changes_requested' }
    }
  }

  return { definitions, handlers }
}
