# Jugnus — Current State Handoff
**Date: 18 September 2026**
**Source of truth: live codebase at `/Users/abhijeetmishra1/Developer/jugnus`**
**This document supersedes all previous plans, strategy docs, and handoffs.**

---

## 1. EXECUTIVE PRODUCT SNAPSHOT

### What Jugnus is today
Jugnus is a web app where four AI agents (Maya, Nia, Leo, Tara) work sequentially to take a founder's plain-English objective and produce a working HTML web page, served at a public preview URL. The founder's only required touchpoint is approving Nia's design before Leo builds it.

### Current product thesis
"Describe what you want in plain English. A team of AI agents clarifies, designs, builds, and reviews it for you, with one checkpoint for your approval."

### Current target user / ICP
Non-technical founders or small business owners who want a simple web presence (landing page, micro-app) and cannot code. The current sweet spot is someone who would otherwise pay a freelancer Rs 5,000–15,000 for a landing page.

### Primary supported use case
**Landing pages and simple single-page apps** (forms, basic CRUD, calculators). Any project that can be expressed as a single self-contained HTML file using React CDN and the Jugnus Data API.

### What it can reliably produce today
- Landing pages with real copy, photos (Unsplash), brand colors
- Simple interactive apps (tip calculators, budget trackers, task managers)
- Single-page apps backed by the Jugnus Data API for persistence
- A styled design mockup for founder approval before build
- Tara's live API test + headless browser smoke test

### What it appears to support but does not
- **GitHub PR creation** — the code exists (`lib/jugnus/github.ts`) but is never called. No PR is created.
- **Actual deployment** — the "live URL" is a Next.js route that reads `index.html` from Supabase and returns it as HTML. It is not deployed anywhere. No custom domain, no CDN, no Vercel project.
- **AI image generation** — `generate_image` always returns `upgrade_required: true`. There is no Pro tier, no Stripe, no actual generation.
- **Multi-page / full-stack apps** — Leo is constrained to one HTML file, React CDN, no npm, no build step. Capabilities listed in Leo's system prompt (Next.js, Supabase, TypeScript, migrations) are aspirational labels — none are accessible to Leo.
- **Scheduled jobs / email / webhooks** — these API routes exist and are functional, but only work if Leo correctly embeds the right fetch calls in his HTML. Resend and scheduler cron depend on env vars that may not be set.

### Current end-to-end user experience
1. Founder describes project in a text box (optionally attaches photos).
2. Maya asks 1–4 clarification questions (MCQ or free text). Founder answers inline.
3. Maya creates a task plan. Visible in sidebar as task list.
4. Nia designs section by section. Founder sees file-streaming bubbles as sections are written.
5. Nia's assembled design appears as an inline iframe preview. Founder approves or gives feedback.
6. If approved: Leo builds `index.html` in one shot (~3–8 min). Founder sees streaming.
7. Tara runs live API tests and headless browser check. Approves or sends back to Leo once.
8. On approval: "View live →" link appears. Project marked complete.

### Current biggest strength
The section-by-section design model with real-time streaming creates a genuine sense of a team working, not a spinner. Founder decisions are durable (stored in DB, injected into every downstream context). The single-checkpoint approval model is clean.

### Current biggest weakness
Leo produces a single HTML file served from a database row. There is no real deployment, no GitHub PR, no actual hosting infrastructure. For a "delegation" product, the output is barely more permanent than a shared CodePen link.

### What this product feels like today
**B) AI website builder** — specifically one with a lightweight multi-agent presentation layer. The agents (Maya, Nia, Leo, Tara) give it a team feel, but the output is a single HTML page served from a database row. The infrastructure for genuine delegation is present but the output is constrained by Leo's single-file limitation.

---

## 2. EXACT END-TO-END FLOW

### Architecture diagram

```
Founder message
      │
      ▼
POST /api/projects
 ├─ creates project row (status: active)
 ├─ seeds jugnus for workspace
 ├─ pre-inserts Maya task (sort_order: -1)
 └─ waitUntil → runPipeline(maya)
                     │
                     ▼
             dispatchJugnu(maya)
              ├─ buildContextBlock(project)
              ├─ last 30 messages from DB
              ├─ Claude Streaming API (sonnet-4-6)
              │   tool_choice: any (forces tool call, max 25 turns)
              │   ── streams text to messages table (150-char flush)
              ├─ Maya calls ask_founder → CLARIFICATION_REQUIRED
              │   (terminal — agentic loop stops)
              │   Founder answers via POST /api/messages
              │   → advanceProject → re-dispatches Maya
              └─ Maya calls create_task_plan
                   ├─ inserts tasks: [nia_task, human_task, leo_task, tara_task]
                   │   with depends_on dependency chain
                   ├─ optionally seeds design/tokens.css
                   ├─ PLAN_CREATED message
                   └─ Maya calls complete_task
                         │
                         ▼
                  advanceProject (executor.ts)
                   ├─ finds next ready task (Nia's)
                   ├─ atomically claims it (status: in_progress)
                   ├─ sets jugnu status: working
                   ├─ TASK_ASSIGNED message with ETA
                   └─ fires awaited fetch → /api/internal/jugnu-respond
                                                    │
                                                    ▼
                                          jugnu-respond (202 immediate)
                                          waitUntil → runPipeline(nia)
                                                    │
                                                    ▼
                                          dispatchJugnu(nia)  [haiku]
                                           ├─ Nia calls search_photos
                                           ├─ Nia calls write_file (design/intent.md)
                                           │   └─ FILE_STREAM messages in real-time
                                           ├─ Nia calls write_file (design/hero.html)
                                           ├─ ... (per section)
                                           └─ Nia calls complete_task
                                                ├─ server assembles design/assembled.html
                                                │   (SECTION_ORDER sort, Tailwind CDN, tokens.css)
                                                ├─ TASK_COMPLETED message
                                                └─ advanceProject
                                                      │
                                                      ▼
                                              human task found
                                              ├─ marks in_progress
                                              ├─ APPROVAL_REQUIRED message
                                              └─ returns dispatched: false
                                                      │
                                          Founder sees ApprovalCard + iframe preview
                                                      │
                                        POST /api/projects/[id]/approve
                                         ├─ verdict: 'approved'
                                         │   ├─ human task: completed
                                         │   ├─ PROTOTYPE_APPROVED message
                                         │   └─ advanceProject → Leo dispatched
                                         └─ verdict: 'changes'
                                             ├─ human task: reset to pending
                                             ├─ new Nia revision task inserted
                                             └─ advanceProject → Nia re-dispatched
                                                      │
                                          (post-approval path)
                                                      │
                                                      ▼
                                          dispatchJugnu(leo)  [haiku]
                                           ├─ Leo reads design/assembled.html
                                           ├─ Leo writes index.html (≤700 lines)
                                           │   └─ FILE_STREAM in real-time
                                           └─ Leo calls submit_for_review
                                                ├─ validates: .html exists, has <body>, >200 chars
                                                ├─ REVIEW_STARTED message with preview_url
                                                ├─ Leo task: completed with artifact {html_valid, preview_url}
                                                └─ advanceProject → Tara dispatched
                                                      │
                                                      ▼
                                          dispatchJugnu(tara)  [sonnet-4-6]
                                           ├─ Tara calls call_api (CRUD test)
                                           ├─ Tara calls browse_app (headless Chromium)
                                           ├─ Tara calls read_file / list_files
                                           └─ Tara calls approve OR request_changes
                                                │
                                    ┌───────────┴───────────┐
                                    ▼                       ▼
                                 approve               request_changes
                                    │                 (if Leo completed < 2×)
                                    │                       │
                                    │                new Leo task inserted
                                    │                → Leo re-dispatched
                                    │
                              project.status: completed
                              deploy_url: /preview/[projectId]
                              REVIEW_PASSED + PROJECT_COMPLETED messages
                              "View live →" link appears
```

### Stage details

**Maya trigger:** `POST /api/projects` (new project). Also re-triggered after founder answers clarification questions via `POST /api/messages` (if escalation pending, executor re-dispatches Maya).

**State transitions (Maya):** Maya task: pending → in_progress → completed. Project: active → (active while Maya runs) → planning (after PLAN_CREATED?) → building (after Nia starts).

**Nia trigger:** `complete_task` from Maya → `advanceProject` → jugnu-respond → jugnu-respond runs Nia.

**Human trigger:** `advanceProject` after Nia completes. Human task goes in_progress. No jugnu dispatch.

**Leo trigger:** POST `/api/projects/[id]/approve` (founder approves) → `advanceProject` → jugnu-respond → Leo.

**Tara trigger:** Leo's `submit_for_review` → `advanceProject` → jugnu-respond → Tara.

**Retries:** `runPipeline` tries `dispatchJugnu` twice (3s delay on retry 2). Failed dispatch resets task to pending, jugnu to idle. Watchdog picks up stuck tasks after 1 min of inactivity (or 10 min hard cap), retries up to 3× before marking `failed`.

