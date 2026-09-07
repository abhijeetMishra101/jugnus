# Jugnus — Forensic Technical Assessment
**Date:** 2026-09-08  
**Purpose:** Current-state analysis for AI-to-AI reasoning. No aspirational content. Classify each answer as IMPLEMENTED / PARTIALLY IMPLEMENTED / NOT IMPLEMENTED.

---

## 1. Orchestration / Graph

**PARTIALLY IMPLEMENTED as a real graph; PARTIALLY HARDCODED in practice.**

**Who creates the tasks?**  
Maya calls `create_task_plan` (tool in `lib/jugnus/tools.ts`). She writes every task herself — title, description, `jugnu_key`, and `depends_on_indices` (0-based indices into her own task array).

**Are tasks and dependencies generated dynamically by Maya?**  
Yes. The tool accepts any array of tasks with arbitrary dependencies. Maya constructs the graph herself.

**Can Maya create a different execution graph depending on the objective?**  
Yes. Her system prompt (`lib/jugnus/registry.ts`) explicitly instructs: "Skip Leo when the deliverable is a document, plan, or written artifact." She decides per project.

**Can tasks run in parallel?**  
The data model supports it (`depends_on` is an array). The executor (`lib/orchestration/executor.ts`) does **not** — it hard-checks for any `in_progress` task and returns early if one exists. Only one jugnu runs at a time.

**Can a task depend on multiple previous tasks?**  
Yes — `depends_on` is an array of task IDs. `getNextReadyTask` checks all deps are in `completedIds`. This works correctly today.

**Can Maya dynamically add/remove/reorder tasks after execution starts?**  
No. There is no tool for this. The only dynamic graph mutation is Tara's `request_changes`, which inserts a new Leo task at `sort_order: 999`.

**Can the graph branch based on intermediate results?**  
Only one branch exists: Tara → request_changes → new Leo task. Maya cannot branch.

**Can the graph contain loops?**  
One loop exists: Tara → Leo revision → Tara (bounded at 2 Leo completions). Nia revision loops are also possible (approval gate → feedback → new Nia task), but not bounded.

**What causes execution to advance?**  
Each jugnu's terminal tool (`complete_task`, `submit_for_review`, `approve`, `request_changes`) calls back into `advanceProject` via `pipeline.ts`. There is no external trigger — it's a synchronous chain.

**Is there a central executor/orchestrator?**  
Yes: `lib/orchestration/executor.ts`. It owns: in-progress guard, next task selection, task dispatch, project completion detection.

**How much of Maya → Nia → approval → Leo → Tara is hardcoded vs model-decided?**  
The **agent roster** (`nia`, `leo`, `tara`, `human`) and **capability enum** (`design`, `build`, `review`, `approval`) are hardcoded in the tool schema. Maya decides the **order**, **which agents appear**, **how many tasks each gets**, and **what each task says**. The pipeline sequence itself emerges from Maya's graph, not from hardcoded routing code.

**Examples of execution graphs the current system can genuinely run:**

*Graph 1 — full pipeline:*
```
Maya (plan) → Nia (design) → Human (approve) → Leo (build) → Tara (review)
```

*Graph 2 — document only (no Leo):*
```
Maya (plan) → Nia (document) → Tara (verify) → done
```

*Graph 3 — with revision loop:*
```
Maya → Nia → Human (reject) → Nia revision → Human (approve) → Leo → Tara (request_changes) → Leo revision → Tara (approve)
```

---

## 2. Dynamic Agent Routing

**PARTIALLY IMPLEMENTED.**

Maya CAN:
- Skip Nia entirely
- Skip Leo (explicitly instructed to do so for non-code deliverables)
- Skip Tara (though instructed not to for substantive artifacts)
- Assign multiple tasks to the same jugnu (e.g., two Leo tasks)
- Give each task different instructions

Maya CANNOT:
- Assign to an agent outside `['nia', 'leo', 'tara', 'human']` — this is a hardcoded enum in the tool schema
- Create a new agent role at runtime
- Assign to a custom domain specialist

`jugnu_key` today is determined by: Maya's judgment, constrained to the four-value enum. The executor routes based on whatever Maya puts in `jugnu_key`. There is no secondary routing layer.

---

## 3. Clarification

**PARTIALLY IMPLEMENTED.**

