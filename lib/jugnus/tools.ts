import type Anthropic from '@anthropic-ai/sdk'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { JugnuKey } from './registry'
import { writeFile, readFile, listFiles } from '../storage/files'
import { pushProjectToGitHub } from './github'
import { getPreviewUrl } from './deploy-static'

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
    // Nia: auto-assemble design/assembled.html from section files if not already written
    if (jugnuKey === 'nia') {
      const { data: existingAssembled } = await db
        .from('file_snapshots')
        .select('id')
        .eq('project_id', projectId)
        .eq('path', 'design/assembled.html')
        .maybeSingle()

      if (!existingAssembled) {
        const { data: sections } = await db
          .from('file_snapshots')
          .select('path, content')
          .eq('project_id', projectId)
          .ilike('path', 'design/%.html')
          .order('path', { ascending: true })

        if (sections && sections.length > 0) {
          const SECTION_ORDER = ['hero', 'problem', 'features', 'proof', 'cta', 'footer']
          const sorted = [...sections].sort((a, b) => {
            const ai = SECTION_ORDER.findIndex((s) => a.path.includes(s))
            const bi = SECTION_ORDER.findIndex((s) => b.path.includes(s))
            return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
          })
          const body = sorted.map((f) => f.content).join('\n\n')
          const assembled = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Landing Page</title>
<style>*, *::before, *::after { box-sizing: border-box; } body { margin: 0; font-family: system-ui, -apple-system, sans-serif; }</style>
</head>
<body>
${body}
</body>
</html>`
          await writeFile(projectId, taskId, 'design/assembled.html', assembled, db)
        }
      }
    }

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
      metadata: { event_type: 'TASK_COMPLETED', jugnu_key: jugnuKey },
    })
    return { ok: true }
  }

  // ── Maya tools ───────────────────────────────────────────────────────────────
  if (jugnuKey === 'maya') {
    definitions.push({
      name: 'ask_founder',
      description: 'Ask the founder clarifying questions with structured MCQ options. Call this IMMEDIATELY without any text output — the tool posts your question. Ask all questions in one call.',
      input_schema: {
        type: 'object' as const,
        properties: {
          questions: {
            type: 'array',
            description: 'List of clarifying questions with answer choices',
            items: {
              type: 'object' as const,
              properties: {
                text: { type: 'string', description: 'The question text' },
                options: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Answer choices. Always include "Something else" as the last option.',
                },
              },
              required: ['text', 'options'],
            },
          },
        },
        required: ['questions'],
      },
    })

    handlers['ask_founder'] = async (input) => {
      const questions = (input.questions as Array<{ text: string; options: string[] }>) ?? []
      const combinedQuestion = questions.map((q, i) => `${i + 1}. ${q.text}`).join('\n')

      // Build markdown content for the message bubble
      const lines: string[] = []
      if (questions.length === 1) {
        lines.push(`**${questions[0].text}**`)
        questions[0].options.forEach((opt) => lines.push(`  · ${opt}`))
      } else {
        lines.push(`Quick questions before I start planning:\n`)
        questions.forEach((q, i) => {
          lines.push(`**${i + 1}. ${q.text}**`)
          q.options.forEach((opt) => lines.push(`  · ${opt}`))
          lines.push('')
        })
      }

      await db.from('escalations').insert({
        project_id: projectId, task_id: taskId, jugnu_key: 'maya',
        question: combinedQuestion, options: questions, status: 'pending',
      })
      await db.from('messages').insert({
        project_id: projectId, author_type: 'jugnu', author_key: 'maya',
        content: lines.join('\n').trim(),
        task_id: taskId,
        metadata: { event_type: 'CLARIFICATION_REQUIRED', questions, escalation: true },
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
                description: { type: 'string', description: 'Detailed instructions including all clarification answers as explicit constraints. For Leo: specify exactly which files to create.' },
                capability: { type: 'string', enum: ['design', 'build', 'review', 'approval'] },
                jugnu_key: { type: 'string', enum: ['nia', 'leo', 'tara', 'human'] },
                depends_on_indices: {
                  type: 'array',
                  items: { type: 'number' },
                  description: '0-based indices of tasks that must complete first.',
                },
              },
              required: ['title', 'description', 'capability', 'jugnu_key'],
            },
          },
          jugnu_roles: {
            type: 'object',
            description: 'Domain-specific display roles for each jugnu on this project.',
            properties: {
              maya: { type: 'object', properties: { display_role: { type: 'string' }, focus: { type: 'string' } }, required: ['display_role', 'focus'] },
              nia:  { type: 'object', properties: { display_role: { type: 'string' }, focus: { type: 'string' } }, required: ['display_role', 'focus'] },
              leo:  { type: 'object', properties: { display_role: { type: 'string' }, focus: { type: 'string' } }, required: ['display_role', 'focus'] },
              tara: { type: 'object', properties: { display_role: { type: 'string' }, focus: { type: 'string' } }, required: ['display_role', 'focus'] },
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
      const jugnu_roles = input.jugnu_roles as Record<string, { display_role: string; focus: string }> | undefined

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

      // Store jugnu_roles in project constraints for context injection
      if (jugnu_roles) {
        const { data: proj } = await db.from('projects').select('constraints').eq('id', projectId).single()
        const existing = (proj?.constraints ?? {}) as Record<string, unknown>
        await db.from('projects').update({
          status: 'building',
          constraints: { ...existing, jugnu_roles },
        }).eq('id', projectId)
      } else {
        await db.from('projects').update({ status: 'building' }).eq('id', projectId)
      }

      await db.from('messages').insert({
        project_id: projectId, author_type: 'jugnu', author_key: jugnuKey,
        content: `✨ Plan assembled — ${rawTasks.length} task${rawTasks.length !== 1 ? 's' : ''} queued for the team.`,
        metadata: { event_type: 'PLAN_CREATED', task_count: rawTasks.length },
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
        task_id: taskId,
        metadata: { event_type: 'FILE_WRITTEN', file_write: true, path: input.path, jugnu_key: jugnuKey },
      })
      return result
    }
  }

  // ── Submit for review — Leo only ─────────────────────────────────────────────
  if (jugnuKey === 'leo') {
    definitions.push({
      name: 'submit_for_review',
      description: 'Submit all written files for Tara\'s review. Call this after writing all files — it ends your turn. The system will validate that a previewable HTML file exists before proceeding.',
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

      // ── Build validation ────────────────────────────────────────────────────
      // For the alpha target (HTML pages/campaigns), validate that a previewable
      // HTML file exists and has minimum structure. Throw on failure so Leo sees
      // the error and can fix it before submitting again.
      const { data: htmlFiles } = await db
        .from('file_snapshots')
        .select('path, content')
        .eq('project_id', projectId)
        .ilike('path', '%.html')
        .not('path', 'ilike', 'design/%')

      const buildErrors: string[] = []
      let primaryHtmlFile: string | null = null

      if (!htmlFiles || htmlFiles.length === 0) {
        buildErrors.push('No HTML file found outside design/. For the alpha, output must include at least one .html file (e.g. index.html) that the founder can preview. Write the HTML file and call submit_for_review again.')
      } else {
        const preferred = htmlFiles.find((f) => f.path === 'index.html') ?? htmlFiles[0]
        primaryHtmlFile = preferred.path
        const html = preferred.content ?? ''
        if (html.length < 200) buildErrors.push(`${preferred.path} appears too short (${html.length} chars). Write a complete page.`)
        if (!html.toLowerCase().includes('<body')) buildErrors.push(`${preferred.path} is missing a <body> tag. Output must be a complete HTML page.`)
        if (!html.toLowerCase().includes('</html>')) buildErrors.push(`${preferred.path} appears to be a fragment. Write a complete HTML document with <html>, <head>, and <body>.`)
      }

      if (buildErrors.length > 0) {
        // Throw so dispatch.ts marks this as is_error and Leo continues working
        throw new Error(`Build validation failed:\n${buildErrors.map((e) => `• ${e}`).join('\n')}`)
      }

      const previewUrl = getPreviewUrl(projectId)
      const buildEvidence = {
        html_valid: true,
        primary_html_file: primaryHtmlFile,
        preview_url: previewUrl,
        files_checked: (htmlFiles ?? []).map((f) => f.path),
        checked_at: new Date().toISOString(),
      }

      if (taskId) {
        await db.from('tasks').update({
          status: 'completed',
          result: input.summary,
          artifact: {
            type: 'files',
            paths: files.map((f) => f.path),
            build_evidence: buildEvidence,
          },
          completed_at: new Date().toISOString(),
        }).eq('id', taskId)
      }

      const { data: fullFiles } = await db
        .from('file_snapshots')
        .select('path, content')
        .eq('project_id', projectId)
        .order('path', { ascending: true })

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
        content: `🔀 **Leo submitted ${files.length} file${files.length !== 1 ? 's' : ''} for review.**\n\n${input.summary}\n\n✅ Build check passed — preview available at [${previewUrl}](${previewUrl})${prLine}`,
        task_id: taskId,
        metadata: { event_type: 'REVIEW_STARTED', review_ready: true, file_count: files.length, pr_url: prUrl, build_evidence: buildEvidence },
      })
      return { ok: true, files_submitted: files.length, preview_url: previewUrl }
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
      // Hard gate: if build evidence shows html_valid:false, Tara cannot approve
      const { data: leoTask } = await db
        .from('tasks')
        .select('artifact')
        .eq('project_id', projectId)
        .eq('jugnu_key', 'leo')
        .eq('status', 'completed')
        .order('completed_at', { ascending: false })
        .limit(1)
        .single()

      const buildEvidence = (leoTask?.artifact as Record<string, unknown> | null)?.build_evidence as Record<string, unknown> | undefined
      if (buildEvidence && buildEvidence.html_valid === false) {
        throw new Error('Cannot approve: build evidence shows html_valid is false. Use request_changes to ask Leo to fix the HTML output.')
      }

      if (taskId) {
        await db.from('tasks').update({
          status: 'completed',
          result: input.comment,
          completed_at: new Date().toISOString(),
        }).eq('id', taskId)
      }

      const liveUrl = buildEvidence?.preview_url
        ? String(buildEvidence.preview_url)
        : (() => {
            // Fallback: check for HTML files if no build evidence (e.g. older projects)
            return null
          })()

      const deployLine = liveUrl ? `\n\n🌐 [**View live →**](${liveUrl})` : ''

      // Note whether this was an LLM-judged approval vs deterministically verified
      const verificationNote = buildEvidence?.html_valid === true
        ? `\n\n*Deterministic check: HTML output present and structurally valid. Content review is LLM judgement.*`
        : `\n\n*Note: No deterministic build evidence available. This approval is based on LLM judgement only.*`

      await db.from('projects').update({ status: 'completed' }).eq('id', projectId)

      await db.from('messages').insert({
        project_id: projectId, author_type: 'jugnu', author_key: 'tara',
        content: `✅ **Tara approved the work.**\n\n${input.comment}${deployLine}${verificationNote}`,
        task_id: taskId,
        metadata: { event_type: 'REVIEW_PASSED', review_verdict: 'approved', project_complete: true, live_url: liveUrl, build_verified: buildEvidence?.html_valid === true },
      })
      return { ok: true, verdict: 'approved' }
    }

    definitions.push({
      name: 'request_changes',
      description: 'Request changes from Leo. Describe exactly what needs to be fixed. Do not call this if Leo has already revised once — approve with reservations instead.',
      input_schema: {
        type: 'object' as const,
        properties: {
          feedback: { type: 'string', description: 'Specific changes required, file by file if possible.' },
        },
        required: ['feedback'],
      },
    })

    handlers['request_changes'] = async (input) => {
      // Count how many Leo tasks are already completed — cap at 1 revision cycle
      const { count: leoRevisions } = await db
        .from('tasks')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', projectId)
        .eq('jugnu_key', 'leo')
        .eq('status', 'completed')

      if ((leoRevisions ?? 0) >= 2) {
        // Correction loop bound reached — escalate instead of another revision
        await db.from('messages').insert({
          project_id: projectId, author_type: 'jugnu', author_key: 'tara',
          content: `⚠️ **Tara: review cycle limit reached.**\n\nAfter two revision cycles, the following issues remain:\n\n${input.feedback}\n\nPlease review and decide how to proceed.`,
          task_id: taskId,
          metadata: { event_type: 'REVIEW_FAILED', escalation: true, feedback: input.feedback },
        })
        if (taskId) {
          await db.from('tasks').update({
            status: 'completed',
            result: `Escalated after correction limit: ${input.feedback}`,
            completed_at: new Date().toISOString(),
          }).eq('id', taskId)
        }
        return { ok: true, verdict: 'escalated' }
      }

      if (taskId) {
        await db.from('tasks').update({
          status: 'completed',
          result: `Changes requested: ${input.feedback}`,
          completed_at: new Date().toISOString(),
        }).eq('id', taskId)
      }

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
        task_id: taskId,
        metadata: { event_type: 'TASK_RETURNED', review_verdict: 'changes_requested' },
      })

      return { ok: true, verdict: 'changes_requested' }
    }
  }

  return { definitions, handlers }
}
