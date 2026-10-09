import type Anthropic from '@anthropic-ai/sdk'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { JugnuKey } from './registry'
import { writeFile, readFile, listFiles } from '../storage/files'
import { flags } from '../feature-flags'

import { getPreviewUrl } from './deploy-static'

// Extracts visible UI labels from Nia's design HTML so Tara knows what to verify.
function extractNiaComponents(html: string): string {
  const seen = new Set<string>()
  const items: string[] = []
  // headings, buttons, labels, list items, table headers — things that identify features
  const re = /<(button|h1|h2|h3|h4|label|th|li)[^>]*>([^<]{3,60})<\/\1>/gi
  for (const m of html.matchAll(re)) {
    const text = m[2].trim().replace(/\s+/g, ' ')
    if (text && !seen.has(text)) { seen.add(text); items.push(text) }
  }
  return items.slice(0, 16).join(' · ')
}

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
    // Nia: auto-assemble design/assembled.html from section files if not already written.
    // Wrapped in try/catch so a transient storage error never prevents task completion.
    if (jugnuKey === 'nia') {
      try {
        const { data: sections } = await db
            .from('file_snapshots')
            .select('path, content')
            .eq('project_id', projectId)
            .ilike('path', 'design/%.html')
            .neq('path', 'design/assembled.html')
            .order('path', { ascending: true })

          if (sections && sections.length > 0) {
            // Read tokens.css if Maya seeded it
            const { data: tokensFile } = await db.from('file_snapshots')
              .select('content').eq('project_id', projectId).eq('path', 'design/tokens.css').maybeSingle()
            const tokensStyle = tokensFile?.content ? `\n<style>\n${tokensFile.content}\n</style>` : ''
            const fontsImportMatch = tokensFile?.content?.match(/@import url\(['"]([^'"]+)['"]\);?/)
            const fontsLink = fontsImportMatch
              ? `\n<link rel="preconnect" href="https://fonts.googleapis.com">\n<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n<link href="${fontsImportMatch[1]}" rel="stylesheet">`
              : ''

            // PATH A: screen files (design/screen-NN-*.html) — wrap each fragment in phone-grid layout
            const isPathA = sections.some((f) => /design\/screen-\d/.test(f.path))

            let assembled: string
            if (isPathA) {
              const screenFiles = sections
                .filter((f) => /design\/screen-\d/.test(f.path))
                .sort((a, b) => a.path.localeCompare(b.path))
              const screenBlocks = screenFiles.map((f) => f.content).join('\n\n')
              assembled = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Screen Designs</title>${fontsLink}
<style>
*, *::before, *::after { box-sizing: border-box; }
body { margin: 0; background: #F0EDE8; font-family: sans-serif; padding: 40px 20px; }
.screens-grid { display: flex; flex-wrap: wrap; gap: 40px; justify-content: center; }
.screen-block { display: flex; flex-direction: column; align-items: center; gap: 12px; }
.screen-label { font-weight: 700; font-size: 0.9rem; color: #555; letter-spacing: 0.02em; }
.phone-frame { width: 390px; min-height: 844px; background: white; border-radius: 40px; box-shadow: 0 20px 60px rgba(0,0,0,0.15); overflow: hidden; position: relative; }
.screen { width: 100%; min-height: 844px; padding: 48px 24px 32px; }
</style>${tokensStyle}
</head>
<body>
<div class="screens-grid">
${screenBlocks}
</div>
</body>
</html>`
            } else {
              // PATH B: landing page sections — sort by logical flow, concatenate
              const SECTION_ORDER = ['hero', 'what', 'about', 'benefits', 'features', 'product', 'proof', 'testimonial', 'why', 'how', 'process', 'pricing', 'cta', 'order', 'contact']
              const sorted = [...sections].sort((a, b) => {
                if (a.path.includes('footer')) return 1
                if (b.path.includes('footer')) return -1
                const ai = SECTION_ORDER.findIndex((s) => a.path.includes(s))
                const bi = SECTION_ORDER.findIndex((s) => b.path.includes(s))
                return (ai === -1 ? 50 : ai) - (bi === -1 ? 50 : bi)
              })
              const body = sorted.map((f) => f.content).join('\n\n')
              assembled = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Landing Page</title>${fontsLink}
<script src="https://cdn.tailwindcss.com"></script>
<script>tailwind.config = { theme: { extend: { colors: { primary: 'var(--color-primary)', accent: 'var(--color-accent)', bg: 'var(--color-bg)' }, fontFamily: { display: 'var(--font-display)', body: 'var(--font-body)' } } } }</script>
<style>*, *::before, *::after { box-sizing: border-box; } body { margin: 0; }</style>${tokensStyle}
</head>
<body>
${body}
</body>
</html>`
            }

            await writeFile(projectId, taskId, 'design/assembled.html', assembled, db)
          }
      } catch {
        // Transient write failure — skip assembled.html; task completion must not be blocked
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
      description: 'Ask the founder ONE clarifying question with structured MCQ options. Call this IMMEDIATELY without any text output — the tool posts your question. ONE question per call — never batch multiple questions.',
      input_schema: {
        type: 'object' as const,
        properties: {
          questions: {
            type: 'array',
            description: 'Exactly one question. maxItems: 1 — never include more than one entry.',
            maxItems: 1,
            items: {
              type: 'object' as const,
              properties: {
                text: { type: 'string', description: 'The question text' },
                options: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Answer choices. Always include "Something else" as the last option.',
                },
                category: {
                  type: 'string',
                  enum: ['build_tier', 'core_action', 'all_features', 'data', 'empty_error', 'users_access', 'explicit_exclusions', 'wrap_up'],
                  description: 'Quiz category this question belongs to. Required for Maya quiz questions — used to verify all categories are covered before planning.',
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
      // Hard gate: if ai_skip_quiz is set, this tool must not proceed.
      // Returning an error forces Maya to call create_task_plan instead.
      const { data: projForSkip } = await db.from('projects').select('constraints').eq('id', projectId).single()
      const constraintsForSkip = ((projForSkip?.constraints ?? {}) as Record<string, unknown>)
      if (constraintsForSkip.ai_skip_quiz === true) {
        return {
          ok: false,
          blocked: true,
          reason: 'ai_skip_quiz is true — the founder selected "Let AI answer all remaining questions". You are NOT allowed to call ask_founder again. Infer reasonable answers for every uncovered category and call create_task_plan immediately.',
        }
      }

      const questions = (input.questions as Array<{ text: string; options: string[]; category?: string }>) ?? []

      // For quiz questions (not tier selection or tier upgrade), always inject the two
      // standard shortcut options at the top so the founder can always skip with one tap.
      const FIXED_OPTS = ['Let AI decide', 'Let AI answer all remaining questions']
      const NON_QUIZ_CATEGORIES = new Set(['build_tier', 'tier_upgrade'])
      const questionsWithFixedOpts = questions.map((q) => {
        if (NON_QUIZ_CATEGORIES.has(q.category ?? '')) return q
        const filtered = (q.options ?? []).filter((o) => !FIXED_OPTS.includes(o))
        return { ...q, options: [...FIXED_OPTS, ...filtered] }
      })

      const combinedQuestion = questionsWithFixedOpts.map((q, i) => `${i + 1}. ${q.text}`).join('\n')

      // Build markdown content for the message bubble
      const lines: string[] = []
      if (questionsWithFixedOpts.length === 1) {
        lines.push(`**${questionsWithFixedOpts[0].text}**`)
        questionsWithFixedOpts[0].options.forEach((opt) => lines.push(`  · ${opt}`))
      } else {
        lines.push(`Quick questions before I start planning:\n`)
        questionsWithFixedOpts.forEach((q, i) => {
          lines.push(`**${i + 1}. ${q.text}**`)
          q.options.forEach((opt) => lines.push(`  · ${opt}`))
          lines.push('')
        })
      }

      await db.from('escalations').insert({
        project_id: projectId, task_id: taskId, jugnu_key: 'maya',
        question: combinedQuestion, options: questionsWithFixedOpts, status: 'pending',
      })
      await db.from('messages').insert({
        project_id: projectId, author_type: 'jugnu', author_key: 'maya',
        content: lines.join('\n').trim(),
        task_id: taskId,
        metadata: { event_type: 'CLARIFICATION_REQUIRED', questions: questionsWithFixedOpts, escalation: true },
      })
      return { ok: true, waiting_for_founder: true }
    }

    definitions.push({
      name: 'join_v2_waitlist',
      description: 'Record that the founder wants to be notified when a v2.0 feature ships. Call this when the founder selects "Join v2.0 waitlist". Then proceed with planning as if they chose "Continue without these features".',
      input_schema: {
        type: 'object' as const,
        properties: {
          features: {
            type: 'array',
            items: { type: 'string' },
            description: 'List of v2.0 feature names the founder wants — e.g. ["E-commerce / payments", "User authentication"]',
          },
        },
        required: ['features'],
      },
    })

    handlers['join_v2_waitlist'] = async (input) => {
      const features = (input.features as string[]) ?? []
      const { data: proj } = await db.from('projects').select('workspace_id').eq('id', projectId).single()

      await db.from('form_submissions').insert({
        project_id: projectId,
        form_type: 'v2_waitlist',
        data: { features, workspace_id: proj?.workspace_id ?? null },
      })

      await db.from('messages').insert({
        project_id: projectId,
        author_type: 'jugnu',
        author_key: 'maya',
        content: `✅ Got it! I've added you to the v2.0 waitlist for: **${features.join(', ')}**. You'll be notified when it ships. Continuing with what's available now…`,
        metadata: { event_type: 'V2_WAITLIST_JOINED', features },
      })

      return { ok: true, waitlisted: features }
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
                eta: { type: 'string', description: 'Project-specific time estimate shown to the founder, e.g. "~2–3 min". Base it on the brief complexity — a simple landing page is shorter than a multi-section app.' },
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
          build_tier: {
            type: 'string',
            enum: ['quick', 'balanced', 'premium'],
            description: 'Build quality tier. quick = all Haiku (~10–20 min, from ₹10), balanced = Haiku design + Sonnet build (~25–40 min, from ₹50), premium = Sonnet everywhere (~40–60 min, from ₹120). Use the founder\'s original tier answer — BUT if FOUNDER DECISIONS contains a tier_upgrade entry where the founder said yes, use "premium" regardless of the original choice.',
          },
          acceptance_criteria: {
            type: 'array',
            description: 'Acceptance criteria compiled from the requirements quiz. Each item is something Tara will verify against the final build.',
            items: {
              type: 'object',
              properties: {
                id:             { type: 'string', description: 'Short unique id e.g. "ac-001"' },
                description:    { type: 'string', description: 'Clear, testable statement: "User can [action]" or "System must [behaviour]"' },
                category:       { type: 'string', description: 'flow | data | ux | constraint | access' },
                question:       { type: 'string', description: 'The exact question that was asked' },
                founder_answer: { type: 'string', description: 'Founder answer verbatim, or null if skipped' },
                source:         { type: 'string', enum: ['founder', 'inferred'] },
              },
              required: ['id', 'description', 'source'],
            },
          },
          design_tokens: {
            type: 'object',
            description: 'Brand design tokens for web page projects. Provide these for any landing page, campaign page, or HTML output — Nia and Leo will use them as CSS custom properties instead of hardcoded values.',
            properties: {
              primary_color:   { type: 'string', description: 'Main brand color as hex, e.g. "#1E5C2A"' },
              accent_color:    { type: 'string', description: 'CTA / highlight color as hex, e.g. "#F5A623"' },
              bg_color:        { type: 'string', description: 'Page background color as hex, e.g. "#F5ECD7"' },
              text_color:      { type: 'string', description: 'Primary text color as hex, e.g. "#1A1A1A"' },
              text_muted:      { type: 'string', description: 'Secondary / muted text color as hex, e.g. "#6B4C3A"' },
              display_font:    { type: 'string', description: 'Google Font name for headings, e.g. "Playfair Display"' },
              body_font:       { type: 'string', description: 'Google Font name for body text, e.g. "Inter"' },
            },
            required: ['primary_color', 'accent_color', 'bg_color', 'display_font', 'body_font'],
          },
        },
        required: ['tasks'],
      },
    })

    handlers['create_task_plan'] = async (input) => {
      let rawTasks = input.tasks as Array<{
        title: string; description: string; capability: string
        jugnu_key: string; eta?: string; depends_on_indices?: number[]
      }>
      const jugnu_roles = input.jugnu_roles as Record<string, { display_role: string; focus: string }> | undefined
      const build_tier = (input.build_tier as string | undefined) ?? 'balanced'
      const design_tokens = input.design_tokens as {
        primary_color: string; accent_color: string; bg_color: string
        text_color?: string; text_muted?: string; display_font: string; body_font: string
      } | undefined

      // Phase 7: dynamic routing — use DecisionEngine to decide which specialists to invoke
      if (flags.DYNAMIC_AGENT_ROUTING) {
        const { decide } = await import('../engines/decision')
        const { data: proj } = await db.from('projects').select('objective').eq('id', projectId).single()
        const objective = (proj?.objective as string) ?? ''
        const { count: clarCount } = await db.from('messages')
          .select('id', { count: 'exact', head: true })
          .eq('project_id', projectId)
          .contains('metadata', { event_type: 'CLARIFICATION_REQUIRED' })
        const { data: userMsgs } = await db.from('messages')
          .select('metadata').eq('project_id', projectId).eq('author_type', 'user').limit(10)
        const hasAttachments = (userMsgs ?? []).some(
          (m) => Array.isArray((m.metadata as Record<string, unknown>)?.attachments)
        )

        const ctx = {
          objective,
          briefLength: objective.length,
          hasAttachments,
          previousClarificationCount: clarCount ?? 0,
          retryCount: 0,
          taskFailureCount: 0,
        }

        const niaDec = await decide('needs_nia', ctx, db, projectId, taskId)
        if (niaDec === 'SKIP_NIA') {
          rawTasks = rawTasks.filter((t) => t.jugnu_key !== 'nia')
          if (taskId) {
            await db.from('tasks').update({ routing_decision: 'SKIP_NIA' }).eq('id', taskId)
          }
          await db.from('messages').insert({
            project_id: projectId,
            author_type: 'activity',
            author_key: 'maya',
            content: '⚡ Skipping design step — brief is clear enough to build directly.',
            metadata: { event_type: 'ROUTING_DECISION', skipped: 'nia', reason: 'brief_sufficient' },
          })
        } else if (taskId) {
          await db.from('tasks').update({ routing_decision: niaDec }).eq('id', taskId)
        }
      }

      // Seed design/tokens.css so Nia and Leo have a consistent design system to reference
      if (design_tokens) {
        const { primary_color, accent_color, bg_color, text_color = '#1A1A1A', text_muted = '#666666', display_font, body_font } = design_tokens
        const googleFontsUrl = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(display_font)}:wght@400;700&family=${encodeURIComponent(body_font)}:wght@400;500;600&display=swap`
        const tokensCss = `@import url('${googleFontsUrl}');

:root {
  --color-primary: ${primary_color};
  --color-accent: ${accent_color};
  --color-bg: ${bg_color};
  --color-text: ${text_color};
  --color-text-muted: ${text_muted};
  --font-display: '${display_font}', Georgia, serif;
  --font-body: '${body_font}', system-ui, sans-serif;
  --radius: 8px;
  --radius-lg: 16px;
  --section-padding: 80px 20px;
  --container-max: 1200px;
}

/* Base layout */
.section-container { max-width: var(--container-max); margin: 0 auto; width: 100%; }
.section-pad { padding: var(--section-padding); }

/* Typography */
.heading-xl { font-family: var(--font-display); font-size: clamp(2.5rem, 6vw, 4rem); color: var(--color-primary); line-height: 1.15; font-weight: 700; }
.heading-lg { font-family: var(--font-display); font-size: clamp(1.8rem, 4vw, 3rem); color: var(--color-primary); line-height: 1.25; font-weight: 700; }
.heading-md { font-family: var(--font-display); font-size: clamp(1.2rem, 2.5vw, 1.75rem); color: var(--color-primary); line-height: 1.35; font-weight: 700; }
.body-text { font-family: var(--font-body); color: var(--color-text-muted); line-height: 1.75; font-size: 1.05rem; }

/* Buttons */
.btn { display: inline-block; font-family: var(--font-body); font-weight: 600; text-decoration: none; border: none; cursor: pointer; transition: all 0.25s ease; letter-spacing: 0.3px; }
.btn-primary { background: var(--color-primary); color: var(--color-bg); padding: 14px 40px; border-radius: 50px; }
.btn-primary:hover { filter: brightness(1.1); transform: translateY(-2px); }
.btn-accent { background: var(--color-accent); color: #fff; padding: 16px 48px; border-radius: 50px; font-size: 1.1rem; }
.btn-accent:hover { filter: brightness(1.1); transform: translateY(-2px); }

/* Cards */
.card { background: #fff; border-radius: var(--radius-lg); padding: 32px; box-shadow: 0 4px 20px rgba(0,0,0,0.06); }
.card-bordered { border-top: 4px solid var(--color-accent); }

/* Grid */
.grid-auto { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 24px; }
.grid-2col { display: grid; grid-template-columns: 1fr 1fr; gap: 48px; align-items: center; }

/* Responsive */
@media (max-width: 768px) {
  .grid-2col { grid-template-columns: 1fr; gap: 32px; }
  :root { --section-padding: 48px 16px; }
}`
        await writeFile(projectId, null, 'design/tokens.css', tokensCss, db)
      }

      // Idempotency guard — only block if active (pending/in_progress) non-Maya tasks exist.
      // Completed tasks from a previous run (e.g. revision mode) are fine to coexist.
      const { count: activePipelineTasks } = await db.from('tasks')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', projectId)
        .neq('jugnu_key', 'maya')
        .in('status', ['pending', 'in_progress'])
      if ((activePipelineTasks ?? 0) > 0) {
        return { success: false, error: 'Active pipeline tasks already exist. Do not call create_task_plan more than once.' }
      }

      // Fetch project constraints once — used for both revision mode and quiz gate.
      const { data: projForRevision } = await db.from('projects').select('constraints').eq('id', projectId).single()
      const projConstraints = (projForRevision?.constraints ?? {}) as Record<string, unknown>
      const isRevision = projConstraints?.revision_mode === true
      const aiSkipQuiz = projConstraints?.ai_skip_quiz === true
      const sortBase = isRevision ? 10000 : 0

      type FounderQA = { question: string; answer: string; category?: string; is_revision?: boolean }
      const allFounderQAs = (projConstraints?.founder_constraints as FounderQA[]) ?? []
      const incomingCriteria = input.acceptance_criteria as Array<unknown> | undefined

      if (!isRevision) {
        // Categories gate — skip when founder chose "Let AI answer all remaining questions"
        if (!aiSkipQuiz) {
          const coveredCategories = new Set(allFounderQAs.map((q) => q.category).filter(Boolean))
          const REQUIRED_CATEGORIES = ['core_action', 'all_features', 'data', 'empty_error', 'users_access', 'explicit_exclusions'] as const
          const missing = REQUIRED_CATEGORIES.filter((c) => !coveredCategories.has(c))

          if (missing.length > 0) {
            const labels: Record<string, string> = {
              core_action: 'Core action', all_features: 'All features', data: 'Data',
              empty_error: 'Empty & error states', users_access: 'Users & access',
              explicit_exclusions: 'Explicit exclusions',
            }
            return {
              success: false,
              error: `Quiz incomplete — the following categories have not been asked yet: ${missing.map((c) => labels[c]).join(', ')}. Ask a question for each missing category with ask_founder before calling create_task_plan.`,
            }
          }
        }

        if (!incomingCriteria || incomingCriteria.length < 10) {
          return {
            success: false,
            error: `Quiz incomplete — only ${incomingCriteria?.length ?? 0} acceptance criteria provided (minimum 10 required). Compile specific, testable criteria from all the founder's answers.`,
          }
        }
      } else {
        // Revision gate — core_action must be covered in the revision quiz and criteria must be present.
        const revisionQAs = allFounderQAs.filter((q) => q.is_revision)
        const revisionCategories = new Set(revisionQAs.map((q) => q.category).filter(Boolean))

        if (!revisionCategories.has('core_action')) {
          return {
            success: false,
            error: `Revision quiz incomplete — no core_action question asked yet. Start with ask_founder to clarify exactly what changes: every screen, button, and interaction affected. Tag the question with category: "core_action".`,
          }
        }

        if (!incomingCriteria || incomingCriteria.length < 3) {
          return {
            success: false,
            error: `Revision quiz incomplete — only ${incomingCriteria?.length ?? 0} acceptance criteria provided (minimum 3 required for a revision). Compile testable criteria from the revision Q&As.`,
          }
        }
      }

      const insertedIds: string[] = []
      for (let i = 0; i < rawTasks.length; i++) {
        const t = rawTasks[i]
        const dependsOn = (t.depends_on_indices ?? []).map((idx) => insertedIds[idx]).filter(Boolean)
        const { data } = await db.from('tasks').insert({
          project_id: projectId, title: t.title, description: t.description,
          capability: t.capability, jugnu_key: t.jugnu_key,
          eta: t.eta ?? null,
          depends_on: dependsOn, sort_order: sortBase + i, status: 'pending',
        }).select('id').single()
        insertedIds.push(data?.id ?? '')
      }

      // Store jugnu_roles, build_tier, and acceptance_criteria in project constraints
      {
        const acceptance_criteria = input.acceptance_criteria as Array<Record<string, unknown>> | undefined
        const { data: proj } = await db.from('projects').select('constraints').eq('id', projectId).single()
        const existing = (proj?.constraints ?? {}) as Record<string, unknown>
        await db.from('projects').update({
          status: 'building',
          constraints: {
            ...existing,
            build_tier,
            ...(jugnu_roles ? { jugnu_roles } : {}),
            ...(acceptance_criteria?.length ? { acceptance_criteria } : {}),
          },
        }).eq('id', projectId)
      }

      // Auto-complete Maya's own task — prevents a second dispatch and eliminates
      // the need for Maya to call complete_task separately (which caused the double-run window)
      if (taskId) {
        await db.from('tasks').update({
          status: 'completed',
          result: `Plan assembled — ${rawTasks.length} tasks queued.`,
          completed_at: new Date().toISOString(),
        }).eq('id', taskId)
      }

      await db.from('messages').insert({
        project_id: projectId, author_type: 'jugnu', author_key: jugnuKey,
        content: `✨ Plan assembled — ${rawTasks.length} task${rawTasks.length !== 1 ? 's' : ''} queued for the team.`,
        metadata: { event_type: 'PLAN_CREATED', task_count: rawTasks.length },
      })
      return { ok: true, task_count: rawTasks.length, ids: insertedIds }
    }
  }

  // ── request_info — Nia, Leo, Tara: pause mid-execution to ask for real data ──
  if (['nia', 'leo', 'tara'].includes(jugnuKey)) {
    definitions.push({
      name: 'request_info',
      description: 'Pause your work and ask the founder for specific real-world details you need (address, phone, email, hours, prices, names). Call this BEFORE writing placeholder values. Group ALL missing info into ONE call — do not call multiple times. You will be re-dispatched after the founder answers to fill in the real values.',
      input_schema: {
        type: 'object' as const,
        properties: {
          reason: { type: 'string', description: 'One sentence explaining why you need this info, shown to the founder. E.g. "I need a few details to complete the Contact section."' },
          fields: {
            type: 'array',
            description: 'The specific pieces of info needed.',
            items: {
              type: 'object' as const,
              properties: {
                label:       { type: 'string', description: 'Short field name. E.g. "Shop address", "Phone number", "Opening hours"' },
                why:         { type: 'string', description: 'One short phrase saying where it appears. E.g. "shown in footer and Google Maps link"' },
                placeholder: { type: 'string', description: 'What you will use if skipped. E.g. "123 Main Street, City"' },
              },
              required: ['label', 'why', 'placeholder'],
            },
          },
        },
        required: ['reason', 'fields'],
      },
    })

    handlers['request_info'] = async (input) => {
      const reason = input.reason as string
      const fields = (input.fields as Array<{ label: string; why: string; placeholder: string }>) ?? []

      // Build MCQ questions — "Something else" triggers the free-text input in InlineClarification
      const questions = fields.map((f) => ({
        text: `${f.label} — ${f.why}`,
        options: ['Something else', `Skip — use "${f.placeholder}"`],
      }))

      const lines: string[] = [`**${reason}**\n`]
      fields.forEach((f, i) => {
        lines.push(`**${i + 1}. ${f.label}** _(${f.why})_`)
      })

      await db.from('escalations').insert({
        project_id: projectId,
        task_id: taskId,
        jugnu_key: jugnuKey,
        question: fields.map((f) => f.label).join(', '),
        options: questions,
        status: 'pending',
      })
      await db.from('messages').insert({
        project_id: projectId,
        author_type: 'jugnu',
        author_key: jugnuKey,
        content: lines.join('\n').trim(),
        task_id: taskId,
        metadata: { event_type: 'INFO_REQUESTED', questions, escalation: true },
      })

      return { ok: true, waiting_for_founder: true }
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

  // ── Photo tools — Nia and Leo ────────────────────────────────────────────────
  if (jugnuKey === 'nia' || jugnuKey === 'leo') {
    definitions.push({
      name: 'search_photos',
      description: 'Search Unsplash for high-quality stock photos. Call this before writing any section that needs images. Returns real URLs to use as <img src="..."> tags. Pass exclude_urls when retrying after a rejection to guarantee a fresh result.',
      input_schema: {
        type: 'object' as const,
        properties: {
          query: { type: 'string', description: 'Specific search terms, e.g. "yoga studio sunrise" or "indian sweet shop interior colourful"' },
          count: { type: 'number', description: 'Number of photos to return (1–5, default 3)' },
          exclude_urls: { type: 'array', items: { type: 'string' }, description: 'URLs already used that must not appear in results — pass every previously embedded image URL for this section when retrying after a rejection' },
        },
        required: ['query'],
      },
    })

    handlers['search_photos'] = async (input) => {
      const query = input.query as string
      const count = Math.min(Math.max(Number(input.count ?? 3), 1), 5)
      const excludeUrls = new Set<string>((input.exclude_urls as string[] | undefined) ?? [])
      const key = process.env.UNSPLASH_ACCESS_KEY

      // Picsum fallback — real photos, consistent per query+offset, no API key needed
      const picsumFallback = (n: number) => {
        const photos = []
        let seed = 0
        while (photos.length < n) {
          const url = `https://picsum.photos/seed/${encodeURIComponent(query)}-${seed}/1200/630`
          if (!excludeUrls.has(url)) photos.push({ url, alt: query, photographer: 'Picsum Photos' })
          seed++
          if (seed > n + excludeUrls.size + 10) break // safety
        }
        return photos
      }

      if (!key) return { photos: picsumFallback(count) }

      try {
        // Fetch extra results so we have room to exclude already-used URLs
        const fetchCount = count + excludeUrls.size + 2
        const res = await fetch(
          `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=${Math.min(fetchCount, 30)}&orientation=landscape&client_id=${key}`
        )
        const data = await res.json() as { results: Array<{ urls: { regular: string }; alt_description: string | null; user: { name: string } }> }
        const photos = (data.results ?? [])
          .filter((p) => !excludeUrls.has(p.urls.regular))
          .slice(0, count)
          .map((p) => ({
            url: p.urls.regular,
            alt: p.alt_description ?? query,
            photographer: p.user.name,
          }))
        return { photos: photos.length > 0 ? photos : picsumFallback(count) }
      } catch (e) {
        return { photos: picsumFallback(count) }
      }
    }

    definitions.push({
      name: 'generate_image',
      description: 'Generate a custom AI image. IMPORTANT: check the result — if upgrade_required is true, immediately call search_photos as fallback instead.',
      input_schema: {
        type: 'object' as const,
        properties: {
          prompt: { type: 'string', description: 'Detailed image prompt describing the scene, mood, style, and colours.' },
        },
        required: ['prompt'],
      },
    })

    handlers['generate_image'] = async (input) => {
      const { generateImage } = await import('../engines/image')
      const { flags } = await import('../feature-flags')

      if (!flags.OPENAI_IMAGE_25 || !process.env.OPENAI_API_KEY) {
        // Only post the upgrade card once per project
        const { count } = await db.from('messages')
          .select('id', { count: 'exact', head: true })
          .eq('project_id', projectId)
          .contains('metadata', { event_type: 'UPGRADE_REQUIRED' })
        if ((count ?? 0) === 0) {
          await db.from('messages').insert({
            project_id: projectId,
            author_type: 'system',
            author_key: 'system',
            content: '✨ AI image generation is not yet enabled for this workspace.',
            metadata: { event_type: 'UPGRADE_REQUIRED', feature: 'ai_image_generation' },
          })
        }
        return { upgrade_required: true, message: 'Image generation is not enabled. Call search_photos immediately as a fallback.' }
      }

      // Count how many AI images have already been generated for this project
      const { count: generatedCount } = await db.from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', projectId)
        .contains('metadata', { event_type: 'IMAGE_GENERATED' })

      const result = await generateImage({
        prompt: input.prompt as string,
        alt: (input.alt as string) ?? (input.prompt as string),
        quality: (input.quality as 'standard' | 'premium') ?? 'standard',
        generatedCount: generatedCount ?? 0,
      })

      if (result.source === 'generated') {
        await db.from('messages').insert({
          project_id: projectId,
          author_type: 'activity',
          author_key: jugnuKey,
          content: `🎨 Generated image`,
          metadata: { event_type: 'IMAGE_GENERATED', url: result.url, cost_usd: result.costUsd, model: result.model },
        })
        return { url: result.url, alt: result.alt, source: 'generated' }
      }

      if (result.source === 'unavailable') {
        return { upgrade_required: false, message: result.reason, fallback: 'call search_photos' }
      }

      return { upgrade_required: false, message: 'Image unavailable', fallback: 'call search_photos' }
    }
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
      // Hard size gate — prevent multi-thousand-line writes that hang mid-inference.
      // Tiers: quick=600, balanced=1200, premium=1800 lines. Nia PATH A writes
      // one screen per file (~100–200 lines each), so this only triggers on genuine over-writes.
      const content = input.content as string
      const lineCount = content.split('\n').length
      const { data: tierProj } = await db.from('projects').select('constraints').eq('id', projectId).single()
      const tier = ((tierProj?.constraints as Record<string, unknown>)?.build_tier as string) ?? 'balanced'
      const LINE_LIMITS: Record<string, number> = { quick: 600, balanced: 1200, premium: 1800 }
      const limit = LINE_LIMITS[tier] ?? 1200
      if (lineCount > limit) {
        return { ok: false, error: `File too large: ${lineCount} lines exceeds the ${tier} tier limit of ${limit} lines. Split into smaller files or reduce content.` }
      }

      const result = await writeFile(projectId, taskId, input.path as string, content, db)
      // Nia's section writes are meaningful progress events — show as jugnu messages so they
      // appear in the chat thread. Leo's writes stay as activity (he updates one file many times).
      const niaSectionLabels: Record<string, string> = {
        'design/assembled.html': '🖼️ Screens designed — ready for your review',
        'design/intent.md':      '📝 Design direction set',
        'design/hero.html':      '🎨 Hero section designed',
        'design/problem.html':   '🎨 Problem / pain section designed',
        'design/features.html':  '🎨 Features section designed',
        'design/proof.html':     '🎨 Social proof section designed',
        'design/cta.html':       '🎨 CTA section designed',
        'design/footer.html':    '🎨 Footer designed',
      }
      const path = input.path as string
      const isNiaSection = jugnuKey === 'nia' && (path.startsWith('design/') || niaSectionLabels[path])
      await db.from('messages').insert({
        project_id: projectId,
        author_type: isNiaSection ? 'jugnu' : 'activity',
        author_key: jugnuKey,
        content: isNiaSection
          ? (niaSectionLabels[path] ?? `🎨 Designed \`${path}\``)
          : `📄 Wrote \`${path}\``,
        task_id: taskId,
        metadata: { event_type: 'FILE_WRITTEN', file_write: true, path: input.path, jugnu_key: jugnuKey },
      })
      return result
    }
  }

  // ── run_sql — Leo only ───────────────────────────────────────────────────────
  // API reference tool — Leo calls this instead of relying on static prompt docs.
  // Keeps the system prompt lean; Leo only pays for tokens it actually needs.
  if (jugnuKey === 'leo') {
    const API_DOCS: Record<string, string> = {
      data_api: `Data API — full CRUD for flat collections.
Base URL: /api/data/PROJECT_ID/collection (replace PROJECT_ID with the actual project UUID from context).
GET    /api/data/PROJECT_ID/items              → { records: [...] }
POST   /api/data/PROJECT_ID/items   body: {}   → { record: { id, created_at, updated_at, ...fields } }
PATCH  /api/data/PROJECT_ID/items/:id body: {} → { record: {...merged} }  — use PATCH not PUT
DELETE /api/data/PROJECT_ID/items/:id          → 204
Always check res.ok before res.json(). Never generate IDs yourself — id is returned by the API.`,

      supabase: `Supabase schema setup (for relational data, RLS, Realtime).
Table naming: p_{shortId}_{name} where shortId = first 8 chars of project UUID with hyphens removed.
Example: project 0c4bc599-9257-... → prefix p_0c4bc599_, tables p_0c4bc599_items.
Run these SQL steps via run_sql in order:
1. CREATE TABLE IF NOT EXISTS public.p_{shortId}_{name} (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), ...fields..., created_at timestamptz DEFAULT now())
2. ALTER TABLE public.p_{shortId}_{name} ENABLE ROW LEVEL SECURITY
3. CREATE POLICY "open" ON public.p_{shortId}_{name} FOR ALL USING (true) WITH CHECK (true)
4. GRANT SELECT, INSERT, UPDATE, DELETE ON public.p_{shortId}_{name} TO anon, authenticated
JS client in HTML:
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js"></script>
const db = window.supabase.createClient('https://rtihiqafvayuiqusrajr.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ0aWhpcWFmdmF5dWlxdXNyYWpyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgzNTY0MjksImV4cCI6MjEwMzkzMjQyOX0.2ZUpPi62RrNud9wRoTMBFyJrG-ZBJcFUU2_65GuHLNU')
const { data } = await db.from('p_0c4bc599_items').select('*').order('created_at', { ascending: false })
Realtime: db.channel('items').on('postgres_changes', { event: '*', schema: 'public', table: 'p_0c4bc599_items' }, handler).subscribe()`,

      forms: `Form submissions (one-way, no retrieval needed — waitlists, contact forms, surveys).
fetch('/api/collect/PROJECT_ID', { method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ form: 'waitlist', email: emailValue }) })
.then(r => r.json()).then(r => { if (r.ok) { /* show success */ } })
Set form to: 'waitlist', 'contact', 'survey', etc. Always show a success and error state.`,

      email: `Send transactional emails (confirmations, reports, notifications).
fetch('/api/email/PROJECT_ID', { method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ to: 'user@example.com', subject: 'Subject', html: '<p>Body</p>' }) })
.then(r => r.json()).then(r => { if (r.ok) { /* sent */ } })
Required: to, subject, and html or text.`,

      upload: `File uploads — returns a permanent public URL.
const fd = new FormData(); fd.append('file', fileInput.files[0])
fetch('/api/upload/PROJECT_ID', { method: 'POST', body: fd })
  .then(r => r.json()).then(({ url, name, type, size }) => { /* store url in data API */ })
Max 20 MB. Store url via the data API if you need to reference it later.`,

      webhooks: `Receive events from third-party services (Stripe, Twilio, GitHub, etc.).
Webhook URL pattern: https://jugnus.vercel.app/api/webhook/PROJECT_ID/stripe (replace 'stripe' with source name).
Payloads auto-stored in collection webhook_stripe. Read via GET /api/data/PROJECT_ID/webhook_stripe.
Show the webhook URL prominently in the app so founders know where to paste it.
Poll for new events: setInterval(() => fetch('/api/data/PROJECT_ID/webhook_stripe').then(r=>r.json()).then(({records})=>setEvents(records)), 5000)`,

      scheduled_jobs: `Schedule future actions (send email in 24h, trigger webhook at midnight).
POST /api/data/PROJECT_ID/scheduled_actions body:
{ action: 'send_email', run_at: new Date(Date.now()+86400000).toISOString(), status:'pending', to:'...', subject:'...', html:'...' }
{ action: 'http_post',  run_at: new Date(Date.now()+3600000).toISOString(),  status:'pending', url:'https://hooks.slack.com/...', body:{text:'...'} }
Scheduler runs every minute. Records updated to completed/failed with completed_at.
Read status: GET /api/data/PROJECT_ID/scheduled_actions`,
    }

    definitions.push({
      name: 'get_api_docs',
      description: 'Get the exact code reference for a Jugnus API before writing any fetch calls, SQL, form submissions, emails, uploads, webhooks, or scheduled jobs. Call this first — do not guess URLs or request shapes from memory.',
      input_schema: {
        type: 'object' as const,
        properties: {
          section: {
            type: 'string',
            enum: ['data_api', 'supabase', 'forms', 'email', 'upload', 'webhooks', 'scheduled_jobs'],
            description: 'The API section you need.',
          },
        },
        required: ['section'],
      },
    })

    handlers['get_api_docs'] = async (input) => {
      const section = input.section as string
      const doc = API_DOCS[section]
      if (!doc) return { ok: false, error: `Unknown section "${section}". Valid: ${Object.keys(API_DOCS).join(', ')}` }
      return { ok: true, reference: doc }
    }
  }

  // Executes DDL and DML against the shared Jugnus Postgres instance so Leo can
  // provision real tables (CREATE TABLE, GRANT, RLS policies) without any founder credentials.
  // Tables must follow the naming convention: p_{shortProjectId}_{tablename}
  if (jugnuKey === 'leo') {
    definitions.push({
      name: 'run_sql',
      description: 'Execute a SQL statement on the shared Jugnus database. Use this to CREATE TABLE, enable RLS, create policies, and GRANT access. All table names MUST start with p_{shortProjectId}_ where shortProjectId is the first 8 characters of the project UUID with hyphens removed. Call once per statement. Do NOT use for SELECT queries — the built app fetches data via the Supabase anon key directly.',
      input_schema: {
        type: 'object' as const,
        properties: {
          sql: {
            type: 'string',
            description: 'A single SQL statement. Example: "CREATE TABLE IF NOT EXISTS public.p_0c4bc599_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, created_at timestamptz DEFAULT now())"',
          },
          description: {
            type: 'string',
            description: 'One-line human description of what this SQL does, shown as a progress message.',
          },
        },
        required: ['sql', 'description'],
      },
    })

    handlers['run_sql'] = async (input) => {
      const sql = input.sql as string
      const desc = (input.description as string) ?? 'Running SQL…'

      await db.from('messages').insert({
        project_id: projectId,
        author_type: 'jugnu',
        author_key: 'leo',
        content: `🗄️ ${desc}`,
        task_id: taskId,
        metadata: { event_type: 'SQL_EXECUTED', jugnu_key: 'leo' },
      })

      const base = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
      const res = await fetch(`${base}/api/internal/run-sql`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.INTERNAL_API_SECRET ?? ''}`,
        },
        body: JSON.stringify({ sql, projectId }),
      })
      const data = await res.json() as { ok: boolean; rows?: unknown[]; rowCount?: number; error?: string }
      if (!data.ok) {
        return { ok: false, error: data.error ?? 'SQL failed' }
      }
      return { ok: true, rowCount: data.rowCount ?? 0 }
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

      // Append Nia's design component list to the pending Tara task so she knows
      // exactly what to verify — features, labels, and layout elements Nia designed.
      try {
        // Prefer first screen file; fall back to assembled.html
        const { data: screenFiles } = await db.from('file_snapshots').select('path, content')
          .eq('project_id', projectId).ilike('path', 'design/screen-%.html').order('path').limit(1)
        const { data: assembledFile } = await db.from('file_snapshots').select('content')
          .eq('project_id', projectId).eq('path', 'design/assembled.html').maybeSingle()
        const designHtml = screenFiles?.[0]?.content ?? assembledFile?.content ?? ''
        const niaComponents = extractNiaComponents(designHtml)
        if (niaComponents) {
          const { data: taraTasks } = await db.from('tasks')
            .select('id, description')
            .eq('project_id', projectId).eq('jugnu_key', 'tara').eq('status', 'pending')
            .order('created_at', { ascending: false }).limit(1)
          if (taraTasks?.[0] && !taraTasks[0].description?.includes("Nia's design contained")) {
            await db.from('tasks').update({
              description: (taraTasks[0].description ?? '') + `\n\n**Nia's design contained:** ${niaComponents}`,
            }).eq('id', taraTasks[0].id)
          }
        }
      } catch { /* non-critical — don't block submission */ }

      await db.from('messages').insert({
        project_id: projectId, author_type: 'jugnu', author_key: 'leo',
        content: `🔀 **Leo submitted ${files.length} file${files.length !== 1 ? 's' : ''} for review.**\n\n${input.summary}\n\n✅ Build check passed — preview available at [${previewUrl}](${previewUrl})`,
        task_id: taskId,
        metadata: { event_type: 'REVIEW_STARTED', review_ready: true, file_count: files.length, build_evidence: buildEvidence },
      })
      return { ok: true, files_submitted: files.length, preview_url: previewUrl }
    }
  }

  // ── Review tools — Tara only ─────────────────────────────────────────────────
  if (jugnuKey === 'tara') {
    // ── call_api — live HTTP test against the app's API endpoints ──────────────
    definitions.push({
      name: 'call_api',
      description: 'Make a real HTTP request to test the app\'s API endpoints. Use this to verify CRUD operations actually work — POST a record, GET it back, PATCH it, DELETE it. If any call returns a non-2xx status, request_changes immediately.',
      input_schema: {
        type: 'object' as const,
        properties: {
          method:  { type: 'string', enum: ['GET', 'POST', 'PATCH', 'DELETE'], description: 'HTTP method. Use PATCH for updates — never PUT.' },
          path:    { type: 'string', description: 'API path starting with /api/, e.g. /api/data/PROJECT_ID/tasks' },
          body:    { type: 'object', description: 'Request body for POST/PATCH requests.' },
        },
        required: ['method', 'path'],
      },
    })

    handlers['call_api'] = async (input) => {
      const path = input.path as string
      if (!path.startsWith('/api/')) {
        return { ok: false, error: 'Only /api/ paths are allowed.' }
      }
      const base = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
      const url = `${base}${path}`
      try {
        const res = await fetch(url, {
          method: input.method as string,
          headers: { 'Content-Type': 'application/json', 'x-internal-tara-test': '1' },
          body: input.body ? JSON.stringify(input.body) : undefined,
        })
        const data = await res.json().catch(() => null)
        return { status: res.status, ok: res.ok, data }
      } catch (e) {
        return { ok: false, error: String(e) }
      }
    }

    // ── verify_assets — static pre-flight that works without a browser ─────────
    // Fetches the live HTML, resolves every local <script> and <link>, verifies
    // each asset loads HTTP 200, then cross-checks all function *calls* against
    // function *definitions* across all JS files to catch undefined references.
    definitions.push({
      name: 'verify_assets',
      description: 'Fetch the live preview HTML, verify every local script and stylesheet returns HTTP 200, and do a cross-file static analysis: collect all function definitions, find all function calls, and report any calls to functions that are never defined. Call this before browse_app. If any asset is missing or any function is called but never defined, call request_changes immediately.',
      input_schema: {
        type: 'object' as const,
        properties: {
          preview_url: { type: 'string', description: 'Full preview URL, e.g. https://jugnus.vercel.app/preview/PROJECT_ID' },
        },
        required: ['preview_url'],
      },
    })

    handlers['verify_assets'] = async (input) => {
      const previewUrl = input.preview_url as string
      const origin = new URL(previewUrl).origin

      // 1. Fetch the HTML — retry once on 5xx (transient CDN/preview timeouts)
      let html: string
      let htmlStatus: number
      try {
        let res = await fetch(previewUrl)
        if (!res.ok && res.status >= 500) {
          await new Promise(r => setTimeout(r, 3000))
          res = await fetch(previewUrl)
        }
        htmlStatus = res.status
        html = await res.text()
        if (!res.ok) return { ok: false, html_status: htmlStatus, error: `Preview HTML returned ${htmlStatus}` }
      } catch (e) {
        return { ok: false, error: `Failed to fetch preview HTML: ${String(e)}` }
      }

      // 2. Extract local script/link srcs (skip CDN https:// URLs)
      const scriptSrcs: string[] = []
      for (const m of html.matchAll(/<script[^>]*\bsrc="([^"]+)"/gi)) {
        const src = m[1]
        if (!src.startsWith('http')) scriptSrcs.push(src)
      }
      const linkHrefs: string[] = []
      for (const m of html.matchAll(/<link[^>]*\bhref="([^"]+)"/gi)) {
        const href = m[1]
        if (!href.startsWith('http')) linkHrefs.push(href)
      }

      // 3. Fetch each local asset; separate JS for static analysis
      const assetErrors: string[] = []
      const jsContents: Record<string, string> = {}

      for (const src of scriptSrcs) {
        const url = src.startsWith('/') ? `${origin}${src}` : `${previewUrl.replace(/\/?$/, '/')}${src}`
        try {
          const res = await fetch(url)
          if (!res.ok) {
            assetErrors.push(`${src}: HTTP ${res.status}`)
          } else {
            jsContents[src] = await res.text()
          }
        } catch (e) {
          assetErrors.push(`${src}: fetch failed — ${String(e)}`)
        }
      }
      for (const href of linkHrefs) {
        const url = href.startsWith('/') ? `${origin}${href}` : `${previewUrl.replace(/\/?$/, '/')}${href}`
        try {
          const res = await fetch(url)
          if (!res.ok) assetErrors.push(`${href}: HTTP ${res.status}`)
        } catch (e) {
          assetErrors.push(`${href}: fetch failed — ${String(e)}`)
        }
      }

      // 4. Cross-file static analysis — collect defined vs called function names
      const allJS = Object.values(jsContents).join('\n')

      const defined = new Set<string>()
      // function declarations
      for (const m of allJS.matchAll(/\bfunction\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g)) defined.add(m[1])
      // const/let/var arrow + function expressions
      for (const m of allJS.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:async\s*)?\(/g)) defined.add(m[1])
      for (const m of allJS.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(?:async\s+)?function/g)) defined.add(m[1])
      // React useState destructuring: const [state, setSomething] = useState(...)
      for (const m of allJS.matchAll(/const\s*\[[^\]]*,\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*\]/g)) defined.add(m[1])
      // Function parameters (direct + destructured) — avoids flagging React callback props as undefined.
      // Covers: function F(a, b), function F({ a, b }), ({ a, b }) =>
      const paramBlockRe = /(?:function\s+[A-Za-z_$][A-Za-z0-9_$]*|=>)\s*[\({]|(?:function\s+[A-Za-z_$][A-Za-z0-9_$]*\s*\()([^)]*)\)/g
      for (const m of allJS.matchAll(/(?:function\s+[A-Za-z_$][A-Za-z0-9_$]*\s*\(|\(\s*)\{([^}]+)\}(?:\s*[,)]|\s*=>)/g)) {
        for (const p of m[1].split(',')) {
          const name = p.trim().split(/[\s=:]/)[0].replace(/^\.\.\./, '').trim()
          if (/^[A-Za-z_$][A-Za-z0-9_$]+$/.test(name)) defined.add(name)
        }
      }
      // Direct positional params: function F(a, b, c) or (a, b) =>
      for (const m of allJS.matchAll(/(?:function\s+[A-Za-z_$][A-Za-z0-9_$]*\s*|(?<!=)(?<!\w)\()\(([^)]{1,200})\)\s*(?:=>|\{)/g)) {
        for (const p of m[1].split(',')) {
          const name = p.trim().split(/[\s=]/)[0].replace(/^\.\.\./, '').trim()
          if (/^[A-Za-z_$][A-Za-z0-9_$]+$/.test(name)) defined.add(name)
        }
      }

      // Build call list — skip anything preceded by '.' (object/prototype method call)
      const SKIP = new Set(['if','else','while','for','switch','catch','return','typeof','instanceof','new','delete','void','throw','await','yield','async','function','class','extends','super','import','export','default','var','let','const','fetch','console','JSON','Object','Array','String','Number','Boolean','Math','Date','setTimeout','clearTimeout','setInterval','clearInterval','Promise','Error','parseInt','parseFloat','isNaN','isFinite','encodeURIComponent','decodeURIComponent','React','ReactDOM','useState','useEffect','useRef','useMemo','useCallback','useContext','createContext','forwardRef','createElement','require','document','window','navigator','location','history','sessionStorage','localStorage','alert','confirm','prompt','eval','Babel'])

      const called = new Set<string>()
      // Match calls NOT preceded by '.' — avoids obj.method() false positives
      for (const m of allJS.matchAll(/(?<![.\w])([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g)) {
        const name = m[1]
        if (!SKIP.has(name) && name.length > 2) called.add(name)
      }

      const undefinedCalls = [...called].filter(f => !defined.has(f)).sort()

      const ok = assetErrors.length === 0 && undefinedCalls.length === 0

      return {
        ok,
        html_status: htmlStatus,
        local_scripts: scriptSrcs,
        local_stylesheets: linkHrefs,
        asset_errors: assetErrors,
        defined_functions: [...defined].sort(),
        undefined_function_calls: undefinedCalls,
        summary: ok
          ? `All ${scriptSrcs.length + linkHrefs.length} local assets load HTTP 200. No undefined function calls found across ${scriptSrcs.length} JS file(s).`
          : [
              assetErrors.length ? `${assetErrors.length} asset(s) failed to load: ${assetErrors.join(', ')}` : '',
              undefinedCalls.length ? `${undefinedCalls.length} function(s) called but never defined: ${undefinedCalls.join(', ')}` : '',
            ].filter(Boolean).join(' | '),
      }
    }

    // ── browse_app — headless browser smoke test ──────────────────────────────
    definitions.push({
      name: 'browse_app',
      description: 'Launch a headless browser and interact with the app like a real user. Navigates to the preview URL, executes actions (fill, click, reload), and returns console errors, blank-screen detection, and visible page text. Run this before approving any interactive app.',
      input_schema: {
        type: 'object' as const,
        properties: {
          url: { type: 'string', description: 'Full preview URL, e.g. https://jugnus.vercel.app/preview/PROJECT_ID' },
          actions: {
            type: 'array',
            description: 'Ordered list of user actions to perform after the page loads.',
            items: {
              type: 'object' as const,
              properties: {
                type:     { type: 'string', enum: ['fill', 'click', 'select', 'wait', 'reload', 'check_text'] },
                selector: { type: 'string', description: 'CSS selector for fill/click/select actions.' },
                value:    { type: 'string', description: 'Value for fill/select or expected text for check_text.' },
                ms:       { type: 'number', description: 'Milliseconds for wait action.' },
              },
              required: ['type'],
            },
          },
        },
        required: ['url'],
      },
    })

    handlers['browse_app'] = async (input) => {
      const base = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
      try {
        const res = await fetch(`${base}/api/internal/browser-test`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${process.env.INTERNAL_API_SECRET ?? ''}`,
          },
          body: JSON.stringify({ url: input.url, actions: input.actions ?? [] }),
        })
        if (!res.ok) return { ok: false, error: `browser-test endpoint returned ${res.status}` }
        return res.json()
      } catch (e) {
        return { ok: false, error: String(e) }
      }
    }

    // ── compare_with_design — visual fidelity check against Nia's approved mockup ─
    definitions.push({
      name: 'compare_with_design',
      description: 'Screenshot both the approved design mockup (design/assembled.html) and the live built app, and return both images so you can verify the implementation matches what the user approved visually. Call this after browse_app.',
      input_schema: {
        type: 'object' as const,
        properties: {},
        required: [],
      },
    })

    handlers['compare_with_design'] = async () => {
      const base = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
      const headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.INTERNAL_API_SECRET ?? ''}`,
      }

      const { data: designFile } = await db
        .from('file_snapshots')
        .select('content')
        .eq('project_id', projectId)
        .eq('path', 'design/assembled.html')
        .single()

      if (!designFile?.content) {
        return { ok: false, error: 'No design/assembled.html found — cannot compare against approved design.' }
      }

      const [designRes, appRes] = await Promise.all([
        fetch(`${base}/api/internal/browser-test`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ htmlContent: designFile.content, returnScreenshot: true }),
        }),
        fetch(`${base}/api/internal/browser-test`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ url: `${base}/preview/${projectId}`, returnScreenshot: true }),
        }),
      ])

      const [designData, appData] = await Promise.all([
        designRes.json() as Promise<{ screenshot?: string; ok?: boolean }>,
        appRes.json() as Promise<{ screenshot?: string; ok?: boolean }>,
      ])

      if (!designData.screenshot && !appData.screenshot) {
        return { ok: false, error: 'Screenshots unavailable (browser not running). Skip this step and rely on browse_app result.' }
      }

      // Return as image content blocks — the LLM sees both screenshots side by side
      type Block = { type: 'text'; text: string } | { type: 'image'; source: { type: 'base64'; media_type: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'; data: string } }
      const blocks: Block[] = []

      if (designData.screenshot) {
        blocks.push({ type: 'text', text: '**Approved design** (what the founder signed off on):' })
        blocks.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: designData.screenshot } })
      } else {
        blocks.push({ type: 'text', text: '**Approved design**: screenshot unavailable.' })
      }

      if (appData.screenshot) {
        blocks.push({ type: 'text', text: '**Built app** (current implementation):' })
        blocks.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: appData.screenshot } })
      } else {
        blocks.push({ type: 'text', text: '**Built app**: screenshot unavailable.' })
      }

      blocks.push({
        type: 'text',
        text: 'Compare the two screenshots. Flag any deviations: missing sections, wrong layout, wrong colours, wrong typography, missing components, or content that differs from the approved design. If the app does not match, call request_changes with specific file-by-file instructions.',
      })

      return blocks
    }

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

      // If at the revision cap, approve must go through regardless of html_valid — otherwise
      // Tara is deadlocked (request_changes also blocked). She must document issues in comment.
      const { count: leoRevisions } = await db
        .from('tasks')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', projectId)
        .eq('jugnu_key', 'leo')
        .eq('status', 'completed')
        .gte('sort_order', 100)
      const atRevisionCap = (leoRevisions ?? 0) >= 4

      if (!atRevisionCap && buildEvidence && buildEvidence.html_valid === false) {
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

      const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
      const previewUrl = liveUrl ?? (appUrl ? `${appUrl}/preview/${projectId}` : null)

      await db.from('projects').update({
        status: 'completed',
        ...(previewUrl ? { deploy_url: previewUrl } : {}),
      }).eq('id', projectId)

      await db.from('messages').insert({
        project_id: projectId, author_type: 'jugnu', author_key: 'tara',
        content: `✅ **Tara approved the work.**\n\n${input.comment}${deployLine}${verificationNote}`,
        task_id: taskId,
        metadata: { event_type: 'REVIEW_PASSED', review_verdict: 'approved', project_complete: true, live_url: liveUrl, preview_url: previewUrl, build_verified: buildEvidence?.html_valid === true },
      })

      // Emit PROJECT_COMPLETED directly so the UI shows the preview button even if
      // advanceProject is never called (e.g. watchdog-dispatched functions that time out).
      await db.from('messages').insert({
        project_id: projectId,
        author_type: 'system',
        author_key: 'system',
        content: `✨ All tasks completed. Your Jugnus finished the project.${previewUrl ? `\n\n🌐 Preview: ${previewUrl}` : ''}`,
        metadata: { event_type: 'PROJECT_COMPLETED', project_complete: true, deploy_url: previewUrl },
      })

      return { ok: true, verdict: 'approved' }
    }

    definitions.push({
      name: 'request_changes',
      description: 'Request changes from Leo. Describe exactly what needs to be fixed. Do not call this if Leo has already revised four times — approve with reservations instead, listing every remaining issue in your comment.',
      input_schema: {
        type: 'object' as const,
        properties: {
          feedback: { type: 'string', description: 'Specific changes required, file by file if possible.' },
        },
        required: ['feedback'],
      },
    })

    handlers['request_changes'] = async (input) => {
      // Count only Leo REVISION tasks (sort_order >= 100), not the initial build.
      // This was previously >= 2 on ALL Leo completed tasks, which meant Tara could only
      // ever request one correction (initial build counted as 1, revision as 2 = escalate).
      const { count: leoRevisions } = await db
        .from('tasks')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', projectId)
        .eq('jugnu_key', 'leo')
        .eq('status', 'completed')
        .gte('sort_order', 100)

      if ((leoRevisions ?? 0) >= 4) {
        // Leo has already revised four times (5 Tara reviews total) — hard block.
        // Tara MUST call approve (with reservations if needed), not request_changes again.
        return {
          ok: false,
          blocked: true,
          reason: 'Leo has already revised four times. You are NOT allowed to call request_changes again. Call approve now. If issues remain, describe them in your approval comment so the founder is aware — but the project must ship.',
        }
      }

      if (taskId) {
        await db.from('tasks').update({
          status: 'completed',
          result: `Changes requested: ${input.feedback}`,
          completed_at: new Date().toISOString(),
        }).eq('id', taskId)
      }

      const { data: leoRevTask } = await db.from('tasks').insert({
        project_id: projectId,
        title: 'Revise implementation based on Tara\'s feedback',
        description: `Tara requested these changes:\n\n${input.feedback}\n\nFix the issues in the existing files using write_file, then call submit_for_review again.`,
        capability: 'build', jugnu_key: 'leo',
        depends_on: taskId ? [taskId] : [],
        sort_order: 999, status: 'pending',
      }).select('id').single()

      // Always queue a Tara re-review after the revision — without this the project
      // goes straight to "completed" after Leo's revision without any further QA.
      {
        const { data: screenFiles } = await db.from('file_snapshots').select('path, content')
          .eq('project_id', projectId).ilike('path', 'design/screen-%.html').order('path').limit(1)
        const { data: assembledFile } = await db.from('file_snapshots').select('content')
          .eq('project_id', projectId).eq('path', 'design/assembled.html').maybeSingle()
        const designHtml = screenFiles?.[0]?.content ?? assembledFile?.content ?? ''
        const niaComponents = extractNiaComponents(designHtml)
        const niaNote = niaComponents ? `\n\n**Nia's design contained:** ${niaComponents}` : ''
        await db.from('tasks').insert({
          project_id: projectId,
          title: 'Re-review revised implementation',
          description: `Leo revised the implementation. Run your full review suite again: verify_assets → call_api → browse_app. If all checks pass, approve. This is the final review — if issues remain, approve with reservations rather than requesting another round.${niaNote}`,
          capability: 'review', jugnu_key: 'tara',
          depends_on: leoRevTask?.id ? [leoRevTask.id] : [],
          sort_order: 1000, status: 'pending',
        })
      }

      await db.from('messages').insert({
        project_id: projectId, author_type: 'jugnu', author_key: 'tara',
        content: `🔁 **Tara requested changes.**\n\n${input.feedback}`,
        task_id: taskId,
        metadata: { event_type: 'TASK_RETURNED', review_verdict: 'changes_requested' },
      })

      return { ok: true, verdict: 'changes_requested' }
    }

    // ── record_learning — intentional, reusable lesson capture ───────────────
    definitions.push({
      name: 'record_learning',
      description: 'Save a reusable lesson to the learnings store so future builds avoid the same mistake. Call this when you identify a root-cause pattern — something general enough to help on a different project, not just a description of this specific bug. Write one concise actionable sentence. Call this separately from request_changes; do not duplicate raw feedback here.',
      input_schema: {
        type: 'object' as const,
        properties: {
          jugnu_key: {
            type: 'string',
            enum: ['leo', 'nia'],
            description: 'Which jugnu this lesson applies to.',
          },
          learning_type: {
            type: 'string',
            enum: ['mistake', 'pattern', 'fix'],
            description: 'mistake = what to avoid, pattern = what works well, fix = specific corrective technique.',
          },
          content: {
            type: 'string',
            description: 'One actionable sentence. State the rule, not the symptom. Bad: "Timer screen did not display." Good: "Use React useState for screen transitions — vanilla JS display:none toggling fails under headless browser clicks."',
          },
        },
        required: ['jugnu_key', 'learning_type', 'content'],
      },
    })

    handlers['record_learning'] = async (input) => {
      const content = (input.content as string).trim()
      if (content.length < 20) return { ok: false, error: 'Learning too short — write a full actionable sentence.' }
      if (content.length > 400) return { ok: false, error: 'Learning too long — keep it under 400 chars.' }

      await db.from('jugnu_learnings').insert({
        jugnu_key: input.jugnu_key as string,
        source_project_id: projectId,
        learning_type: input.learning_type as string,
        content,
      })

      return { ok: true, saved: content }
    }
  }

  return { definitions, handlers }
}
