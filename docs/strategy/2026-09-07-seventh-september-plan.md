# The 7th September Plan

**Date:** 2026-09-07  
**Status:** Mostly shipped — 2 items pending (Phase 2c live test + Phase 4 exit criteria)  
**Tag at plan creation:** v0.1.0  
**Shipped tag:** v0.2.0 (2026-09-07) + v0.2.1 (2026-09-08, world view fixes + forensic doc)  
**Target tag on full completion:** v0.2.1 ✅ (tag exists; exit criteria tests still unrun)

### Phase status (2026-09-08)

| Phase | Item | Status |
|---|---|---|
| 1a | Semantic event vocabulary | ✅ Shipped in v0.2.0 |
| 1b+1c | Streaming + prompt caching | ✅ Shipped in v0.2.0 |
| 1d | jugnu_roles + runtime persona injection | ✅ Shipped in v0.2.0 |
| 2a | Human approval task type + Tara correction loop bound | ✅ Shipped in v0.2.0 |
| 2b | Maya ask_founder rewire | ✅ Shipped in v0.2.0 |
| 2c | Pipeline resume after clarification (escalation → re-invoke Maya) | ⚠️ Code shipped; live test not run |
| 3a+3b | View toggle + isometric 2D world renderer | ✅ Shipped in v0.2.1 (letterboxing + layout fixes) |
| 3c | `useProjectEvents` shared hook | ✅ Shipped in v0.2.0 |
| 4 | Exit criteria test 1 — "Build a landing page for my bakery" | 🔲 Not run |
| 4 | Exit criteria test 2 — "Plan a weekend trip to Lonavala" | 🔲 Not run |
| 4 | Typecheck + push to origin | 🔲 Not done |

---

## What this plan delivers

1. A pipeline that is smart enough to route requests — not every request goes through all 4 jugnus
2. Perceived speed close to Lovable for simple requests through streaming (not faster models)
3. A cheap prototype + founder approval gate before expensive Leo execution
4. 4 jugnus that present as domain specialists at runtime (Trip Planner, Campaign Strategist, etc.) without adding new agents
5. Both a chat renderer and a 2D world renderer reading the same event stream, switchable via a toggle
6. A semantic event vocabulary that future UIs can consume without pipeline changes

### Nia and Leo — stable identity, contextual specialisation

**Nia = shape / propose / align.** Nia produces the alignment artifact: a cheap, tangible
representation of the proposed direction that the founder reviews before execution begins.
The format depends on the domain — HTML mockup for software/web, structured document for
business/research/travel, outline for reports, draft content for creative work. Nia is not
"the HTML jugnu." HTML is the first implementation of a broader alignment concept.

**Leo = execute / produce / build.** Leo takes the approved direction and produces a
deliverable that requires genuine construction. For v0.2 Leo's implemented capability is
software-focused (Next.js + Supabase + TypeScript). Future non-software workflows may have
legitimate execution work for Leo — document generation pipelines, API integrations,
data processing. Leo is not hardcoded to software as an identity invariant; it is his
current implemented specialisation.

**When Leo is skipped:** when the deliverable does not require building or executing
anything — a document, plan, research output, or written artifact. In those cases Nia's
alignment artifact IS the deliverable and goes directly to Tara for review.

Do not collapse Nia and Leo. Do not expand Leo into domains he cannot yet handle.

### Human approval — default boundary, not invariant

One approval checkpoint is the default: after Nia's alignment artifact, before Leo executes.
This is the commitment boundary — cheap and reversible before it, expensive after it.

Future high-risk external actions (spending money, publishing content, sending messages,
making bookings) may require additional explicit authorisation. Do not build those now.
Do not architect exactly-one-gate as an invariant.

---

## Competitive position at v0.2.0

