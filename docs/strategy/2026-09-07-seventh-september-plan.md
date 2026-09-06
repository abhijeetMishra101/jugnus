# The 7th September Plan

**Date:** 2026-09-07  
**Status:** Approved — not yet started  
**Tag at plan creation:** v0.1.0  
**Target tag on completion:** v0.2.0

---

## What this plan delivers

1. A pipeline that is smart enough to route requests — not every request goes through all 4 jugnus
2. Perceived speed close to Lovable for simple requests through streaming (not faster models)
3. A cheap prototype + founder approval gate before expensive Leo execution
4. 4 jugnus that present as domain specialists at runtime (Trip Planner, Campaign Strategist, etc.) without adding new agents
5. Both a chat renderer and a 2D world renderer reading the same event stream, switchable via a toggle
6. A semantic event vocabulary that future UIs can consume without pipeline changes

### Nia vs Leo — the critical output distinction

**Nia** produces a self-contained HTML file (inline CSS, no external deps) as a cheap visual
prototype. This is shown to the founder for approval before Leo starts. It is a reference
spec, not the deliverable.

**Leo** produces the real product: Next.js App Router + Supabase + Tailwind CSS + TypeScript,
multi-file, pushed to GitHub via Trees API, deployed to Vercel. Output quality is equivalent
to Lovable and Bolt.

These are different things. Do not collapse them. The prototype and the product serve
different purposes at different costs.

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

### 1d — Maya domain classifier + runtime persona assignment

Expand `create_task_plan` tool schema with two new fields:

```typescript
complexity: { type: 'string', enum: ['simple', 'medium', 'complex'] }
// simple  → skip Nia, straight to Leo (or Maya handles alone)
// medium  → Nia prototype + approval gate + Leo
// complex → Maya asks 1-3 questions first, then medium path

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

### 2a — Approval task type

Add `jugnu_key: 'human'` as a valid task type. `advanceProject` in `executor.ts` skips tasks where `jugnu_key === 'human'` — they do not dispatch a jugnu. They wait until the founder resolves them.

When `complexity === 'medium'` or `'complex'`, Maya's plan includes an approval task between the Nia prototype task and the Leo build task:

```
[Nia: create prototype] → [human: approve prototype] → [Leo: full build] → [Tara: review]
```

UI: when `APPROVAL_REQUIRED` event fires, show the prototype in the files panel with an approve button and a feedback input. On approve: mark the human task `completed`, `advanceProject` naturally picks up Leo. On feedback: insert a Nia revision task, loop back.

### 2b — Maya rewrite

New system prompt for Maya:
- Permits 1–3 questions for `complex` classification only
- Hard rule: only ask if the answer changes the plan structure (not output quality)
- `ask_founder` now sets the current Maya task to `awaiting_input` — executor will not advance until resolved
- Questions delivered as a single `ask_founder` call with an array, never one at a time

### 2c — Pipeline resume after clarification

When founder answers Maya's questions: mark the escalation `resolved`, re-invoke Maya via `jugnu-respond` with answers attached to message history. Maya resumes and calls `create_task_plan` with full context.

---

## Phase 3 — Dual renderer (starts day 2 of Phase 1, runs parallel with Phase 2)

### 3a — View toggle

Add a `view: 'chat' | 'world'` state to the workspace layout. Two icon buttons in the top bar switch views. Both renderers are always mounted but only one is visible — preserves Realtime subscriptions across switches.

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
- Run real projects through simple / medium / complex routing
- Verify persona names appear correctly in both chat and 2D renderers
- Verify approval gate pauses and resumes correctly
- Git tag `v0.2.0`

---

## What is explicitly NOT in this plan

- Adding a 5th or 6th jugnu (the persona model makes this unnecessary for v0.2)
- A game engine (Phaser, Unity, etc.) — CSS + Framer Motion is sufficient for v1
- Pro tier / Next.js output — Leo stays on self-contained HTML for now
- Dynamic team assembly beyond Maya's skip logic — deferred to v0.3

---

## Known hardcoding to remove in this plan

| Location | Current hardcoding | Fix in |
|---|---|---|
| `tools.ts:97` | `jugnu_key enum: ['nia','leo','tara']` | Phase 1d — Maya assigns via jugnu_roles |
| `registry.ts` | 4 jugnus only | Stays 4, personas make it feel like more |
| `projects/route.ts:74` | Always dispatches Maya | Stays Maya-first — correct |
| `context.ts:104` | Generic "You are acting as NIA" | Phase 1d — injects display_role + focus |