**Failure behavior:** Task marked `failed` after 3 watchdog retries. System message inserted. Jugnu reset to idle. Pipeline stops — no automatic recovery past 3 retries.

**Dynamic jugnu skipping:** Maya CAN create different task graphs (the DAG infrastructure supports it). However, her system prompt mandates `Nia → human → Leo → Tara` for all web pages. The only validated deviation is document output (Nia → Tara, no Leo, no human). In practice the pipeline is nearly always Maya → Nia → human → Leo → Tara.

---

## 3. MAYA — CURRENT REALITY

### Role
Clarifier and task-graph creator. Runs once at project start (plus re-runs after each clarification answer). Creates the task plan that defines the rest of the pipeline.

### Model
`claude-sonnet-4-6`

### Available tools
- `ask_founder` — MCQ clarification widget (terminal)
- `join_v2_waitlist` — adds founder to v2 waitlist (terminal)
- `create_task_plan` — creates task rows in DB, optionally seeds `design/tokens.css`
- `complete_task` — marks Maya's own task done, triggers advanceProject

### Brief-readiness logic
Maya is instructed to ask questions only when the answers would materially change design, copy, or structure. She has explicit lists of when to always ask (brand tone for local businesses, app name for all apps), when to proceed without asking (full briefs with color/font/audience/CTA specified), and when NOT to ask (trivial details she can infer).

### Clarification logic
Maya generates up to 4 questions. Questions are structured (MCQ + free text option) via the `ask_founder` tool. The tool creates an escalation row and a UI widget; the agentic loop stops. After the founder answers, the message route re-dispatches Maya, which sees the answers in its context and calls `create_task_plan`.

### How Maya determines uncertainty
Heuristic: described in prompt. Assess whether the unknown would lead to a materially wrong design. If yes, ask. The v2.0 gate overrides everything: if the request involves auth, payments, multi-page routing, or real-time, Maya calls `join_v2_waitlist` and does not plan.

### Task planning
`create_task_plan` receives: `tasks[]` (title, description, capability, jugnu_key, depends_on_indices), `design_tokens` (optional), `estimated_duration_minutes`. Creates task rows, computes actual `depends_on` UUIDs from indices. Seeds `design/tokens.css` if `design_tokens` provided.

### Dynamic DAG generation
PARTIAL. The schema supports true DAGs. Maya is prompt-constrained to two patterns (web page: Nia→human→Leo→Tara; document: Nia→Tara). The infrastructure could handle other graphs; Maya does not generate them.

### Agent skipping
PARTIAL. Maya can technically skip jugnus by not including their tasks. In practice she does not skip Nia or Tara; occasionally skips Leo for document outputs.

### Failure modes
- v2.0 gate: if asked for auth/payments/multi-page, Maya stops pipeline and adds to waitlist. Founder gets no product.
- If `create_task_plan` is malformed: task insertion fails silently; no recovery.
- Maya can loop on clarification (re-asked the same question if context is ambiguous).

### Maya behavior comparison — two briefs

**Brief A: "Build me a landing page."**
- Zero constraints. Maya will ask: brand name, product/service description, primary CTA, tone (modern/traditional/playful/premium), any photos.
- Likely 3–4 questions.
- Cannot proceed to create_task_plan without these answers.
- Time to first Nia task: depends on founder's response speed.

