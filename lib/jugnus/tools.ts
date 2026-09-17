import type Anthropic from '@anthropic-ai/sdk'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { JugnuKey } from './registry'
import { writeFile, readFile, listFiles } from '../storage/files'

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
          // Footer always last; everything else ordered by logical page flow
          const SECTION_ORDER = ['hero', 'what', 'about', 'benefits', 'features', 'product', 'proof', 'testimonial', 'why', 'how', 'process', 'pricing', 'cta', 'order', 'contact']
          const sorted = [...sections].sort((a, b) => {
            if (a.path.includes('footer')) return 1
            if (b.path.includes('footer')) return -1
            const ai = SECTION_ORDER.findIndex((s) => a.path.includes(s))
            const bi = SECTION_ORDER.findIndex((s) => b.path.includes(s))
            return (ai === -1 ? 50 : ai) - (bi === -1 ? 50 : bi)
          })
          const body = sorted.map((f) => f.content).join('\n\n')

          // Read tokens.css if Maya seeded it — inline into <style> so CSS vars work across all sections
          const { data: tokensFile } = await db.from('file_snapshots')
            .select('content').eq('project_id', projectId).eq('path', 'design/tokens.css').maybeSingle()
          const tokensStyle = tokensFile?.content
            ? `\n<style>\n${tokensFile.content}\n</style>`
            : ''

          // Extract Google Fonts @import from tokens.css to put in a <link> (browsers load it faster)
          const fontsImportMatch = tokensFile?.content?.match(/@import url\(['"]([^'"]+)['"]\);?/)
          const fontsLink = fontsImportMatch
            ? `\n<link rel="preconnect" href="https://fonts.googleapis.com">\n<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n<link href="${fontsImportMatch[1]}" rel="stylesheet">`
            : ''

          const assembled = `<!DOCTYPE html>
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
      const rawTasks = input.tasks as Array<{
        title: string; description: string; capability: string
        jugnu_key: string; eta?: string; depends_on_indices?: number[]
      }>
      const jugnu_roles = input.jugnu_roles as Record<string, { display_role: string; focus: string }> | undefined
      const design_tokens = input.design_tokens as {
        primary_color: string; accent_color: string; bg_color: string
        text_color?: string; text_muted?: string; display_font: string; body_font: string
      } | undefined

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

      const insertedIds: string[] = []
      for (let i = 0; i < rawTasks.length; i++) {
        const t = rawTasks[i]
        const dependsOn = (t.depends_on_indices ?? []).map((idx) => insertedIds[idx]).filter(Boolean)
        const { data } = await db.from('tasks').insert({
          project_id: projectId, title: t.title, description: t.description,
          capability: t.capability, jugnu_key: t.jugnu_key,
          eta: t.eta ?? null,
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
      description: 'Search Unsplash for high-quality stock photos. Call this before writing any section that needs images. Returns real URLs to use as <img src="..."> tags.',
      input_schema: {
        type: 'object' as const,
        properties: {
          query: { type: 'string', description: 'Specific search terms, e.g. "yoga studio sunrise" or "indian sweet shop interior colourful"' },
          count: { type: 'number', description: 'Number of photos to return (1–5, default 3)' },
        },
        required: ['query'],
      },
    })

    handlers['search_photos'] = async (input) => {
      const query = input.query as string
      const count = Math.min(Math.max(Number(input.count ?? 3), 1), 5)
      const key = process.env.UNSPLASH_ACCESS_KEY

      // Picsum fallback — real photos, consistent per query, no API key needed
      const picsumFallback = (n: number) =>
        Array.from({ length: n }, (_, i) => ({
          url: `https://picsum.photos/seed/${encodeURIComponent(query)}-${i}/1200/630`,
          alt: query,
          photographer: 'Picsum Photos',
        }))

      if (!key) return { photos: picsumFallback(count) }

      try {
        const res = await fetch(
          `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=${count}&orientation=landscape&client_id=${key}`
        )
        const data = await res.json() as { results: Array<{ urls: { regular: string }; alt_description: string | null; user: { name: string } }> }
        const photos = (data.results ?? []).map((p) => ({
          url: p.urls.regular,
          alt: p.alt_description ?? query,
          photographer: p.user.name,
        }))
        // Fall back to picsum if Unsplash returns nothing
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

    handlers['generate_image'] = async (_input) => {
      // Only post the upgrade card once per project — skip if already shown
      const { count } = await db.from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', projectId)
        .contains('metadata', { event_type: 'UPGRADE_REQUIRED' })
      if ((count ?? 0) === 0) {
        await db.from('messages').insert({
          project_id: projectId,
          author_type: 'system',
          author_key: 'system',
          content: '✨ AI image generation is a Pro feature.',
          metadata: { event_type: 'UPGRADE_REQUIRED', feature: 'ai_image_generation' },
        })
      }
      return { upgrade_required: true, message: 'AI image generation requires a Pro account. Call search_photos immediately as a fallback.' }
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
