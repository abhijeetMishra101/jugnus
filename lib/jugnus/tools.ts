import type Anthropic from '@anthropic-ai/sdk'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { JugnuKey } from './registry'
import { getInstallationOctokit, getInstallationForProject } from '../github/auth'
import { commitFilesToBranch, createPullRequest, readFileFromBranch, listDirectory } from '../github/operations'

export interface ToolSet {
  definitions: Anthropic.Tool[]
  handlers: Record<string, (input: Record<string, unknown>) => Promise<unknown>>
}

/**
 * Returns the tool definitions and handlers available to a jugnu at dispatch time.
 * Each jugnu gets a capability-appropriate subset — no tool leakage between roles.
 */
export function buildToolsForJugnu(
  jugnuKey: JugnuKey,
  projectId: string,
  taskId: string | null,
  db: SupabaseClient
): ToolSet {
  const definitions: Anthropic.Tool[] = []
  const handlers: Record<string, (input: Record<string, unknown>) => Promise<unknown>> = {}

  // ── complete_task — available to all jugnus ──────────────────────────────────
  definitions.push({
    name: 'complete_task',
    description: 'Mark your current task as completed and record your result summary. Call this when your work is done.',
    input_schema: {
      type: 'object' as const,
      properties: {
        result: { type: 'string', description: 'Summary of what you did and what was produced.' },
        artifact: {
          type: 'object',
          description: 'Optional artifact produced (PR URL, file path, etc.)',
          properties: {
            type: { type: 'string', enum: ['github_pr', 'mockup', 'adr', 'document'] },
            url: { type: 'string' },
            branch: { type: 'string' },
          },
        },
      },
      required: ['result'],
    },
  })

  handlers['complete_task'] = async (input) => {
    const updates: Record<string, unknown> = {
      status: 'completed',
      result: input.result,
      completed_at: new Date().toISOString(),
    }
    if (input.artifact) updates.artifact = input.artifact

    if (taskId) {
      await db.from('tasks').update(updates).eq('id', taskId)
    }

    // Post system card to project channel
    await db.from('messages').insert({
      project_id: projectId,
      author_type: 'system',
      author_key: 'system',
      content: `✅ Task completed by ${jugnuKey.toUpperCase()}: ${input.result}`,
      task_id: taskId,
      metadata: { task_card: true },
    })

    return { ok: true }
  }

  // ── ask_founder — escalation, Maya only ─────────────────────────────────────
  if (jugnuKey === 'maya') {
    definitions.push({
      name: 'ask_founder',
      description: 'Ask the founder a clarifying question or preference decision. Use sparingly — only for genuine unknowns that block task planning.',
      input_schema: {
        type: 'object' as const,
        properties: {
          question: { type: 'string', description: 'The question to ask.' },
          options: {
            type: 'array',
            description: 'Optional choice options for the founder.',
            items: { type: 'object', properties: { label: { type: 'string' }, value: { type: 'string' } } },
          },
        },
        required: ['question'],
      },
    })

    handlers['ask_founder'] = async (input) => {
      await db.from('escalations').insert({
        project_id: projectId,
        task_id: taskId,
        jugnu_key: jugnuKey,
        question: input.question,
        options: input.options ?? null,
        status: 'pending',
      })
      await db.from('messages').insert({
        project_id: projectId,
        author_type: 'jugnu',
        author_key: 'maya',
        content: `⚠️ **Maya needs your input.**\n\n${input.question}`,
        task_id: taskId,
        metadata: { escalation: true },
      })
      return { ok: true, waiting_for_founder: true }
    }

    // create_task_plan — Maya generates the task graph
    definitions.push({
      name: 'create_task_plan',
      description: 'Create the task plan for this project. Call once after gathering requirements. Tasks execute in dependency order.',
      input_schema: {
        type: 'object' as const,
        properties: {
          tasks: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                description: { type: 'string', description: 'Detailed instructions for the jugnu assigned to this task.' },
                capability: { type: 'string', enum: ['design', 'build', 'review'] },
                jugnu_key: { type: 'string', enum: ['nia', 'leo', 'tara'] },
                depends_on_indices: {
                  type: 'array',
                  items: { type: 'number' },
                  description: '0-based indices of tasks in this array that must complete before this one starts.',
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
        title: string
        description: string
        capability: string
        jugnu_key: string
        depends_on_indices?: number[]
      }>

      // Insert tasks and collect IDs so depends_on can reference real UUIDs
      const insertedIds: string[] = []
      for (let i = 0; i < rawTasks.length; i++) {
        const t = rawTasks[i]
        const dependsOn = (t.depends_on_indices ?? []).map((idx) => insertedIds[idx]).filter(Boolean)
        const { data } = await db.from('tasks').insert({
          project_id: projectId,
          title: t.title,
          description: t.description,
          capability: t.capability,
          jugnu_key: t.jugnu_key,
          depends_on: dependsOn,
          sort_order: i,
          status: 'pending',
        }).select('id').single()
        insertedIds.push(data?.id ?? '')
      }

      await db.from('projects').update({ status: 'building' }).eq('id', projectId)

      await db.from('messages').insert({
        project_id: projectId,
        author_type: 'system',
        author_key: 'system',
        content: `✨ Maya assembled the plan — ${rawTasks.length} task${rawTasks.length !== 1 ? 's' : ''} queued.`,
        metadata: { task_card: true, plan_created: true },
      })

      return { ok: true, task_count: rawTasks.length, ids: insertedIds }
    }
  }

  // ── GitHub tools — Leo and Nia (committers) ──────────────────────────────────
  if (jugnuKey === 'leo' || jugnuKey === 'nia') {
    definitions.push({
      name: 'read_file',
      description: 'Read a file from the GitHub repo to understand existing patterns.',
      input_schema: {
        type: 'object' as const,
        properties: {
          path: { type: 'string' },
          branch: { type: 'string', description: 'Branch to read from. Defaults to main.' },
        },
        required: ['path'],
      },
    })

    handlers['read_file'] = async (input) => {
      const install = await getInstallationForProject(projectId, db)
      if (!install) return { error: 'No GitHub installation found for this project.' }
      const octokit = await getInstallationOctokit(install.installation_id)
      const [owner, repo] = install.repo_full_name.split('/')
      return readFileFromBranch(octokit, owner, repo, input.path as string, (input.branch as string) ?? 'main')
    }

    definitions.push({
      name: 'list_directory',
      description: 'List files in a directory of the GitHub repo.',
      input_schema: {
        type: 'object' as const,
        properties: {
          path: { type: 'string', description: 'Directory path, e.g. "app/components"' },
          branch: { type: 'string' },
        },
        required: ['path'],
      },
    })

    handlers['list_directory'] = async (input) => {
      const install = await getInstallationForProject(projectId, db)
      if (!install) return { error: 'No GitHub installation found.' }
      const octokit = await getInstallationOctokit(install.installation_id)
      const [owner, repo] = install.repo_full_name.split('/')
      return listDirectory(octokit, owner, repo, input.path as string, (input.branch as string) ?? 'main')
    }

    definitions.push({
      name: 'commit_files',
      description: 'Commit one or more files to a branch in the GitHub repo. Creates the branch if it does not exist.',
      input_schema: {
        type: 'object' as const,
        properties: {
          branch: { type: 'string', description: 'Branch name, e.g. "jugnu/build-{projectId}"' },
          message: { type: 'string', description: 'Commit message' },
          files: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                path: { type: 'string' },
                content: { type: 'string' },
              },
              required: ['path', 'content'],
            },
          },
        },
        required: ['branch', 'message', 'files'],
      },
    })

    handlers['commit_files'] = async (input) => {
      const install = await getInstallationForProject(projectId, db)
      if (!install) return { error: 'No GitHub installation found.' }
      const octokit = await getInstallationOctokit(install.installation_id)
      const [owner, repo] = install.repo_full_name.split('/')
      const files = input.files as Array<{ path: string; content: string }>
      return commitFilesToBranch(octokit, owner, repo, input.branch as string, input.message as string, files)
    }
  }

  // ── PR tools — Leo only ──────────────────────────────────────────────────────
  if (jugnuKey === 'leo') {
    definitions.push({
      name: 'open_pr',
      description: 'Open a GitHub Pull Request when your implementation is ready for review.',
      input_schema: {
        type: 'object' as const,
        properties: {
          branch: { type: 'string' },
          title: { type: 'string' },
          body: { type: 'string', description: 'PR description with what was built and how to test it.' },
        },
        required: ['branch', 'title', 'body'],
      },
    })

    handlers['open_pr'] = async (input) => {
      const install = await getInstallationForProject(projectId, db)
      if (!install) return { error: 'No GitHub installation found.' }
      const octokit = await getInstallationOctokit(install.installation_id)
      const [owner, repo] = install.repo_full_name.split('/')
      const pr = await createPullRequest(
        octokit, owner, repo,
        input.title as string, input.branch as string, 'main', input.body as string
      )

      // Record in tasks
      if (taskId) {
        await db.from('tasks').update({ artifact: { type: 'github_pr', url: pr.url, number: pr.number } })
          .eq('id', taskId)
      }

      await db.from('messages').insert({
        project_id: projectId,
        author_type: 'jugnu',
        author_key: 'leo',
        content: `🔀 PR ready for review: [${input.title}](${pr.url})`,
        task_id: taskId,
        metadata: { pr_url: pr.url, pr_number: pr.number },
      })

      return { ok: true, pr_url: pr.url, pr_number: pr.number }
    }
  }

  // ── Review tools — Tara only ─────────────────────────────────────────────────
  if (jugnuKey === 'tara') {
    definitions.push({
      name: 'review_pr',
      description: 'Submit a review on the GitHub PR.',
      input_schema: {
        type: 'object' as const,
        properties: {
          pr_number: { type: 'number' },
          verdict: { type: 'string', enum: ['approved', 'changes_requested', 'blocked'] },
          comment: { type: 'string', description: 'Review summary visible in the project channel.' },
        },
        required: ['pr_number', 'verdict', 'comment'],
      },
    })

    handlers['review_pr'] = async (input) => {
      const install = await getInstallationForProject(projectId, db)
      if (!install) return { error: 'No GitHub installation found.' }
      const octokit = await getInstallationOctokit(install.installation_id)
      const [owner, repo] = install.repo_full_name.split('/')

      const ghVerdict = input.verdict === 'approved' ? 'APPROVE' : 'REQUEST_CHANGES'
      await octokit.rest.pulls.createReview({
        owner, repo,
        pull_number: input.pr_number as number,
        event: ghVerdict,
        body: input.comment as string,
      })

      await db.from('messages').insert({
        project_id: projectId,
        author_type: 'jugnu',
        author_key: 'tara',
        content: input.verdict === 'approved'
          ? `✅ **Tara approved** PR #${input.pr_number}. ${input.comment}`
          : `🔁 **Tara requested changes** on PR #${input.pr_number}. ${input.comment}`,
        task_id: taskId,
        metadata: { review_verdict: input.verdict },
      })

      return { ok: true, verdict: input.verdict }
    }
  }

  return { definitions, handlers }
}