**Brief B: "Build a landing page for a warehouse inventory SaaS targeted at operations managers. Primary CTA is Book a Demo. Use a premium industrial visual style and include hero, benefits, integrations, ROI proof and CTA."**
- Audience, CTA, tone, sections all specified.
- Maya should proceed without asking anything (or ask only for app name and brand color).
- Time to first Nia task: ~2–4 minutes (Maya's one turn).

**Would Maya behave differently?** YES. The brief-readiness prompt explicitly distinguishes full briefs from thin briefs. Brief B has everything Maya would otherwise ask. The delta is 3–4 RTTs of clarification removed, plus Nia gets a much more constrained task description.

---

## 4. DURABLE CONTEXT / FOUNDER DECISIONS

### Where clarification answers are stored
`projects.constraints` (jsonb column). Path: `constraints.founder_constraints[]`. Each entry: `{ question: string, answer: string }`.

### Schema/JSON structure
```json
{
  "founder_constraints": [
    { "question": "What is your brand name?", "answer": "RaiKulture" },
    { "question": "What is your primary CTA?", "answer": "Order on Swiggy" }
  ],
  "attachments": [
    { "url": "https://...supabase.co/storage/...", "name": "logo.png", "isImage": true }
  ]
}
```

### Survive refresh? YES
Stored in DB. The UI reads the project from Supabase on page load. Decisions persist indefinitely.

### Survive rolling-message truncation? YES
Context is NOT pulled from message history. `formatContextBlock` reads `projects.constraints.founder_constraints` directly from the projects table and injects them into every jugnu's context block as a structured `FOUNDER DECISIONS` section.

### Do Nia, Leo, Tara receive them? YES
All three receive the same `formatContextBlock` output which includes FOUNDER DECISIONS. This is confirmed in `dispatch.ts`.

### Is the original objective authoritative? YES
`project.objective` is stored at project creation and never modified. It appears as `FOUNDER OBJECTIVE` in every context block.

### Are approved design decisions durable? PARTIAL
After the founder approves Nia's design, an `approval_metrics` object is written to `projects.constraints`. Leo's task description (written by Maya) also describes the design direction. But **the approved design artifact itself (the assembled HTML)** is available to Leo only because he can `read_file('design/assembled.html')`. If the file is truncated or Nia wrote unusual section names, Leo may produce a design that diverges from what was approved.

### Context availability summary

| Data | Storage | Durable |
|---|---|---|
| Founder objective | `projects.objective` | STRUCTURED + DURABLE |
| Clarification Q&A | `projects.constraints.founder_constraints` | STRUCTURED + DURABLE |
| Uploaded images | `projects.constraints.attachments` | STRUCTURED + DURABLE |
| Approved Nia design | `file_snapshots` (design/assembled.html) | STRUCTURED + DURABLE |
| Maya's task descriptions | `tasks.description` | STRUCTURED + DURABLE |
| Build evidence (html_valid, preview_url) | `tasks.artifact` (Leo's completed task) | STRUCTURED + DURABLE |
| Tara's review comments | `messages` | CHAT-HISTORY DEPENDENT |
| Founder freetext during revision | `messages` + `escalations.resolution` | STRUCTURED + DURABLE (escalations) |

### Project memory
Stored in `projects.constraints` (jsonb). Durable. Contains: founder_constraints, attachments, approval_metrics, revision_count.

### Workspace memory
NOT IMPLEMENTED. `workspaces` table has no memory/preferences columns. No cross-project context is carried between projects in the same workspace. Each project starts fresh.

### Cross-project memory
NOT IMPLEMENTED. Nothing links learnings from previous projects to new ones.

---

## 5. NIA — BOTTLENECK STATUS

### Current architecture
Nia runs on `claude-haiku-4-5-20251001`. She produces:
- `design/intent.md` — design rationale (optional but present in full mode)
- `design/[section].html` — individual section HTML fragments
- `design/assembled.html` — auto-assembled server-side when Nia calls `complete_task`

### Artifact generation strategy
INCREMENTAL. Each section is a separate `write_file` call. Each `write_file` streams content in real-time via FILE_STREAM messages (~300-char chunks). The founder sees each section appear progressively in the Files panel.

### Assembly mechanism
Server-side in the `complete_task` handler. Triggered when Nia calls `complete_task`. Reads all `design/%.html` files (excluding assembled.html), sorts by SECTION_ORDER with footer always last, injects Tailwind CDN, inlines tokens.css, promotes Google Fonts to a `<link>` tag.

### Semantic progress events
Each section file write emits: `FILE_STREAM` (streaming) → `FILE_WRITTEN` (complete). Chat feed shows a file preview bubble with the section name. Founder can watch Nia write each section in sequence.

### Retries
Via watchdog if Nia goes silent for 1 minute. Up to 3 watchdog retries. The 1-minute threshold is aggressive: high Anthropic API latency could falsely trigger it.

### Revision behavior
After the founder requests changes via the ApprovalCard, a new Nia revision task is inserted with the feedback in its description. Nia re-runs and rewrites the relevant files. Max 3 Nia revisions (checked by counting completed Nia tasks; after 3, REVISION_LIMIT_REACHED is emitted and Leo is dispatched with what exists).

### Photo rejection behavior (as of today)
When a founder rejects a stock photo, Nia now asks: "1. I'll find a different photo, or 2. You attach your own." If the founder picks 1, Nia calls `search_photos` with `exclude_urls` containing all previously embedded URLs. If the founder picks 2, Nia drops a CSS gradient placeholder and waits.

### Preview rendering
`/preview/design/[projectId]` reads `design/assembled.html` from `file_snapshots` and returns it as `text/html`. Available immediately after each section write. Embedded in an iframe in the ApprovalCard.

### Timings (approximate, from observed runs)
- Objective → Nia start: ~2–5 min (Maya clarification + planning)
- Nia start → first section file: ~30–60s (search_photos + first write_file)
- Nia start → all sections done: ~4–10 min (depends on section count)
- Nia start → assembled.html ready: same, assembly is instant
- Total Nia duration: ~4–10 min

### Old vs current comparison

| Aspect | Old | Current |
|---|---|---|
| Generation strategy | One monolithic HTML file | Section-by-section |
| Streaming | None until complete | FILE_STREAM every ~300 chars |
| First visible progress | After full generation (0–8 min wait) | ~30s (first section) |
| Footer placement | Random mid-page (keyword sort failure) | Always last (fixed sort) |
| CSS approach | Inline styles, reinvented per section | Tailwind CDN + tokens.css |
| Photo rejection | Re-searched blindly, same problem | Offers choice, excludes prior URLs |
| Timeout risk | High (monolith could hit Vercel 300s) | Lower (each section is a separate short call) |

### Verdict: **SIGNIFICANTLY IMPROVED**
The monolithic generation problem is solved. The founder sees real progress within 30 seconds. Section assembly is automatic. However Nia still cannot see photos she embeds, and the 1-minute watchdog threshold introduces false-positive retry risk.

---

## 6. ALIGNMENT / APPROVAL

### What the founder approves
An assembled HTML design (`design/assembled.html`) rendered in an iframe embedded in the chat feed. The iframe is approximately 60% scale (via CSS transform). There is no side-by-side comparison or section-by-section annotation.

### Approval state
Stored as: the `human` task row (`jugnu_key: 'human'`) moves from `pending` → `in_progress` (when APPROVAL_REQUIRED fires) → `completed` (when founder approves).

### Request-changes behavior
Founder types feedback in a text box and clicks "Request changes." A new Nia revision task is created (sort_order: -1, depends_on: []). The human task is reset to pending. Nia re-runs with the feedback in her task description.

### Revision loop
Max 3 Nia revisions. After the third, REVISION_LIMIT_REACHED is emitted and Leo is dispatched with whatever design currently exists.

### Persistence after refresh
YES. The human task row is in the DB. If the founder refreshes mid-approval, the ApprovalCard reappears because the task is still in_progress.

### How approval unlocks execution
`POST /api/projects/[id]/approve` → marks human task completed → `advanceProject` → Leo dispatched. Approval is the explicit gate between design and execution.

### Whether approval is HTML-specific
PARTIAL. The approval mechanism (human task → ApprovalCard) is generic. The artifact rendered is always `design/assembled.html`. For non-HTML projects there is no preview in the iframe, just the task description. In practice, all current projects are HTML.

### Whether Nia's artifact becomes authoritative context for Leo
YES, because Leo calls `read_file('design/assembled.html')` (and `list_files` to find all design files). The assembled HTML is Leo's primary source. Additionally, Maya's Leo task description contains design direction from the task plan.

### Whether Tara can compare final output against approved direction
PARTIAL (LLM judgement only). Tara reads both the design files and Leo's `index.html`. She compares them by reasoning, not by diff. No automated diff, no pixel comparison.

### "Align cheaply before executing expensively"
**PARTIAL.** The principle is architecturally real: Nia (Haiku, cheap) aligns before Leo (Haiku, more turns) executes. The founder reviews before any heavy execution. But the "cheap" part is undermined by Nia taking 4–10 minutes and sometimes requiring 2–3 revision cycles. The total Nia cost before alignment is not negligible.

---

## 7. LEO — WHAT DOES "BUILD" MEAN NOW?

### Capability matrix

| Capability | Status |
|---|---|
| Write files | YES — via `write_file` tool to `file_snapshots` table |
| Create complete project | PARTIAL — single `index.html` only |
| Create GitHub branch | NO — code exists in `lib/jugnus/github.ts` but is never called |
| Create PR | NO — same |
| Install dependencies | NO |
| Compile / transpile | NO |
| Execute build | NO |
| Run tests | NO |
| Start application | NO |
| Create runnable preview | PARTIAL — served via Next.js route from DB |
| Deploy to CDN/Vercel | NO |
| Detect compilation failures | NO (no build step) |
| Detect runtime failures | Via `submit_for_review` validation only (basic HTML structure check) |
| Automatically repair build failures | NO — Tara must request_changes |
| Rerun after repair | YES — via Tara's request_changes, new Leo task |

### Execution environment
None. Leo writes text to a database row. There is no sandbox, no container, no file system, no process. The "app" runs in the user's browser when they open `/preview/[projectId]`.

### Supported frameworks
React via CDN only (single file, no build). Tailwind via CDN. No other framework is feasible given the constraint.

### Supported project types
- Static landing pages
- React CDN single-page apps
- Apps using the Jugnus Data API (`/api/data/PROJECT_ID/collection`) for persistence
- Forms submitting to `/api/collect/PROJECT_ID`

### Unsupported project types (currently)
- Anything requiring npm, TypeScript compilation, or a build step
- Multi-page apps (multiple .html files are possible in theory but Leo is instructed to write one file)
- Apps requiring a database schema (Supabase tables, migrations)
- Apps requiring auth
- Apps requiring payment processing

### Preview mechanism
`/preview/[projectId]` — Next.js route reads `file_snapshots WHERE path = 'index.html'` and returns `Content-Type: text/html`. No auth. Publicly accessible. The URL is permanent as long as the `file_snapshots` row exists.

### "When Jugnus says Leo built it — what actually happened?"
Leo produced a single HTML file stored as a text string in Supabase. The file uses React CDN, Tailwind CDN, and Jugnus Data API for any persistence. It is being served by a Next.js route that reads and returns that text string.

**Can we truthfully tell a user "Your project works"?**
PARTIALLY. The HTML renders in a browser. Interactive features (forms, CRUD) work via the Data API. But it is not "deployed" — it lives as a DB row. If the project is deleted from the DB, the preview 404s. There is no custom domain, no CDN caching, no uptime guarantee beyond Vercel's standard availability.

---

## 8. TARA — WHAT CAN SHE ACTUALLY VERIFY?

### What Tara receives in context
- Full project context block (objective, founder decisions, completed tasks with artifacts)
- BUILD EVIDENCE section: `html_valid` (bool), `primary_html_file` (filename), `preview_url`, `checked_at`
- Last 30 messages
- Access to all files via `read_file` / `list_files`
- Access to the live preview URL via `call_api` and `browse_app`

### Deterministic verification (code-based, binary)

| Check | How | Deterministic? |
|---|---|---|
| HTML file exists with `<body>` and `</html>` | `submit_for_review` validation (Leo's tool) | YES |
| HTML > 200 characters | Same | YES |
| CRUD API returns 201 on POST | `call_api` status code check | YES |
| CRUD API returns 200 on GET | `call_api` status code check | YES |
| CRUD API returns 200 on PATCH | `call_api` status code check | YES |
| CRUD API returns 204 on DELETE | `call_api` status code check | YES |
| Page not blank (`blank_screen: false`) | `browse_app` Chromium check | YES (when available) |
| No console errors | `browse_app` console capture | YES (when available) |
| Specific text present on page | `browse_app` check_text action | YES (when available) |
| "PROJECT_ID_HERE" literal not present | Tara reads file and checks | YES |
| PATCH used instead of PUT | Tara reads file and checks | YES |

### LLM judgement (non-deterministic)

| Check | How |
|---|---|
| Copy quality and tone match | Tara reads and reasons |
| Mobile responsiveness claim | Tara reads CSS and reasons |
| Completeness against objective | Tara compares task description to output |
| Visual design quality | Tara cannot see the rendered page |
| Conversion effectiveness | Pure LLM reasoning |
| Feature coverage | Tara reads code |

### When browse_app fails
The route returns `{ ok: false, available: false }` gracefully. Tara's prompt says to proceed with file review if browse_app fails. This means deterministic browser checks become unavailable silently — Tara falls back to LLM code review.

### Rejection and correction
`request_changes`: if Leo has completed fewer than 2 tasks, Tara creates a new Leo task with her feedback. If Leo has completed 2+ tasks, Tara escalates to the founder instead.

**Note on off-by-one:** This means Tara gets effectively ONE correction attempt. Leo's first task is already completed when Tara runs. If Tara requests_changes once, Leo completes his second task, and Tara's second run triggers escalation (count = 2 ≥ 2). This is likely a bug.

### "When the UI says Review passed — what has been proven?"
- HTML file exists, has basic structure tags, is longer than 200 chars (deterministic).
- CRUD API calls returned expected HTTP status codes (deterministic, if the Data API was used).
- Page not blank in headless Chromium (deterministic, if browse_app available).
- Content matches objective (LLM judgement).
- Design matches approved Nia artifact (LLM judgement).
- No obvious console errors (deterministic if browse_app available).

**NOT proven:** visual design quality, mobile layout, actual conversion value, edge case handling, performance, accessibility.

---

## 9. COMPLETION / DELIVERY

### What the founder receives

| Artifact | Delivered? | Details |
|---|---|---|
| Preview URL | YES | `/preview/[projectId]` — HTML from DB, public |
| Design preview URL | YES | `/preview/design/[projectId]` — assembled.html |
| GitHub PR | NO | Code exists but never called |
| Deployment URL | NO | "deploy_url" = same as preview URL |
| Custom domain | NO | Not implemented |
| Review result | YES | Tara's REVIEW_PASSED message with specifics |
| Verification evidence | PARTIAL | Tara's message lists deterministic checks passed |
| Files panel | YES | All generated files accessible in sidebar |
| Cost summary | NO | Costs are in the DB but not surfaced in the UI |

### Conditions required for PROJECT_COMPLETED
1. Tara calls `approve` tool
2. `approve` handler validates `html_valid: true` on the latest Leo artifact (hard gate)
3. Sets `project.status: 'completed'`, `project.deploy_url: '/preview/[projectId]'`
4. Emits REVIEW_PASSED and PROJECT_COMPLETED messages

### Can PROJECT_COMPLETED occur with...

| Scenario | Possible? |
|---|---|
| Failed build (html_valid: false) | NO — `approve` hard-gates on html_valid |
| No runnable preview | NO — preview URL is generated by submit_for_review |
| Deployment failure | N/A — there is no deployment step |
| Tara skipped | YES — if watchdog marks Tara's task failed after 3 retries, project stays 'reviewing'. No PROJECT_COMPLETED. Pipeline is stuck. |
| Unresolved founder requirement | YES — Tara uses LLM judgement for completeness; she may approve a project that misses a stated requirement |

### Misleading completion states
1. The "deploy_url" set on completion is a DB-backed preview, not a real deployment. The URL in `projects.deploy_url` looks like a live site but is actually a Next.js route reading a Supabase row.
2. "Review passed" does not mean the app is complete or correct — it means deterministic checks passed and Tara's LLM judgement approved. A missing feature might pass if Tara doesn't catch it.
3. If Tara's task fails (watchdog exhausts retries), the project stays in `reviewing` status indefinitely with no user-facing error message.

---

## 10. ORCHESTRATION

### DAG
Tasks have `depends_on uuid[]` — a list of task IDs that must be completed before this task is ready. `executor.ts::getNextReadyTask` scans all pending tasks and finds those whose entire `depends_on` set is completed. Genuinely graph-driven.

### Task claiming
Atomic: `UPDATE tasks SET status='in_progress' WHERE id=X AND status='pending'`. If the update affects 0 rows, the task was already claimed. This prevents double-dispatch in concurrent watchdog + pipeline scenarios.

### Concurrency
One task runs at a time per project (executor checks for any in_progress task before dispatching next). No parallel jugnus within a project.

### Human tasks
`jugnu_key: 'human'` tasks are handled specially in `advanceProject`: mark in_progress, emit APPROVAL_REQUIRED, return `dispatched: false`. They are never dispatched to a jugnu.

### Watchdog
Runs every 1 minute via Vercel Crons. Finds stuck tasks via `get_stuck_tasks` RPC (activity-based: no message or file snapshot write in last 1 minute, OR hard cap 10 minutes since started_at). Also finds orphaned pending tasks (all deps done but task never dispatched, pending > 1 minute). Retries up to 3×, then marks `failed`. Resets `started_at` on each retry (so hard cap measures from the current attempt, not cumulative).

**Critical gap:** `get_stuck_tasks` is an SQL RPC with no migration file. On a fresh deployment without that RPC, the watchdog silently processes 0 stuck tasks. Only the orphaned-pending detection works.

### Budget / correction loops
- Budget: `credit_ceiling_usd` on projects. Checked before each model call. If exceeded, BUDGET_EXCEEDED message and dispatch stops. No UI to set this — manual DB edit only.
- Correction: Tara `request_changes` creates a new Leo task. Bounded at 1 effective correction (see Tara section).

### Dynamic vs hardcoded
**Dynamic (infrastructure level):**
- DAG resolution (executor.ts)
- Task claiming (atomic DB update)
- Task routing (jugnu_key drives dispatch)
- Watchdog recovery

**Hardcoded (prompt level):**
- Maya always creates the same 4-task chain for web pages
- Leo always produces `index.html`
- Tara's max corrections

### Has implementation drifted toward a fixed pipeline?
YES, at the prompt level, but the infrastructure remains genuinely graph-driven. The standard `Maya → Nia → human → Leo → Tara` chain accounts for ~95% of all runs. The v2.0 gate further reduces the variety of graphs produced (blocking any complex request before planning).

---

## 11. EVENTS / REALTIME

### Storage
All events stored as `messages` rows with `metadata.event_type`. Standard message author/content fields carry additional signal.

### Realtime
Supabase Realtime is enabled on the `messages` table. The UI (`ProjectChannel.tsx`) subscribes via `supabase.channel().on('postgres_changes', ...)`.

### Replay
On page load, the UI fetches the last N messages from the DB. Full event history is available from message history. The UI processes events in order.

### Current semantic events

| Event | Source | UI Effect |
|---|---|---|
| USER_MESSAGE | /api/messages | User bubble in chat |
| TASK_ASSIGNED | executor.ts | Task status badge + ETA |
| PLAN_CREATED | create_task_plan | Task list appears in sidebar |
| CLARIFICATION_REQUIRED | ask_founder | InlineClarification widget |
| INFO_REQUESTED | request_info | Info request card |
| JUGNU_THINKING | dispatch.ts | Typing bubble with activity label |
| JUGNU_STARTED | dispatch.ts | Streaming text begins |
| JUGNU_SPOKE | dispatch.ts | Streaming text finalised |
| FILE_STREAM | dispatch.ts | FileStreamBubble (live preview) |
| FILE_WRITTEN | write_file | File added to Files panel |
| TASK_COMPLETED | complete_task | Task marked done in sidebar |
| REVIEW_STARTED | submit_for_review | "Tara is reviewing..." |
| REVIEW_PASSED | approve | Green review card + preview link |
| REVIEW_FAILED | pipeline error | Error message |
| TASK_RETURNED | request_changes | "Sending back to Leo..." |
| APPROVAL_REQUIRED | executor.ts | ApprovalCard appears |
| PROTOTYPE_APPROVED | /approve route | "Design approved" message |
| PROTOTYPE_REVISED | /approve route | "Changes requested" message |
| REVISION_LIMIT_REACHED | /approve route | "Moving to build with current design" |
| PROJECT_COMPLETED | approve handler | "View live →" link, confetti(?) |
| UPGRADE_REQUIRED | generate_image | ProUpgradeCard (once per project) |
| V2_WAITLIST_JOINED | join_v2_waitlist | Waitlist confirmation card |
| BUDGET_EXCEEDED | dispatch.ts | Budget warning message |

**Dead event:** `PROTOTYPE_READY` — handled in WorldRenderer but never emitted by any code.

### Meaningful changes since previous handoff
- FILE_STREAM added (real-time write_file streaming)
- BUDGET_EXCEEDED added
- V2_WAITLIST_JOINED added
- ETA messaging added to TASK_ASSIGNED
- PROJECT_COMPLETED now emitted from approve handler (previously only from executor)

---

## 12. DATABASE / STORAGE

### Tables

**workspaces**
- id, name, slug, owner_id (→ auth.users), created_at

**jugnus**
- id, workspace_id, key (maya/nia/leo/tara), name, role, capabilities[], color, status (idle/working/reviewing/blocked/done), created_at

**projects**
- id, workspace_id, title, objective, constraints (jsonb — founder_constraints[], attachments[], approval_metrics, revision_count), status (active/planning/building/reviewing/completed/blocked/cancelled), deploy_url, total_cost_usd, credit_ceiling_usd, created_at, updated_at

**tasks**
- id, project_id, title, description (full context for jugnu), capability, jugnu_key, depends_on (uuid[]), status (pending/in_progress/completed/blocked/skipped/failed), result, artifact (jsonb — build_evidence, etc.), sort_order, retry_count, started_at, completed_at, model, input_tokens, cached_tokens, output_tokens, model_calls, estimated_cost_usd

**messages**
- id, project_id, author_type (user/jugnu/system/activity), author_key, content, task_id, metadata (jsonb — event_type, widget data, preview_url, etc.), created_at

**escalations**
- id, project_id, task_id, jugnu_key, question, options (jsonb), status (pending/resolved/dismissed), resolution, created_at, resolved_at

**file_snapshots**
- id, project_id, task_id, path, content (text), created_at, updated_at
- UNIQUE(project_id, path)

**game_scores**
- id, user_id, workspace_id, project_id, score, created_at

**project_data** *(NO MIGRATION FILE — added directly to live DB)*
- Backing store for `/api/data/[projectId]/[collection]`. Structure inferred from API: stores arbitrary JSON records keyed by project + collection name.

**form_submissions** *(NO MIGRATION FILE — added directly to live DB)*
- Used by `/api/collect/[projectId]` and shown in JugnuPanel sidebar.

### Key data locations

| Data | Where |
|---|---|
| Founder objective | `projects.objective` |
| Clarification Q&A | `projects.constraints.founder_constraints[]` |
| Uploaded image URLs | `projects.constraints.attachments[]` |
| Task graph | `tasks` rows with `depends_on` UUID arrays |
| Generated files | `file_snapshots.content` (text) |
| Build evidence | `tasks.artifact` (Leo's completed task) |
| Nia alignment artifact | `file_snapshots` (`design/assembled.html`) |
| Verification evidence | `messages` (Tara's REVIEW_PASSED content) |
| Preview/deploy URL | `projects.deploy_url` |
| Per-task cost | `tasks.estimated_cost_usd` |
| Project total cost | `projects.total_cost_usd` |
| Cross-project memory | NOT IMPLEMENTED |
| Workspace memory | NOT IMPLEMENTED |

### Missing migrations
The following DB objects are referenced in code but have no migration file:
- `project_data` table
- `form_submissions` table
- `get_stuck_tasks` SQL RPC
- `increment_project_cost` SQL RPC

On a fresh DB, these missing objects cause silent failures or partial functionality.

---

## 13. COST + OBSERVABILITY

### What is tracked (DB-level)

| Metric | Where | Queryable? |
|---|---|---|
| Model used per task | `tasks.model` | YES |
| Input tokens per task | `tasks.input_tokens` | YES |
| Cached tokens per task | `tasks.cached_tokens` | YES |
| Output tokens per task | `tasks.output_tokens` | YES |
| Model calls per task | `tasks.model_calls` | YES |
| Estimated cost per task (USD) | `tasks.estimated_cost_usd` | YES |
| Project total cost | `projects.total_cost_usd` | YES |
| Retry count per task | `tasks.retry_count` | YES |
| Task duration (started_at → completed_at) | `tasks` timestamps | YES |

### Pricing constants (hardcoded in dispatch.ts)
- Sonnet: $3.00/M input, $0.30/M cached read, $15.00/M output
- Haiku: $0.80/M input, $0.08/M cached read, $4.00/M output

### What the founder can see
NOTHING about cost or tokens in the current UI. The JugnuPanel sidebar shows task progress and form submissions, but no cost breakdown.

### What is DB/log only
All of it. Cost data exists in the DB but is not surfaced anywhere in the product.

### What we should collect before alpha that we are NOT collecting
- Per-project total latency (objective received → PROJECT_COMPLETED)
- Nia task duration specifically (design bottleneck metric)
- Leo task duration
- Clarification round-trip count (how many ask_founder calls per project)
- Revision count per project (how many Nia revisions before approval)
- Tara pass/fail rate
- Watchdog retry rate (what % of tasks need watchdog recovery)
- Project abandonment (projects started but never completed, with last-active event)
- Which search_photos queries return zero results (falls back to Picsum)

---

## 14. CURRENT USER EXPERIENCE

### Onboarding
Minimal. User signs up via Supabase Auth. A default workspace is created. The workspace has the 4 jugnus pre-seeded. No tutorial, no empty state explanation, no example projects.

### Project creation
Fullscreen prompt input with optional file/image attachment. Clean. Character counter visible. On submit, the chat opens immediately and Maya begins.

### Chat
Realtime message stream. Typing bubbles during generation. FileStreamBubble shows file name + live content as it streams. MCQ widgets for clarification. ApprovalCard for design review.

### Clarification
Clean MCQ widget embedded inline in chat. Founder selects answers and submits in one click. Founder decisions are immediately durable (stored in DB on submission).

### Progress
Left sidebar shows task list with status dots (pending/in_progress/completed/failed). Jugnu status indicators (idle/working/done). No overall % complete number for the founder (sidebar has it in JugnuPanel at project level but it's a fraction, not % UX).

### Nia preview
Inline iframe in chat at approximately 60% scale. "Open full design →" link opens `/preview/design/[projectId]` in a new tab. Preview updates in real-time as Nia writes sections (via FILE_STREAM).

### Approval
ApprovalCard below the preview. Two actions: "Approve & Build" and "Request changes" with a text input. Clean. Persists after refresh.

### Build state (Leo)
FileStreamBubble shows `index.html` being written live. No explicit "Leo is building" status card — it's just the streaming text.

### Tara review
Message card with review findings. Green if passed.

### Files
FilesPanel (right sidebar). Shows all generated files, organized by path. Click to see content. HTML files shown in iframe preview. Code files shown as text.

### Completion
REVIEW_PASSED message with "View live →" link. PROJECT_COMPLETED system message. No email notification, no summary report, no export option.

### Errors
If a task fails (watchdog exhausts retries), a system message appears. No specific recovery guidance for the founder. No indication of whether the project can be retried.

### Cost visibility
NONE. Founder sees no cost information at any point.

### Desktop
**ACCEPTABLE** — the three-panel layout (chat, right sidebar files, left sidebar jugnus) works. Some panel overflow issues on narrow screens.

### Mobile
**NOT READY** — three-panel layout breaks on mobile. Chat is functional but FilesPanel and JugnuPanel overlap or are hidden. No mobile-specific layout.

---

## 15. WORLD + FLAPPY

### World
An isometric SVG grid (6×5 tiles) with 4 jugnu desk blocks rendered in 3D. Each desk changes color by status. A floating artifact block animates between desk positions as the pipeline advances. Realtime via `useProjectEvents`. **Does not affect core orchestration in any way.**

### Flappy Jugnu
IMPLEMENTED AND PLAYABLE. Canvas-based Flappy Bird clone. Full game loop, scoring, firefly collectibles, obstacle generation. Scores submitted to `game_scores` table. Leaderboard in sidebar. Accessible via the World tab. Does not affect the pipeline.

### Impact on core product
NONE. Both are purely UI features running client-side.

---

## 16. TECH STACK + FILE MAP

### Stack

| Layer | Technology |
|---|---|
| Framework | Next.js (App Router) |
| Language | TypeScript |
| UI | React + Tailwind CSS |
| Database | Supabase (PostgreSQL) |
| Realtime | Supabase Realtime (postgres_changes on messages) |
| Auth | Supabase Auth |
| Storage | Supabase Storage (project-attachments, project-previews buckets) |
| Hosting | Vercel (Fluid Compute, maxDuration varies by route) |
| Models | Anthropic Claude (Sonnet 4.6 for Maya/Tara, Haiku 4.5 for Nia/Leo) |
| Photos | Unsplash API (with Picsum fallback) |
| Browser testing | @sparticuz/chromium + playwright-core |
| Email | Resend |
| Animation | Framer Motion |
| GitHub (incoming) | GitHub App (OAuth + webhooks) — for receiving events, NOT for pushing |

### Important files

```
lib/jugnus/
  registry.ts       — All four jugnu system prompts and tool availability
  tools.ts          — All tool definitions, input schemas, and handlers
  dispatch.ts       — Builds context block, calls Claude Streaming API, tracks tokens
  pipeline.ts       — runPipeline: dispatch + retry + advance to next task
  context.ts        — formatContextBlock: assembles structured context for each jugnu
  github.ts         — pushProjectToGitHub (DEAD CODE — never called)

lib/orchestration/
  executor.ts       — advanceProject: DAG resolution, task claiming, human task handling

app/api/
  projects/route.ts               — POST: create project, seed jugnus, dispatch Maya
  projects/[id]/approve/route.ts  — POST: founder approval or revision request
  internal/jugnu-respond/route.ts — POST: 202 + waitUntil → runPipeline
  messages/route.ts               — POST: founder message, re-dispatches Maya if escalation pending
  cron/watchdog/route.ts          — GET: stuck task recovery, orphan detection
  cron/scheduler/route.ts         — GET: runs scheduled_actions from project_data
  internal/browser-test/route.ts  — POST: Playwright/Chromium headless test
  data/[projectId]/[collection]/  — CRUD REST API for Leo's apps
  collect/[projectId]/route.ts    — Form submission endpoint
  upload/route.ts                 — Generic file upload to Supabase Storage
  preview/[projectId]/            — Serves index.html from file_snapshots
  preview/design/[projectId]/     — Serves design/assembled.html from file_snapshots

app/w/[slug]/
  page.tsx                        — Workspace project-channel page
  components/ProjectChannel.tsx   — Main chat UI (1070 lines)
  components/ProjectPageClient.tsx — Chat/World tab switcher
  components/JugnuPanel.tsx       — Left sidebar: jugnu roster + task list + form submissions
  components/FilesPanel.tsx       — Right sidebar: file tree + preview
  components/WorldRenderer.tsx    — Isometric SVG world view
  components/FlappyJugnu.tsx      — Flappy Bird game

supabase/migrations/
  001_initial.sql — Core tables
  002_rls_policies.sql — Row-level security
  003_file_snapshots.sql — file_snapshots table
  004_telemetry.sql — Token/cost tracking columns
  005_game_scores.sql — Flappy leaderboard
  006_schema_fixes.sql — tasks.failed status, messages.activity type, retry_count
  007_deploy_url.sql — projects.deploy_url column
  [MISSING: project_data, form_submissions tables; get_stuck_tasks, increment_project_cost RPCs]
```

---

## 17. WHAT CHANGED SINCE SEPTEMBER 12

| Area | Change | Status |
|---|---|---|
| **Watchdog** | Activity-based stuck detection (file_snapshots + messages timestamps) | ADDED |
| **Watchdog** | Hard cap false-kill bug fixed (started_at now resets on each retry) | FIXED |
| **Watchdog** | Orphaned pending task recovery | ADDED |
| **Watchdog** | 1-minute activity threshold | FIXED (was 3 min, reduced) |
| **Pipeline handoff** | jugnu-respond now responds 202 immediately; pipeline awaits before returning | FIXED |
| **Pipeline retry** | Inline 2-attempt retry in runPipeline before watchdog involvement | ADDED |
| **Founder images** | Images persisted to projects.constraints.attachments (not just message history) | FIXED |
| **Founder images** | Verbatim img tags passed to Nia and Leo's context | FIXED |
| **Nia generation** | Section-by-section writing (not monolithic HTML) | ADDED |
| **Nia generation** | write_file streaming via FILE_STREAM messages | ADDED |
| **Nia design scaffold** | Tailwind CDN + tokens.css + correct footer sorting | ADDED (today) |
| **Nia design scaffold** | design_tokens in create_task_plan → seeds tokens.css before Nia | ADDED (today) |
| **Nia photos** | search_photos mandatory before first write_file | FIXED |
| **Nia photos** | Photo rejection: choice offered, exclude_urls prevents repeats | FIXED (today) |
| **Nia photos** | Picsum fallback when UNSPLASH_ACCESS_KEY not set | ADDED |
| **Leo** | Single-file rule enforced (≤700 lines) | FIXED |
| **Leo** | Ban on localStorage — must use Data API | ADDED |
| **Leo** | PATCH vs PUT enforcement | FIXED |
| **Tara** | Live API testing via call_api (real CRUD test) | ADDED |
| **Tara** | Headless browser testing via browse_app (Playwright/Chromium) | ADDED |
| **Tara** | Correction loop bounded at 2 completed Leo tasks | ADDED |
| **Maya** | force tool_choice:any (eliminates pure-reasoning timeouts) | FIXED |
| **Maya** | v2.0 gate + waitlist flow | ADDED |
| **Maya** | ETA estimates per jugnu task | ADDED |
| **Maya** | Asks brand tone for local businesses | IMPROVED |
| **Maya** | Asks app name for interactive apps | FIXED |
| **Maya** | design_tokens in create_task_plan for web pages | ADDED (today) |
| **Approval** | 3-revision cap on Nia | ADDED |
| **Approval** | approve route handles watchdog-failed human tasks | FIXED |
| **Events** | FILE_STREAM, BUDGET_EXCEEDED, V2_WAITLIST_JOINED added | ADDED |
| **Events** | PROJECT_COMPLETED emitted from approve handler (not just executor) | FIXED |
| **Cost tracking** | Per-task token + cost tracking | ADDED |
| **Cost tracking** | Project total_cost_usd incremented per dispatch | ADDED |
| **GitHub PR** | REMOVED from submit_for_review (was present, now gone) | REMOVED |
| **Onboarding** | UNCHANGED — still minimal |
| **Mobile** | UNCHANGED — broken |
| **Cost UI** | UNCHANGED — not surfaced to founder |
| **Cross-project memory** | UNCHANGED — not implemented |
| **Real deployment** | UNCHANGED — preview served from DB |
| **Durable context** | Maya → Nia → Leo → Tara durable context was already present; improved by fixing image persistence | IMPROVED |

---

## 18. CURRENT TOP PROBLEMS

### P0 — Alpha blockers

**P0-1: Missing DB migrations for critical tables**
- PROBLEM: `project_data`, `form_submissions`, `get_stuck_tasks` RPC, `increment_project_cost` RPC have no migration files.
- USER IMPACT: On any fresh deployment, Data API returns 500s, watchdog stuck-detection is silently disabled, cost tracking has race conditions.
- ROOT CAUSE: Tables added directly to live DB rather than via migrations.
- FIX: Write migration files for all four. Extract RPC SQL from the live DB and codify it.
- EFFORT: ~2 hours.

**P0-2: No real deployment — "live URL" is a DB row**
- PROBLEM: `deploy_url` = `/preview/projectId` served by a Next.js route reading Supabase. Not a real CDN-hosted page.
- USER IMPACT: Founders cannot share their "website" with a custom domain or stable URL. If the project is deleted, the URL 404s. No CDN, no SSL cert control, no uptime SLA beyond Vercel's.
- ROOT CAUSE: GitHub PR push removed from pipeline; no replacement deployment mechanism added.
- FIX: Options: (a) Push to GitHub Pages on completion, (b) Deploy to Vercel via API on completion, (c) Be explicit in UI that the URL is a hosted preview, not a production website.
- EFFORT: (a/b) ~3–5 days; (c) 2 hours UI copy change.

**P0-3: Watchdog `get_stuck_tasks` RPC silently absent on fresh deployment**
- PROBLEM: Primary stuck-detection uses an RPC that has no migration. On a fresh DB the watchdog silently does nothing for stuck in_progress tasks.
- USER IMPACT: Pipeline can freeze indefinitely on any new environment.
- ROOT CAUSE: SQL function added directly to live DB without a migration file.
- FIX: Add migration creating the RPC.
- EFFORT: 1 hour.

**P0-4: Mobile is broken**
- PROBLEM: Three-panel layout collapses on mobile. Chat may work but FilesPanel and JugnuPanel are not accessible.
- USER IMPACT: Any founder on a phone sees a broken product.
- ROOT CAUSE: No mobile layout designed or implemented.
- FIX: Responsive single-column layout with bottom-sheet panels.
- EFFORT: 2–3 days.

**P0-5: Leo's correction loop effectively allows only 1 revision from Tara**
- PROBLEM: `request_changes` escalates instead of retrying if Leo's completed task count ≥ 2. Leo's first task is counted, so Tara gets exactly one correction before escalating.
- USER IMPACT: A project with a single fixable bug in Leo's output will escalate to the founder instead of auto-correcting.
- ROOT CAUSE: Off-by-one in the `request_changes` handler (should compare against number of Leo revision tasks, not total Leo task completions).
- FIX: Count only Leo revision tasks (sort_order > 0), not the initial Leo task.
- EFFORT: 30 minutes.

### P1 — Important but launchable

**P1-1: Cost invisible to founders**
- PROBLEM: Token usage and USD cost are tracked in the DB but shown nowhere in the UI.
- USER IMPACT: Founders have no idea what their projects are costing. Can't budget. Can't see when to stop.
- ROOT CAUSE: UI never built for cost display.
- FIX: Simple cost badge on project completion or in JugnuPanel.
- EFFORT: 1 day.

**P1-2: No error recovery UX**
- PROBLEM: When a task fails (watchdog exhausted retries), the founder sees a generic error message with no recovery path.
- USER IMPACT: Founder doesn't know if they should refresh, retry, or start over.
- ROOT CAUSE: No retry/restart UI built.
- FIX: "Retry this task" button on failed task messages.
- EFFORT: 1–2 days.

**P1-3: Nia's 1-minute watchdog threshold risks false kills**
- PROBLEM: If Claude API latency spikes (cold starts, Anthropic API slowness), the watchdog fires on an actively-working Nia before her first output arrives.
- USER IMPACT: Unnecessary retries, wasted API spend, possible duplicate file writes.
- ROOT CAUSE: NO_ACTIVITY_THRESHOLD_MINUTES = 1 is aggressive for a model that can take 30–60s just to start a response.
- FIX: Raise to 2 minutes, or add a JUGNU_STARTED event within dispatch to reset the activity clock.
- EFFORT: 30 minutes.

**P1-4: No onboarding / empty state**
- PROBLEM: User sees a blank sidebar with no guidance on what to type. No example projects, no template prompts.
- USER IMPACT: New users don't know what to say. Churn on first session.
- ROOT CAUSE: Not built.
- FIX: 3–4 starter prompt suggestions on empty state. A brief one-liner explaining what the product does.
- EFFORT: 1 day.

**P1-5: generate_image is permanently broken (pro gate is a dead end)**
- PROBLEM: `generate_image` always returns `upgrade_required: true`. ProUpgradeCard button does nothing.
- USER IMPACT: Founders who click "Upgrade to Pro" see a dead button. Erodes trust.
- ROOT CAUSE: AI image generation never implemented. No payment system.
- FIX: Either remove the tool entirely and hide the UI, or implement actual generation.
- EFFORT: Remove option = 2 hours. Implement = 3+ days.

**P1-6: No cross-project or workspace memory**
- PROBLEM: Each project starts fresh with no knowledge of prior projects in the same workspace.
- USER IMPACT: Founders have to re-specify brand colors, tone, and name on every project. Feels like a tool, not a team.
- ROOT CAUSE: Not implemented.
- FIX: Workspace-level memory (brand profile stored in workspaces table, injected into each new project's context).
- EFFORT: 2–3 days.

**P1-7: Tara's browse_app may silently degrade**
- PROBLEM: If Chromium isn't available in the Vercel environment, browse_app returns `available: false` and Tara falls back to file review without telling the founder.
- USER IMPACT: "Review passed" may reflect only LLM code review, not live browser test.
- ROOT CAUSE: Chromium binary availability is environment-dependent.
- FIX: Log Chromium availability. Surface in Tara's REVIEW_PASSED message which verification methods ran.
- EFFORT: 4 hours.

**P1-8: No project deletion UI**
- PROBLEM: Projects can only be deleted via direct DB manipulation.
- USER IMPACT: Founders who start a bad project are stuck with it in their sidebar.
- ROOT CAUSE: Not built.
- FIX: Delete project button with confirmation dialog.
- EFFORT: 1 day.

### P2 — Later

**P2-1: GitHub PR creation never happens** — GitHub push code exists but is dead. No PR delivery. Lower priority than other P1s because the preview URL works; it's misleading framing not a broken experience.

**P2-2: Leo capabilities label mismatch** — System prompt lists Next.js, Supabase, TypeScript, migrations — none accessible to Leo. Should update capability labels to match reality or build the real capability.

**P2-3: RLS policies inconsistent with service role usage** — Policies written for anon client but app uses service role. Not a security issue now but will be if client-side DB writes are ever added.

**P2-4: No email on project completion** — Founder gets no notification if they close the browser while Leo/Tara run.

**P2-5: World's PROTOTYPE_READY dead event** — Dead handler code. Minor cleanup.

---

## 19. ALPHA LAUNCH READINESS

### Per-system rating

| System | Rating |
|---|---|
| Maya | ACCEPTABLE FOR PRIVATE ALPHA |
| Nia | ACCEPTABLE FOR PRIVATE ALPHA |
| Leo | ACCEPTABLE FOR PRIVATE ALPHA |
| Tara | ACCEPTABLE FOR PRIVATE ALPHA |
| Clarification | ACCEPTABLE FOR PRIVATE ALPHA |
| Durable context | READY |
| Alignment (design approval) | READY |
| Execution (build) | ACCEPTABLE FOR PRIVATE ALPHA |
| Verification | ACCEPTABLE FOR PRIVATE ALPHA |
| Deployment | NOT READY — no real deployment; preview URL is a DB row |
| Reliability | ACCEPTABLE FOR PRIVATE ALPHA (watchdog + retries work; false kill risk remains) |
| Error recovery | NOT READY — no founder-facing recovery path |
| Security | ACCEPTABLE FOR PRIVATE ALPHA (service role used throughout; no multi-user issues at single-user alpha scale) |
| Cost control | NOT READY — credit_ceiling not configurable from UI; no visibility to founders |
| Onboarding | NOT READY — no empty state, no guidance |
| Observability | NOT READY — cost data in DB only; no ops dashboard |
| Desktop | ACCEPTABLE FOR PRIVATE ALPHA |
| Mobile | NOT READY |

### What would stop you from inviting 10 strangers today?

**MUST FIX BEFORE PRIVATE ALPHA:**
1. Missing migrations (P0-1) — any fresh alpha deployment will silently break
2. Error recovery UX (P0 but no P0 designation above — founders must have a path when things break)
3. Onboarding / empty state — strangers do not know what to type
4. Generate_image dead end — ProUpgradeCard button does nothing; erodes trust on first encounter
5. Tara correction loop off-by-one (P0-5) — auto-repair barely works

**CAN FIX AFTER PRIVATE ALPHA:**
- Mobile (if alpha users are desktop)
- Real deployment / custom domain
- Cost visibility
- Cross-project memory
- Email notification on completion
- Analytics dashboard

---

## 20. ICP REALITY CHECK

### Who should the first 10–20 users be?

**Primary ICP:** Non-technical Indian small business owner or solo founder who wants a landing page or simple web presence and has no developer relationship. Budget-conscious. Comfortable with WhatsApp-level UX. Has a business that exists (not just an idea) — they have a brand name, a product, maybe some photos.

**Ideal profiles:** chai stall owner wanting an online menu, yoga studio owner wanting a booking landing page, food delivery brand wanting a product page, freelance consultant wanting a portfolio, event organiser wanting a registration form.

### 5 ideal prompts
1. "Build a landing page for my organic snack brand called Munchly. We sell roasted seeds and nuts. Our colors are earthy brown and green. CTA is Order on Swiggy."
2. "I run a yoga studio called Serene Flow in Bandra. Build a landing page with class schedule, about us, and a contact form."
3. "Build a tip calculator app for restaurant staff — enter bill amount, select tip %, show per-person split."
4. "Build a landing page for my handmade jewellery brand. We sell sustainable silver jewellery for women 25–40. CTA: Shop Now (link to Etsy)."
5. "Build a task manager where I can add tasks with title, priority, and due date. Let me mark them complete."

### 5 prompts to NOT encourage yet
1. "Build me a full SaaS with user accounts, subscription billing, and a team dashboard."
2. "Build an e-commerce store where customers can browse products and check out."
3. "Build me a mobile app."
4. "Build a marketplace where buyers and sellers can register and trade."
5. "Build a real-time chat app with multiple rooms."

### What value proposition can we honestly advertise?
"Describe your business in plain English. Our AI team builds you a working landing page in under 20 minutes — no code, no freelancer, one checkpoint for your approval."

**Honest caveats to disclose:**
- The output is a hosted preview page (jugnus.vercel.app/preview/...), not a website with your own domain.
- Complex apps (auth, payments, multi-page) are not supported yet.
- AI-generated stock photos may not be perfect — you can provide your own.

---

## 21. DELEGATION THESIS REALITY CHECK

| Capability | Status | Evidence |
|---|---|---|
| Delegation without workflow configuration | REAL | Founder types a sentence; no config required |
| Intelligent clarification | PARTIAL | Maya asks the right questions for ambiguous briefs; but the heuristic is prompt-based, not learned |
| Dynamic planning | PARTIAL | Maya creates a genuine task graph; but it's constrained to two patterns |
| Cheap alignment (design before build) | REAL | Nia on Haiku; approval before Leo; genuinely gates execution |
| Human approval at meaningful boundary | REAL | Design approval is the one explicit founder touchpoint |
| Autonomous execution | PARTIAL | Leo executes autonomously; but produces only a single HTML file |
| Independent review | PARTIAL | Tara runs real tests; but verification coverage is narrow |
| Deterministic verification | PARTIAL | CRUD API + headless browser checks are real; rest is LLM |
| Bounded correction | PARTIAL | 1 effective Leo correction (off-by-one bug), 3 Nia revisions |
| Reliable delivery | PARTIAL | Pipeline completes ~60–70% of runs without founder re-intervention (estimated); watchdog helps |
| Durable project context | REAL | Founder decisions persist in DB; injected into all downstream contexts |
| Persistent workspace/company memory | ASPIRATIONAL | Not implemented |
| Learning from previous projects | ASPIRATIONAL | No data flywheel, no model fine-tuning, no retrieval |

### Verdict
**We are genuinely becoming a delegation product at the micro-scale.** The founder-touchpoint design is real and correct: one clarification session, one design approval, then hands off. Durable context is real. The pipeline runs with genuine autonomy.

However the output is deeply constrained: **one HTML file, no real deployment, no GitHub PR.** A founder who delegates "build my startup's website" to Jugnus gets a preview URL that disappears if the project is deleted. That is not delegation — that is a glorified prototype generator.

The architecture is correct. The current output is too limited. The honest answer: **Jugnus is currently a real delegation system producing toy outputs.** Closing that gap — primarily by adding real deployment — would make the delegation thesis real.

---

## 22. ARCHITECTURE VS LONG-TERM VISION

### What is already domain-neutral
- The DAG orchestration engine (executor.ts) is fully domain-neutral — it knows nothing about HTML, websites, or code. It just resolves task dependencies and dispatches.
- The event system (messages table + Realtime) is domain-neutral.
- The context block format (objective, constraints, decisions, files, build evidence) is domain-neutral.
- The escalation/request_info mechanism is domain-neutral.
- Jugnu identities (Maya, Nia, Leo, Tara) are stable names with configurable roles.
- The approval gate (human task) is domain-neutral.

### What is coupled to software/web output
- Nia's system prompt: deeply HTML-specific (sections, Tailwind, tokens.css, footer, hero)
- Leo's system prompt: deeply HTML-specific (index.html, React CDN, Data API fetch patterns)
- Tara's system prompt: web-specific (API CRUD tests, headless browser, HTML validation)
- `complete_task` handler: has special-case Nia logic (section assembly, assembled.html)
- `submit_for_review` validation: checks for `<body>` and `</html>` tags
- Preview routes: serve HTML from file_snapshots

### What would be difficult to generalize later
- The section assembly logic in `complete_task` is tightly coupled to HTML fragment structure
- `submit_for_review` validation is HTML-specific
- The preview infrastructure assumes HTML output
- Leo's capability model (single file, CDN, Data API) would need a complete replacement for any other output type

### What NOT to generalize yet
Everything. The product is too early. The current coupling to HTML/web is appropriate given the ICP and output type. Premature abstraction here would slow everything down. The right time to generalize is when the first non-web project type is actually needed.

---

## 23. DATA / POTENTIAL MOAT

### Behavioral data currently captured

| Data | Captured? | Queryable? |
|---|---|---|
| Founder objective (raw text) | YES | YES (`projects.objective`) |
| Clarification questions Maya asked | YES | YES (`escalations.question`) |
| Founder's answers | YES | YES (`escalations.resolution`) |
| Task graph structure | YES | YES (`tasks` table) |
| Nia revision count | YES | YES (count completed Nia tasks per project) |
| Founder approval vs revision decision | YES | YES (`messages` with PROTOTYPE_APPROVED/REVISED) |
| Revision feedback text | YES | YES (revision task description) |
| Leo revision count (Tara corrections) | YES | YES (count completed Leo tasks) |
| Task durations | YES | YES (`tasks.started_at`, `completed_at`) |
| Cost per task | YES | YES (`tasks.estimated_cost_usd`) |
| Retry count | YES | YES (`tasks.retry_count`) |
| Generated files | YES | YES (`file_snapshots`) |
| Build evidence (html_valid) | YES | YES (`tasks.artifact`) |
| Tara approval vs request_changes | YES | YES (messages) |
| Project completion vs abandonment | PARTIAL | projects.status queryable; but "abandoned" vs "stuck" not distinguished |
| Watchdog intervention count | PARTIAL | retry_count is total; not whether watchdog vs pipeline triggered it |
| Founder image attachments | YES | YES (`projects.constraints.attachments`) |

### Questions we could eventually answer

| Question | Feasible today? |
|---|---|
| Which clarification questions prevent failures? | PARTIAL — correlate escalation Q&A with completion status |
| Which briefs need clarification? | YES — brief length/specificity vs escalation count |
| Which alignment patterns reduce rework? | PARTIAL — revision count per project |
| Which task graphs work for which objectives? | YES — when we have more project types |
| Which errors recur? | PARTIAL — retry_count by jugnu_key; needs failure message analysis |
| Which tasks need stronger models? | YES — correlate task.model with retry_count and revision count |
| Where do humans intervene? | YES — escalation rows |
| What predicts successful completion? | Eventually — needs enough projects first |

### Foundation for data flywheel?
YES, partially. The raw material is being captured. The schema is structured enough to run cohort analyses on it. What's missing: a data engineering layer (no warehouse, no pipeline, no dashboards), and enough projects to make the signals meaningful. The structured nature of `tasks`, `escalations`, and `messages` with `event_type` means the data is actually analyzable without a large transformation effort.

---

## 24. NEXT 7 DAYS

**1. Write missing migrations and RPCs** (P0)
WHY: Fresh deployments and alpha environments are broken without these. The watchdog's primary stuck-detection is silently disabled. The Data API returns 500s.
USER IMPACT: Alpha will not work reliably on any new deployment.
EFFORT: ~2–3 hours
ALPHA BLOCKER: YES

**2. Fix Tara's correction loop off-by-one** (P0)
WHY: Tara effectively gets zero auto-corrections in many runs. Leo writes something slightly wrong; Tara sends it back; Leo fixes it; Tara escalates on the second check instead of verifying the fix.
USER IMPACT: Founders get escalations they shouldn't need to handle.
EFFORT: ~30 minutes
ALPHA BLOCKER: YES

**3. Add onboarding / starter prompts** (P1)
WHY: External users have never seen Jugnus. An empty text box with no guidance is a conversion killer.
USER IMPACT: New users will not know what to type and will leave.
EFFORT: ~1 day
ALPHA BLOCKER: YES (for external users)

**4. Add error recovery UX** (P1)
WHY: When a task fails, founders have no recovery path. They can't retry, they can't restart, they can't understand what happened.
USER IMPACT: A stuck project is a lost user.
EFFORT: ~1–2 days
ALPHA BLOCKER: YES

**5. Remove or fix generate_image dead end** (P1)
WHY: ProUpgradeCard "Upgrade to Pro" button does nothing. This is the first thing a founder encounters when Nia searches for images in a new project. A dead button on first use erodes trust immediately.
USER IMPACT: Trust damage.
EFFORT: Remove = 2 hours. Hide with honest copy = 2 hours.
ALPHA BLOCKER: YES (trust)

**6. Address the "deployment" framing** (P0)
WHY: The product tells founders their site is "live" but delivers a DB-backed preview URL with no custom domain. This is the single biggest trust-killer for anyone who actually tries to share their "website."
USER IMPACT: Founders who try to share their link realize it's a preview, not a website.
EFFORT: Honest UI copy = 2 hours. Real GitHub Pages or Vercel deployment = 3–5 days.
ALPHA BLOCKER: YES (honest framing required even if full fix waits)

**7. Add project delete button to UI** (P1)
WHY: Without it, founders are stuck with bad projects in their sidebar. Currently requires manual DB cleanup.
USER IMPACT: Embarrassing UX for founders testing the product.
EFFORT: ~1 day
ALPHA BLOCKER: NO — but high quality-of-life

---

## 25. FINAL LAUNCH VERDICT

```
JUGNUS CURRENT STATE — 18 SEPTEMBER 2026

Product:               AI team that produces single-file HTML pages from plain-English briefs
Primary ICP:           Non-technical Indian small business owner wanting a landing page
Primary supported outcome: Functional one-page website (preview URL, not real deployment)

Maya:          ACCEPTABLE FOR PRIVATE ALPHA (clarification works; v2.0 gate is correct)
Nia:           ACCEPTABLE FOR PRIVATE ALPHA (section-by-section, scaffold in place, photo choice added today)
Leo:           ACCEPTABLE FOR PRIVATE ALPHA (single-file HTML is limiting but honest)
Tara:          ACCEPTABLE FOR PRIVATE ALPHA (real tests run; correction loop buggy but works)

Clarification:     READY (durable, MCQ widgets work, ask_founder + request_info both functional)
Durable context:   READY (founder decisions in DB, injected into all downstream contexts)
Alignment:         READY (one approval gate, clean UX, persists on refresh)
Execution:         ACCEPTABLE FOR PRIVATE ALPHA
Verification:      ACCEPTABLE FOR PRIVATE ALPHA (deterministic + LLM; browse_app may degrade)
Deployment:        NOT READY (preview URL is a DB row, not a real website)
Memory:            NOT READY (no workspace or cross-project memory)
Cost tracking:     NOT READY FOR FOUNDER (data in DB; nothing surfaced in UI)
Analytics:         NOT READY (no ops dashboard, no project-level telemetry UI)
Desktop:           ACCEPTABLE FOR PRIVATE ALPHA
Mobile:            NOT READY
World:             IMPLEMENTED (cosmetic, no pipeline impact)
Flappy:            PLAYABLE (fully implemented, scores to DB)

Biggest strength:    Durable context + single-approval design — founders touch once, pipeline runs
Biggest weakness:    "Live" output is a DB-backed preview URL, not a real deployment
Biggest technical risk: Missing DB migrations will silently break any fresh alpha deployment
Biggest product risk: Founders expect a website; they get a preview link that disappears if deleted

PRIVATE ALPHA READINESS: 5/10

If you were the founder, would you invite 10 external users today?
NO

Exact blockers:
1. Missing migrations (get_stuck_tasks RPC, project_data table, form_submissions table, increment_project_cost RPC) — fresh environments are silently broken
2. generate_image dead-end (ProUpgradeCard button does nothing — immediate trust damage)
3. No onboarding / starter prompts — external users will not know what to type
4. No error recovery UX — stuck projects leave founders stranded
5. "Deployment" framing is misleading — product says "live" but delivers a DB preview URL
6. Tara correction loop bug — off-by-one means auto-repair barely triggers

Estimated focused engineering days until private alpha: 7–10 days

Recommended private-alpha date: 28 September 2026

TOP 3 NEXT ACTIONS:
1. Write the missing migrations (2–3 hours): project_data table, form_submissions table, get_stuck_tasks RPC, increment_project_cost RPC — alpha cannot be deployed without these
2. Fix the dead-end and framing issues (1 day): remove generate_image tool entirely (or be honest it's not ready), update UI copy so "View live →" is clearly labeled as "View preview →" with an honest note about what it is
3. Add onboarding + error recovery (2–3 days): starter prompt suggestions on empty state, retry button on failed tasks, simple cost badge on completion
```

---

*This document was generated from direct codebase inspection on 18 September 2026. Every claim is traceable to a specific file and line. Trust this over any previous strategy document, plan, or handoff.*