Maya has the `ask_founder` tool. The system prompt instructs her to ask only when "answers would materially change WHAT gets built or WHO does it."

**What triggers it:** Maya's own LLM judgment.

**How many questions:** Maya is instructed to ask all questions in one call. The tool accepts a single `question` string plus optional `options` array — one structured question per call.

**Where are answers stored:** In the `escalations` table (`project_id`, `task_id`, `jugnu_key`, `question`, `options`, `status`, `resolution`).

**Do answers become durable project constraints:** NOT automatically. The answers sit in the escalations table. Maya's system prompt instructs her to "embed [answers] explicitly in each task description — do not rely on chat history alone." This happens at Maya's discretion when she calls `create_task_plan`. They do not flow into `projects.constraints`.

**Do Nia/Leo/Tara receive them:** Only indirectly — through the task `description` field if Maya remembered to embed them. The context block does not surface escalation answers; it only shows `projects.constraints` (which does not include clarification answers).

---

## 4. Context Architecture

**Context is hybrid: structured block + last 30 raw messages.**

For every jugnu (`dispatch.ts`, `context.ts`):

| Component | Maya | Nia | Leo | Tara |
|---|---|---|---|---|
| Project title + objective | ✅ | ✅ | ✅ | ✅ |
| `projects.constraints` (JSON) | ✅ | ✅ | ✅ | ✅ |
| Project-specific persona (display_role, focus) | ✅ | ✅ | ✅ | ✅ |
| All completed tasks + their `result` field | ✅ | ✅ | ✅ | ✅ |
| Pending tasks (title + jugnu_key only) | ✅ | ✅ | ✅ | ✅ |
| Current task (title, description, capability) | ✅ | ✅ | ✅ | ✅ |
| Last 30 user + jugnu messages | ✅ | ✅ | ✅ | ✅ |
| File contents | ❌ | ❌ (must read_file) | ❌ (must read_file) | ❌ (must read_file) |
| Escalation answers | ❌ | ❌ | ❌ | ❌ |
| Nia's approved artifact (explicit reference) | N/A | N/A | ❌ (must read_file) | ❌ (must read_file) |
| Previous failed attempt content | ❌ | ❌ | ❌ | ❌ |
| Token counts / cost | ❌ | ❌ | ❌ | ❌ |

**Conversation history filter:** `author_type IN ('user', 'jugnu')` — activity messages and system messages are excluded.

**Last 30 messages** means: if Maya wrote 20 messages and Nia is starting, Nia sees ~20 messages of Maya's planning output, most of which is irrelevant to Nia's task.

**Prompt caching:** The `contextBlock` (structured project brief) gets `cache_control: { type: 'ephemeral' }` on the first system block. The jugnu system prompt is the second block with no cache. Conversation history is NOT cached. The context block benefits from caching across the 10-turn agentic loop for a single jugnu, but NOT across jugnus (different jugnus have different context blocks with different completed-task data).