| Capability | Jugnus v0.2 | Lovable | Bolt | Devin |
|---|---|---|---|---|
| Output | Next.js + Supabase (multi-file) | React/Vite | React/Vite | Full codebase |
| Output quality | Equivalent to Lovable | ✅ | ✅ | Superior |
| Domain routing | ✅ | ❌ | ❌ | ❌ |
| Visual prototype before build | ✅ (Nia's HTML) | ❌ | ❌ | ❌ |
| Independent reviewer | ✅ (Tara ≠ Leo) | ❌ | ❌ | ❌ |
| Founder sees output before Leo builds | ✅ | ❌ | ❌ | Partial |
| Non-technical positioning | ✅ | Partial | ❌ | ❌ |
| 2D world | ✅ (Phase 3) | ❌ | ❌ | ❌ |
| Proven at scale | ❌ | ✅ | ✅ | ✅ |

---

## Core architectural principle

**One event stream, two renderers.**

The pipeline emits typed events. Both UIs subscribe to the same Supabase Realtime channel. The toggle switches which renderer is active — no pipeline changes ever needed to support new UIs.

```
                    ┌─────────────────┐
                    │  messages table  │
                    │  (event stream)  │
                    └────────┬────────┘
                             │ Realtime
               ┌─────────────┴─────────────┐
               ▼                           ▼
        Chat renderer               2D world renderer
     (already built)               (built in Phase 3)
     reads: content                reads: metadata.event_type
```

---

## The runtime persona model

4 jugnus always. Infinite perceived specialisation.

Maya classifies domain on her first turn and assigns a project-specific persona to each jugnu she uses. These are stored in `projects.constraints.jugnu_roles` and injected into each jugnu's context block.

| Domain | Maya | Nia | Leo | Tara |
|---|---|---|---|---|
| Software / Build | Product Manager | Designer | Engineer | QA |
| Travel | Trip Planner | Itinerary Curator | Logistics Helper | Travel Checker |
| Marketing | Campaign Strategist | Copy & Content | Campaign Builder | Campaign Reviewer |
| Business | Business Planner | Brand Designer | Application Helper | Launch Reviewer |
| Research | Research Lead | *(skip)* | *(skip)* | Fact Checker |
| Events | Event Planner | Invitation Designer | Logistics Helper | Event Checker |
| Career | Career Coach | Resume Writer | Application Helper | Application Reviewer |

Maya also decides **which jugnus to skip** — a poem needs no Nia or Leo, a countdown timer needs no Nia.

---

## Speed targets

| Request type | Current | Target (with streaming) |
|---|---|---|
| Simple (no Nia, direct Leo) | ~45s total, batch reveal | First token ~2s, complete ~20s |
| Medium (Nia prototype + approval + Leo) | N/A (not built) | Prototype in ~15s, Leo completes in ~30s after approval |
| Complex (with clarification) | N/A (not built) | Questions in ~8s, then medium path |

Speed gain is achieved through **streaming + prompt caching + smart routing** — not faster models or single-shot generation.

---

## Phase 1 — Foundation (3–4 days)

Everything else depends on this phase.

### 1a — Semantic event vocabulary

Add `metadata.event_type` to every system and activity message insert across `executor.ts`, `pipeline.ts`, `dispatch.ts`, and `tools.ts`.

**Full event vocabulary:**

```
PROJECT_CREATED
CLARIFICATION_REQUIRED
CLARIFICATION_RESOLVED
PLAN_CREATED
TASK_ASSIGNED
JUGNU_THINKING
JUGNU_STARTED
FILE_WRITTEN
PROTOTYPE_READY
APPROVAL_REQUIRED
PROTOTYPE_APPROVED
PROTOTYPE_REVISED
TASK_COMPLETED
REVIEW_STARTED
REVIEW_PASSED
REVIEW_FAILED
TASK_RETURNED
PROJECT_COMPLETED
```

Example:
```typescript
// executor.ts — task dispatch
metadata: { event_type: 'TASK_ASSIGNED', jugnu_key: next.jugnu_key, task_id: next.id }

// tools.ts — approve handler
metadata: { event_type: 'PROJECT_COMPLETED', review_verdict: 'approved', live_url: liveUrl }

// dispatch.ts — thinking label
metadata: { event_type: 'JUGNU_THINKING', jugnu_key: jugnuKey, turn }
```

### 1b — Streaming

Switch `anthropic.messages.create()` to `anthropic.messages.stream()` in `dispatch.ts`.

- Insert a live message row at the start of each turn
- Pipe token chunks into it via Supabase update as they arrive
- Finalise the row when the stream ends
- User sees the first word within 1–2 seconds instead of waiting for a complete message

This is the single biggest perceived speed improvement. Lovable's "15 seconds" is largely this trick.

### 1c — Prompt caching

Add `cache_control: { type: 'ephemeral' }` to the system prompt and context block passed to `anthropic.messages.stream()`.

Anthropic caches these for 5 minutes. Subsequent jugnu dispatches skip re-processing the full context. ~40% reduction in input processing latency. Two-line change.

### 1d — Maya routing + runtime persona assignment

Expand `create_task_plan` tool schema with two new fields:

```typescript
needs_clarification: { type: 'boolean' }
// true  → ask before planning (uncertainty-based, not complexity-based)
// false → plan immediately
//
// Rule: ask only when the answer would materially change WHAT gets built
// or WHO does it. A vague simple request may need questions. A detailed
// complex spec may need none. Complexity is not the trigger — uncertainty is.

jugnu_roles: {
  type: 'object',
  properties: {
    maya: { type: 'object', properties: { display_role: { type: 'string' }, focus: { type: 'string' } } },
    nia:  { type: 'object', properties: { display_role: { type: 'string' }, focus: { type: 'string' } } },
    leo:  { type: 'object', properties: { display_role: { type: 'string' }, focus: { type: 'string' } } },
    tara: { type: 'object', properties: { display_role: { type: 'string' }, focus: { type: 'string' } } },
  }
}
```

`jugnu_roles` is stored in `projects.constraints.jugnu_roles` (existing JSON column, no migration).

`formatContextBlock` in `context.ts` reads the project's `jugnu_roles` and injects the persona:
```
You are acting as NIA — Itinerary Curator for this project.
Your focus: day-by-day experience design.
```

UI reads `project.constraints.jugnu_roles` and shows "Nia · Itinerary Curator" instead of "Nia · Designer".

---

## Phase 2 — Smart pipeline (3–4 days, parallel with Phase 3)

### 2a — Approval task type (domain-neutral alignment gate)

Add `jugnu_key: 'human'` as a valid task type. `advanceProject` in `executor.ts` skips tasks
where `jugnu_key === 'human'` — they do not dispatch a jugnu. They wait until the founder
resolves them.

The gate is domain-neutral. It pauses on any alignment artifact Nia produces — HTML mockup,
structured document, outline, draft. The mechanism is identical regardless of what Nia wrote.

Maya's plan structure when an alignment artifact is needed:
```
[Nia: create alignment artifact] → [human: approve direction] → [Leo: execute] → [Tara: review]
```
or when Leo is not needed:
```
[Nia: produce deliverable] → [human: approve] → [Tara: verify]
```

UI: when `APPROVAL_REQUIRED` fires, show Nia's artifact in the files panel with an approve
button and a feedback input. On approve: mark human task `completed`, pipeline resumes.
On feedback: insert a Nia revision task before the human task, loop back.

**Correction loop bound:** Tara↔Leo revision cycles are capped at 2. If Tara requests
changes twice and the second Leo revision still fails review, Tara escalates to the founder
rather than requesting a third cycle. Unbounded loops waste tokens and time.

### 2b — Maya rewrite

New system prompt for Maya:
- Ask only when the answer would materially change what gets built or who does it — not based on request length or apparent complexity
- A vague short request may need questions; a detailed long spec may need none
- Hard rule: if you can make a reasonable decision without the answer, make it
- Questions delivered as a single `ask_founder` call with an array, never one at a time
- Clarification answers must be embedded explicitly in task descriptions so they propagate as durable constraints to Nia, Leo, and Tara — do not rely on chat history alone

### 2c — Pipeline resume after clarification

When founder answers Maya's questions: mark the escalation `resolved`, re-invoke Maya via `jugnu-respond` with answers attached to message history. Maya resumes and calls `create_task_plan` with full context.

---

## Phase 3 — Dual renderer (starts day 2 of Phase 1, runs parallel with Phase 2)

### 3a — View toggle

Add a `view: 'chat' | 'world'` state to the workspace layout. Two icon buttons in the top
bar switch views. The chat renderer is always mounted. The 2D renderer is lazy-mounted on
first switch and stays mounted after that — avoids unnecessary render cost while preserving
Realtime subscriptions once activated.

### 3b — 2D world renderer v1

Top-down room. Four fixed desk positions. The existing `JugnuIllustration` components placed at coordinates. No game engine — CSS transforms + Framer Motion.

Desk layout:
```
┌─────────────────────────┐
│  Maya         Nia       │
│  [desk]       [desk]    │
│                         │
│  Leo          Tara      │
│  [desk]       [desk]    │
│                         │
│         [project        │
│          artifact]      │
└─────────────────────────┘
```

Event → animation mapping:

| Event | Animation |
|---|---|
| `TASK_ASSIGNED` jugnu=leo | Leo's desk lights up, artifact slides toward Leo |
| `JUGNU_THINKING` | Thought bubble above active jugnu |
| `FILE_WRITTEN` | Small file icon appears at active desk |
| `PROTOTYPE_READY` | Artifact moves to center, pulses, "waiting for you" indicator |
| `TASK_RETURNED` | Artifact bounces from Tara's desk back to Leo's |
| `PROJECT_COMPLETED` | All jugnus animate, artifact moves to "delivered" zone |

Nameplate above each desk shows the project-specific display role from `jugnu_roles`.

### 3c — Shared event hook

```typescript
function useProjectEvents(projectId: string): ProjectEvent[]
```

Both renderers use this hook. It subscribes to Realtime once and returns typed events. Each renderer decides what to do with them independently.

---

## Phase 4 — Connect and ship (2 days)

- Verify streaming works end-to-end on Vercel (SSE handling, `waitUntil` compatibility)
- Verify persona names appear correctly in both chat and 2D renderers
- Verify approval gate pauses and resumes correctly for a software project
- Verify correction loop bound fires correctly after 2 Tara revision cycles

**v0.2.0 exit criteria — two required test prompts:**

1. `"Build a landing page for my bakery"` — must complete the full software path:
   Maya plans → Nia produces HTML mockup → founder approves → Leo builds Next.js →
   Tara reviews → live PR URL in chat.

2. `"Plan a weekend trip to Lonavala"` — architectural test only, not a travel product:
   - Must NOT automatically produce a website or Next.js app
   - Must recognise this as a non-software objective
   - Must either produce an appropriate artifact with current capabilities (a structured
     document via Nia) OR gracefully surface that travel-specific execution is not yet
     supported
   - Leo must be skipped unless explicitly appropriate
   - Do not add travel-specific infrastructure to make this pass — the test is whether
     the routing logic is domain-neutral, not whether Jugnus is a travel product

Git tag `v0.2.0` after both tests pass.

---

## What is explicitly NOT in this plan

- Adding a 5th or 6th jugnu — persona model makes this unnecessary for v0.2
- A game engine (Phaser, Unity, etc.) — CSS + Framer Motion is sufficient for v1
- Travel, marketing, or business domain infrastructure — general-purpose architecture, narrow MVP
- Deterministic verification for Tara (build runners, test execution, browser checks) — v0.3+
- Budget/cost estimation before job acceptance — preserve the architectural place at the
  commitment boundary; do not build the feature yet
- Multiple approval gates for high-risk actions (publishing, spending, booking) — noted as
  future; do not build or hardcode exactly-one-gate as invariant

---

## Known hardcoding to remove in this plan

| Location | Current hardcoding | Fix in |
|---|---|---|
| `tools.ts:97` | `jugnu_key enum: ['nia','leo','tara']` | Phase 1d — Maya assigns via jugnu_roles |
| `registry.ts` | 4 jugnus only | Stays 4, personas make it feel like more |
| `projects/route.ts:74` | Always dispatches Maya | Stays Maya-first — correct |
| `context.ts:104` | Generic "You are acting as NIA" | Phase 1d — injects display_role + focus |