**Unnecessary context being sent repeatedly:**
1. Maya's full output (up to 20 messages) is sent to Nia, Leo, and Tara — most of it irrelevant
2. ALL completed task results go to every jugnu, even Tara who only needs Leo's result
3. Pending tasks list goes to Tara (she doesn't care what Maya planned)
4. File contents are NOT in the context block — jugnus must call `read_file` explicitly, which is more efficient than blindly including all files

---

## 5. Approval / Commitment Boundary

**IMPLEMENTED for Nia. PARTIALLY GENERIC.**

**The gate object:** A `tasks` row with `jugnu_key: 'human'`, `capability: 'approval'`, `status: 'in_progress'`.

**What prevents Leo:** `advanceProject` checks for any `in_progress` task first. The human task being in_progress blocks the executor from advancing. Leo's task also depends on the human task's ID, so dependency resolution would still block Leo independently.

**On Approve:** `POST /api/projects/[id]/approve` → marks human task `completed` → calls `advanceProject` → dispatches Leo.

**On Request Changes:** Creates a NEW Nia task at `sort_order: -1` → puts human task back to `pending` → `advanceProject` dispatches Nia.

**Revision loop bounded:** For Nia revisions via the approval gate — **NOT BOUNDED**. A founder could request changes indefinitely. Tara→Leo is bounded at 2; Nia→human is not.

**Approved design as immutable artifact:** NOT implemented. When Nia writes a revised design, it overwrites the same `file_snapshots` row (upsert with `onConflict: 'project_id,path'`). Leo always reads the current file snapshot. No explicit "approved version" flag.

**Is the mechanism generic enough for any artifact?** The task-based gate is fully generic. What is NOT generic: the `/preview/[projectId]` route serves HTML only. The `DesignPreviewCard` renders an iframe to that route. These are HTML-specific.

---

## 6. Nia / Alignment Artifact

**PARTIALLY GENERIC in prompts; HTML-COUPLED in rendering.**

**Architecture supports:**
- Nia can `write_file` to any path with any content (text)
- The DB stores it as a text blob — completely format-agnostic
- The task description says what format to produce
- `complete_task` stores a result summary

**What current prompts/tools actually support:**  
Nia's system prompt (`registry.ts`) explicitly lists: HTML mockup, structured document, marketing draft, slide outline. These are real instructions, not aspirational.

The **preview route** (`app/preview/[projectId]/route.ts`) reads the design file and serves it with `Content-Type: text/html`. Works for HTML. For a text document, it renders as unstyled text in the iframe. For anything else, the preview would be meaningless.

The inline `DesignPreviewCard` in chat is an iframe pointing to this route — it degrades gracefully for non-HTML (shows the text), but is clearly designed for HTML.

**Does Nia have a generic concept of "alignment artifact":** Yes, in the system prompt. Not in the DB model. The file_snapshots table is the artifact store — there is no `artifact_type` column distinguishing an HTML mockup from a slide outline.

---

## 7. Leo / Execution

**PARTIALLY IMPLEMENTED as a general builder; STRONGLY COUPLED to Next.js.**

**Tools available to Leo:**
- `complete_task` — marks done
- `list_files` — lists project files
- `read_file` — reads one file
- `write_file` — creates/overwrites a file (text only)
- `submit_for_review` — marks done AND pushes to GitHub AND creates PR

**Leo CAN:**
- Create multiple files (multiple `write_file` calls)
- Overwrite existing files (write_file upserts)
- Read any file in the project

**Leo CANNOT:**
- Delete files (no `delete_file` tool)
- Run shell commands
- Install dependencies
- Run npm build or tests
- Launch a browser or inspect rendered output
- Take screenshots
- Deploy independently (push happens in submit_for_review, via GitHub App)
- Interact with external APIs at runtime
- Write binary files (file_snapshots.content is text)

**Leo's stack per system prompt:** Next.js App Router, Supabase, Tailwind CSS, TypeScript strict mode.

**What prevents Leo from being a general execution agent:** No shell execution, no runtime feedback, no tool use against external systems, no ability to observe the result of his own code running. He writes files into a database, not a filesystem.

---

## 8. Tara / Review

**IMPLEMENTED as LLM judgment. NOT evidence-based.**

**Tara receives:**
- Full project context (objective, all tasks, constraints)
- Last 30 messages (including Leo's messages about what he built)
- Can `list_files` + `read_file` to inspect every file Leo wrote

**Tara does NOT receive:**
- Build results (no build runs)
- Test results (no tests run)
- Browser output or screenshots
- Rendered visual of the code

**Does Tara compare against original objective?** Yes, explicitly — system prompt: "verify the deliverable against what the founder originally asked for — not just whether it technically satisfies the task description."

**Is review objective-evidence-based?** No. Entirely LLM judgment over file contents.

**`request_changes` bounded:** Yes — checked at `(leoRevisions ?? 0) >= 2`. After 2, Tara is instructed to "approve with reservations" or the tool escalates automatically. Cannot loop indefinitely.

---

## 9. Tool / Skill Architecture

**Directly embedded per jugnu. One large if-chain in `tools.ts`.**

`buildToolsForJugnu` is a single function with `if (jugnuKey === 'maya')`, `if (['leo', 'nia', 'tara'].includes(...))`, `if (jugnuKey === 'leo')`, `if (jugnuKey === 'tara')` blocks. Tools are not modular objects — they're defined inline.

**Compatibility with a skills registry:**  
The abstraction point exists: `ToolSet = { definitions: Anthropic.Tool[], handlers: Record<string, fn> }`. The factory function signature `buildToolsForJugnu(jugnuKey, projectId, taskId, db)` could become `buildToolsFromSkillList(skills[], projectId, taskId, db)`.

A `skills/` directory approach would require:
- A `Skill` interface: `{ name, definitions, handlers(ctx) }`
- A skill registry mapping capability names to Skill implementations
- Maya's tool definition updated to enumerate available skills
- `buildToolsForJugnu` replaced by `buildToolsFromSkillList(skills)`

**No foundational obstacle** to this pattern. The current code would be ~150 lines of straightforward extraction.

---

## 10. Artifact Model

**`file_snapshots` is text-file-oriented. NOT sufficient for binary types.**

| Artifact type | Supported | Gap |
|---|---|---|
| HTML | ✅ | Works fully including inline preview |
| Source code (TS/JS/CSS) | ✅ | Stored and pushed to GitHub |
| Markdown / text docs | ✅ | Stored; preview renders as unstyled text |
| JSON / YAML | ✅ | Stored as text |
| Images (PNG/JPG) | ❌ | `content` is a text column; binary would corrupt |
| PDFs | ❌ | Binary |
| PPTX | ❌ | Binary |
| Spreadsheets | ❌ | Binary (XLSX); CSV works as text |
| Video | ❌ | Binary |
| Structured research (text) | ✅ | Works as markdown/JSON |

**Would supporting binary require a new artifact abstraction?** Yes. You'd need: (1) Supabase Storage or S3 for binary blobs, (2) an `artifact_url` column or separate `artifacts` table with a `type` discriminant, (3) per-type preview renderers in the UI, (4) per-type push logic for GitHub.

---

## 11. Long-Running Projects

**TIGHTLY DESIGNED for sub-300s per jugnu. NOT designed for multi-day projects.**

| Concern | Current State |
|---|---|
| Vercel 300s limit | Each jugnu has 300s (`maxDuration = 300`). A single jugnu turn cannot exceed this. A task cannot span multiple invocations. |
| Watchdog | Fires every 5 min, restarts tasks stuck >4 min, up to 3 retries. Good for crashes. Useless for genuinely long-running tasks. |
| Task state | `pending / in_progress / completed / failed`. No `paused`, `waiting_on_external`, `scheduled`. |
| Scheduled tasks | None. No mechanism to say "run Leo tomorrow." |
| Resumability | NOT designed. A jugnu must complete in one HTTP invocation. No checkpoint/resume. |
| External events | No listener. The project doesn't know about anything that happens outside its own pipeline. |
| Approvals | Human task type IS a pause mechanism. The only one. Works for days/weeks as long as the DB row persists. |
| Retries | MAX_RETRIES=3, then failed. No exponential backoff. |
| Idempotency | `write_file` is idempotent (upsert). Task status changes are not (double-dispatch is not safe). |

---

## 12. Cost Control

**MOSTLY NOT IMPLEMENTED.**

| Control | Status | Notes |
|---|---|---|
| Token accounting | ❌ NOT IMPLEMENTED | API returns usage; code discards it |
| Per-project token usage | ❌ NOT IMPLEMENTED | — |
| Model usage logging | ❌ NOT IMPLEMENTED | — |
| Cached-token tracking | ❌ NOT IMPLEMENTED | Caching is used but savings not recorded |
| Cost calculation | ❌ NOT IMPLEMENTED | — |
| Retry limits | ✅ IMPLEMENTED | MAX_RETRIES = 3 (watchdog) |
| Max agent turns | ✅ IMPLEMENTED | 10 turns per dispatch |
| Max tool calls | ⚠️ INDIRECT | Bounded by 10 turns |
| Max revision cycles (Tara→Leo) | ✅ IMPLEMENTED | 2 Leo completions max |
| Max revision cycles (Nia→human) | ❌ NOT BOUNDED | Founder can loop Nia indefinitely |
| Project budgets | ❌ NOT IMPLEMENTED | — |
| Pre-execution estimates | ❌ NOT IMPLEMENTED | — |

**"This project cost $0.83"** — NOT POSSIBLE today. The Anthropic API returns usage data in each stream response, but `dispatch.ts` discards it. No token counts are stored anywhere.

**Top sources of unnecessary token spend:**
1. All 30 messages (including Maya's full planning output) sent to every subsequent jugnu
2. All completed task results sent to every jugnu regardless of relevance
3. No caching of conversation history between turns within a jugnu's 10-turn loop
4. Tara reads all files via `read_file` tool calls — if Leo wrote 5 large files, that's 5 additional round trips plus 5× file content in the next turn's messages

---

## 13. Failure / Recovery

| Stage | Failure Mode | Current Behavior | Permanently Stuck? |
|---|---|---|---|
| Maya — model fail | Exception in dispatchJugnu | pipeline.ts catches, posts error message, resets jugnu idle | Task stays in_progress → watchdog restarts in 4 min |
| Maya — timeout | Vercel kills after 300s | Task stays in_progress | Watchdog restarts |
| Maya — tool fail | try/catch in dispatch.ts | `is_error: true` returned to Claude; loop continues | No |
| Nia — same as Maya | Same | Same | Same |
| Approval gate — browser close | Nothing — human task stays in_progress | On reload, `APPROVAL_REQUIRED` event re-derives approval UI | No — DB state is truth |
| Leo — GitHub push fail | Error caught in pushProjectToGitHub | Falls back: posts message without PR link, continues pipeline | No |
| Leo — timeout | Same as Maya | Watchdog restarts Leo | Could retry with wrong state if files were partially written |
| Tara — same as Maya | Same | Same | Same |
| Task marked failed (3 retries) | Watchdog gives up | Status = failed, message posted | **YES — project permanently stuck** |
| advanceProject concurrent calls | Race condition | Could dispatch same task twice | Unlikely but possible |

**Which operations are idempotent:**
- `file_snapshots` upsert — YES
- `jugnus.upsert` on project creation — YES
- Task `complete` update — effectively yes
- `advanceProject` — NO (concurrent calls could double-dispatch)

**Watchdog behavior:** Cron every 5 minutes. Finds tasks with `status = in_progress` AND `started_at < (now - 4 minutes)`. For each: if `retry_count >= 3` → mark `failed`. Otherwise: increment `retry_count`, POST to `jugnu-respond` with a nudge message.

---

## 14. Telemetry / Data Moat

| Signal | Stored? | Where | Reliable? |
|---|---|---|---|
| Original objective | ✅ YES | `projects.objective` | HIGH |
| Questions asked | ✅ YES | `escalations.question` | HIGH |
| Answers to questions | ✅ YES | `escalations.resolution` | HIGH |
| Constraints embedded | ⚠️ PARTIAL | `projects.constraints` (jugnu_roles only) | MEDIUM |
| Graph chosen | ✅ YES | `tasks` table (all rows + depends_on) | HIGH |
| Agent assignments | ✅ YES | `tasks.jugnu_key` | HIGH |
| Models used | ❌ NO | — | — |
| Tools used per task | ⚠️ PARTIAL | Activity messages mention tool names | LOW — not structured |
| Prototype version(s) | ⚠️ PARTIAL | `file_snapshots` (current only; overwrites) | LOW — no version history |
| Founder approval | ✅ YES | `tasks` (human task result) + messages | HIGH |
| Rejection reason | ✅ YES | `escalations.resolution` + message content | MEDIUM |
| Build attempts | ⚠️ PARTIAL | `tasks.retry_count` | MEDIUM — watchdog retries only |
| Tara failures | ✅ YES | Messages with `TASK_RETURNED` event | MEDIUM |
| Tara failure reasons | ⚠️ PARTIAL | Message content text | LOW — not structured |
| Revision count | ⚠️ DERIVABLE | Count completed Leo tasks | MEDIUM |
| Final artifact | ✅ YES | `file_snapshots` (current state) | HIGH |
| Total tokens | ❌ NO | — | — |
| Total cost | ❌ NO | — | — |
| Total duration | ⚠️ DERIVABLE | `projects.created_at` vs `tasks.completed_at` | MEDIUM |

**You are throwing away:** tokens per task, cost per task, prototype version history, and structured tool-use logs. The graph, objective, approval chain, and final artifact are all preserved.

---

## 15. Project Memory

**NOT IMPLEMENTED.**

`buildProjectContext` queries only the current project. There is no workspace-level context: no shared knowledge base, no past project index, no approved design library.

What exists at workspace level: `workspaces.id`, `workspaces.name`, `workspaces.slug`. Nothing about previous deliverables, brand decisions, or founder preferences.

**Project 2 ("Add enterprise offering") gets zero awareness of Project 1 ("Build my startup website").** It would not know the site exists, what stack it uses, or what design decisions were made.

---

## 16. Security

| Concern | Status | Detail |
|---|---|---|
| Supabase RLS | ✅ APPLIED | Migration `002_rls_policies.sql` confirmed applied |
| Workspace isolation in queries | ✅ YES | All project queries use `workspace_id + project_id` |
| Service role usage | ✅ SERVER-ONLY | `createServiceClient()` in all API routes |
| Internal API auth | ✅ BEARER TOKEN | `INTERNAL_API_SECRET` checked in jugnu-respond |
| Tool permissions per jugnu | ✅ CORRECT | Maya can't write files; Leo can't create task plans |
| Arbitrary code execution | ✅ SAFE | Leo writes to DB only — no eval, no shell |
| Secret exposure | ✅ SAFE | All env vars accessed server-side only |
| **Prompt injection** | ⚠️ EXPOSURE | Nia writes file content → Leo reads via `read_file` → content passed to Claude as tool result. No sanitisation. |
| Generated file trust | ⚠️ UNVALIDATED | Files pushed to GitHub as-is. No content scan. |
| GitHub credentials | ✅ SAFE | App private key in env vars; used server-side only |
| Public alpha risk | ⚠️ MEDIUM | Prompt injection via file contents is the main vector. Founder-initiated only mitigates it, but multi-tenant expansion would elevate this. |

---

## 17. Generality Test

**A. "Build a landing page for my bakery."**
- Graph: Maya → Nia (HTML mockup) → Human (approve) → Leo (Next.js page) → Tara
- Artifact: React component + page.tsx pushed to GitHub
- Succeeds: entirely within core capability
- Fails: Leo outputs Next.js code; founder needs a deployment environment to see it

**B. "Create a 10-slide investor pitch deck."**
- Maya's prompt says "Presentation: slide-by-slide outline" — Leo skipped
- Artifact: A text/markdown file with slide titles and bullet points
- Succeeds: outline is produced
- Fails: not a real deck file (no PPTX, no PDF). Founder gets a markdown document.

**C. "Create a 7-slide LinkedIn carousel about AI agents."**
- Maya will likely route to Leo (carousel sounds like a web component)
- Graph: Maya → Nia (HTML carousel mockup) → Human → Leo (HTML/CSS carousel) → Tara
- Artifact: an HTML file with slide-style content
- Succeeds: produces something visually carousel-like in HTML
- Fails: not actual carousel images for LinkedIn upload. No image generation.

**D. "Research the top five competitors to my startup and produce a report."**
- Graph: Maya → Nia (writes research report) → Tara
- Nia has NO web search tool — she writes from training knowledge
- Artifact: a fabricated research document based on Claude's training data
- **MAJOR FAILURE**: data is hallucinated, not researched. No search tool exists.

**E. "Launch a marketing campaign for my bakery and improve it over the next month."**
- Graph: Maya → Nia (marketing plan document) → Tara
- Artifact: a text document with campaign ideas
- "Launch": not possible — no external integrations, no social posting
- "Improve over a month": not possible — no long-running project support, no scheduling, no analytics feedback
- **COMPLETE FAILURE on the execution and iteration dimensions.**

---

## 18. Architectural Coupling

| Assumption | Coupling | Effort to Generalize |
|---|---|---|
| Leo's stack is Next.js + Supabase + Tailwind | HIGH — in system prompt and capability labels | Swap system prompt + capabilities; LOW |
| GitHub push is always to the same `GITHUB_OUTPUTS_REPO` | MEDIUM — hardcoded in `pushProjectToGitHub` | Add per-workspace repo config; MEDIUM |
| Exactly four jugnus (`'maya' \| 'nia' \| 'leo' \| 'tara'`) | HIGH — TypeScript union type enforced throughout | Requires schema + type change; MEDIUM |
| `jugnu_key` enum in `create_task_plan` tool | HIGH — Maya can't choose outside this list | Add enum value or make open string; LOW |
| `/preview/[projectId]` serves HTML only | MEDIUM — design preview is HTML-iframe | Per-type renderer needed; MEDIUM |
| Short-lived 300s execution per jugnu | HIGH — Vercel function duration; fire-and-forget chain | Requires job queue; HIGH |
| Claude specifically | LOW — one Anthropic client; one model constant | Swap client + model; LOW |
| `waitUntil` from @vercel/functions | MEDIUM — used in project creation | Replace with async trigger; LOW |
| No binary artifact support | HIGH — `file_snapshots.content` is text | New storage layer + artifact model; HIGH |
| No cross-project memory | HIGH — context builder is single-project only | Workspace memory system needed; HIGH |
| Sequential single-agent execution | HIGH — executor blocks on in_progress | Parallel dispatch requires concurrency redesign; HIGH |

---

## Summary

### 1. What Jugnus Actually Is Today

A four-agent sequential pipeline where Claude plays each role. The founder writes an objective; Maya (Claude) generates a task graph; Nia (Claude) produces a text-or-HTML alignment artifact; the founder approves it; Leo (Claude) writes Next.js code files into a database; Tara (Claude) reads those files and LLM-judges them. The pipeline pushes to GitHub and creates a PR. The entire system runs as a chain of Vercel serverless functions with Supabase as the shared state store.

It is genuinely agentic (dynamic task graph, tool use, loops, approval gates) but constrained to a software development pipeline with a hardcoded four-agent roster.

### 2. What Is Already More General Than It Looks

- **The graph engine** is real. `depends_on` arrays, multi-task plans, arbitrary order — all work. Adding parallelism requires one change to the executor.
- **Maya's routing** is genuinely model-decided. She already skips Leo for documents and can compose arbitrary task sequences within the four-agent roster.
- **The approval gate** is a generic DB pattern (a `human` task type). It can gate on any artifact, not just HTML.
- **The tool factory** (`buildToolsForJugnu`) is a clean abstraction point for a skills registry.
- **The context system** is structured and injects per-project personas — ready for domain-specific agent roles.
- **Nia's system prompt** already describes a generic "alignment artifact" concept with format-per-domain rules.

### 3. What Is Hardcoded / Limiting

1. **Four agents, hardcoded.** The `JugnuKey` TypeScript union and enum in `create_task_plan` prevent adding domain specialists without code changes.
2. **Leo is Next.js.** His system prompt is a Next.js engineer's. Non-code deliverables go through Nia only.
3. **No research tools.** No web search, no external API calls from agents. Research requests produce hallucinated outputs.
4. **Sequential execution only.** One jugnu at a time.
5. **Text-only artifacts.** Binary file types (images, PDFs, PPTX) are not storable.
6. **Short-lived execution.** No task can last longer than ~5 minutes before the watchdog intervenes.
7. **No project memory.** Every project starts from zero workspace context.
8. **No cost tracking.** Token usage is discarded; no budget controls beyond retry/turn limits.
9. **Nia revisions are unbounded.** A founder could request changes from Nia indefinitely.
10. **Prompt injection exposure.** Model-written file contents are fed back to other models without sanitisation.

### 4. Top 10 Technical Risks Before Public Alpha

1. **No cost controls** — a single malicious or confused project could run 10 turns × 4 jugnus × 3 retries = 120 Claude calls with no cap. No billing signal exists.
2. **Nia revision loop unbounded** — founder can keep requesting changes from Nia indefinitely; no exit condition.
3. **Prompt injection via file contents** — Nia writes a file; Leo and Tara read it and pass it to Claude. A jailbreak in a file content could affect subsequent agents.
4. **`advanceProject` not idempotent** — concurrent calls (race condition: watchdog + pipeline overlap) could double-dispatch the same task.
5. **No project memory** — everything must be re-explained every project; product feels stateless to repeat founders.
6. **Generated file trust** — files are pushed to GitHub as-is. No scan for secrets, malicious code, or destructive scripts.
7. **Task permanently stuck after 3 retries** — no founder notification pathway that allows recovery; project silently dies.
8. **Hallucinated research** — any research-type request produces LLM-fabricated data presented authoritatively. No disclaimer, no tool to verify.
9. **No auth on preview route** — `/preview/[projectId]` is likely public; anyone with the project ID can see the design.
10. **No token/cost observability** — impossible to do customer support, pricing, or abuse detection without knowing what projects consume.

### 5. Current Architecture Diagram

```
FOUNDER
  │ POST /api/projects { workspaceId, objective }
  ▼
┌─────────────────────────────────────────────────┐
│ projects/route.ts                               │
│  - INSERT project (status: planning)            │
│  - INSERT founder message                       │
│  - waitUntil(runPipeline(projectId, null, maya))│
└──────────────────┬──────────────────────────────┘
                   │ runPipeline → dispatchJugnu(maya)
                   ▼
┌─────────────────────────────────────────────────┐
│ dispatchJugnu (dispatch.ts)                     │
│  - buildProjectContext → structured brief       │
│  - SELECT last 30 user/jugnu messages           │
│  - buildToolsForJugnu(jugnu)                    │
│  - anthropic.messages.stream (cached context)  │
│  - Streaming loop (max 10 turns):               │
│    · INSERT activity messages (breadcrumbs)     │
│    · INSERT/UPDATE live message row             │
│    · Handle tool calls:                         │
│      - ask_founder → INSERT escalation          │
│      - create_task_plan → INSERT tasks          │
│      - complete_task → UPDATE task status       │
│      - submit_for_review → push to GitHub + PR  │
│      - approve / request_changes (Tara only)   │
└──────────────────┬──────────────────────────────┘
                   │ pipeline.ts: advanceProject()
                   ▼
┌─────────────────────────────────────────────────┐
│ advanceProject (executor.ts)                    │
│  - Check: any task in_progress? → bail          │
│  - getNextReadyTask: pending + deps satisfied   │
│  - If next is 'human': INSERT approval message  │
│    pause pipeline (APPROVAL_REQUIRED event)     │
│  - If next is jugnu:                            │
│    · UPDATE task (status: in_progress)          │
│    · UPDATE jugnus (status: working)            │
│    · INSERT TASK_ASSIGNED event message         │
│  - If no next + all completed:                  │
│    · INSERT PROJECT_COMPLETED message           │
│    · UPDATE project (status: completed)         │
│    · UPDATE jugnus (all: status: idle)          │
└──────────────────┬──────────────────────────────┘
                   │ fire-and-forget HTTP
                   ▼
┌─────────────────────────────────────────────────┐
│ POST /api/internal/jugnu-respond (maxDuration=300)│
│  - Auth: INTERNAL_API_SECRET bearer token       │
│  - runPipeline(projectId, taskId, jugnuKey)     │
│  [loops back to dispatchJugnu above]            │
└──────────────────┬──────────────────────────────┘
                   │ When Leo calls submit_for_review:
                   ▼
┌─────────────────────────────────────────────────┐
│ pushProjectToGitHub (github.ts)                 │
│  - GitHub App auth (GITHUB_APP_ID + PRIVATE_KEY)│
│  - CREATE branch jugnus/{projectId[0:8]}        │
│  - CREATE blobs (parallel), tree, commit        │
│  - CREATE PR → returns prUrl                    │
└─────────────────────────────────────────────────┘

APPROVAL GATE (when human task is in_progress):
  FOUNDER → POST /api/projects/[id]/approve { verdict, feedback }
    · verdict=approved → complete human task → advanceProject → Leo
    · verdict=changes  → INSERT Nia revision task (sort_order: -1)
                       → reset human task to pending → advanceProject → Nia

WATCHDOG (cron every 5 min):
  GET /api/cron/watchdog
    - Find tasks: in_progress + started_at < 4 min ago
    - retry_count < 3: increment, POST to jugnu-respond (nudge)
    - retry_count >= 3: mark failed, notify founder

SUPABASE REALTIME (client):
  messages INSERT     → ProjectChannel (chat feed, thinking state via events)
  messages INSERT     → useProjectEvents (world view state)
  tasks *             → JugnuPanel (task progress, agent status)

file_snapshots:
  · Written by Nia (design mockup) + Leo (code files)
  · Upsert on (project_id, path) — no version history
  · Read by Leo/Tara via read_file tool
  · Served by /preview/[projectId] as HTML
  · Listed in FilesPanel (UI)
  · Pushed to GitHub on submit_for_review (all files)

DB STATE MACHINE (per project):
  planning → building → completed
  tasks: pending → in_progress → completed / failed
```
