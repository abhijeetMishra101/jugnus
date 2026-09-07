# The 8th September Plan

**Date:** 2026-09-08  
**Status:** Approved — in progress  
**Starting point:** v0.2.1  
**Target tag on completion:** v0.3.0

---

## Product principle for today

> Jugnus should feel like hiring an AI team, not operating an AI tool.

The workflow remains:

```
Understand → Align cheaply → Founder commits → Execute → Review → Deliver
```

The four Jugnus are stable identities. Maya decides which ones are actually needed. Do not force every project through all four.

Today is not about adding more output categories just to match competitors. It is about proving the current workflow, making failure/cost behavior safer, and making the World view genuinely distinctive.

---

## Target World view (visual direction)

The World view splits into two equal halves:

**Top — Minecraft/isometric AI workplace**
- Four Jugnus at their stations (Maya, Nia, Leo, Tara)
- Jugnus retain their bee/firefly identity: recognizable face, translucent wings, glow
- Glowing artifact cube in the center moves between stations
- Each jugnu has a role nameplate (e.g. "Nia · Designing")
- Live Activity ticker on the right panel (timestamped, jugnu icon + action text)
- Project Progress bar (e.g. "2 of 4 completed · 50%")

**Bottom — Jugnu Flight (Flappy-Bird-style mini-game)**
- Bee/firefly jugnu character with wings, flying through a Minecraft side-scroller landscape
- Collect glowing fireflies, avoid obstacles (pipes/towers in Minecraft style)
- Score, Today Rank, Weekly Rank displayed bottom-left
- Leaderboard panel on right: Today / This Week / All Time tabs, user photos + scores
- Controls: Space or click to fly; collect fireflies; avoid obstacles
- "View Full Leaderboard" button

When approval is required or project completes, the game is visually interrupted — not silently hidden.

---

## Phase 1 — Close the 7th September Plan

Do this before starting new feature work.

### 1a. Live-test clarification/resume

The code for escalation → founder answer → Maya re-invocation shipped, but the live test was never run.

Create an intentionally ambiguous software request where the answer materially changes the plan.

**Verify:**
- Maya asks only decision-relevant questions
- Questions arrive together rather than as a long interrogation
- Founder response resolves the escalation
- Maya resumes correctly
- Maya creates the plan using the answer
- The answer reaches Nia/Leo/Tara as an explicit constraint
- No duplicate tasks are created during resume
- Event stream correctly emits clarification lifecycle events

**Important fix if needed:**

Clarification answers must not survive only through chat/task-description copying. Persist accepted founder decisions into a canonical project-level structure:

```json
{
  "founder_constraints": {
    "target_user": "...",
    "required_features": [],
    "excluded_features": [],
    "style": "...",
    "other_decisions": []
  }
}
```

Task descriptions may repeat relevant constraints, but `projects.constraints` should be the durable source of truth.

### 1b. Run canonical software test

**Prompt:** `Build a landing page for my bakery.`

**Expected route:**
```
Founder
  ↓
Maya — plan
  ↓
Nia — alignment artifact
  ↓
Founder approval
  ↓
Leo — implementation
  ↓
Tara — review
  ↓
Completed
```

**Verify:**
- Streaming works
- Personas display correctly
- Nia prototype renders
- Approval genuinely pauses execution
- Feedback causes Nia revision rather than Leo execution
- Approval resumes the pipeline
- Leo writes files
- Tara reviews against the original founder objective
- Tara↔Leo loop is bounded
- Project reaches a clean completed state

GitHub PR output is still a known gap. Do not fake it as completed functionality if it is not implemented.

### 1c. Run canonical domain-routing test

**Prompt:** `Plan a weekend trip to Lonavala.`

This is an architecture test, not a request to turn Jugnus into a travel product.

**Expected behavior:**
- Maya recognizes a non-software objective
- Jugnus does NOT default to Next.js or a website
- Maya selects only appropriate Jugnus
- Leo is skipped unless there is genuine execution work he can currently perform
- Current capabilities produce an appropriate structured artifact OR clearly surface a capability limitation
- No travel-specific hardcoding is added merely to pass the test

If this fails, fix the routing abstraction rather than adding a special `if (travel)` path.

### 1d. Close v0.2.1

After the three live paths above:
- Run TypeScript typecheck
- Run production build
- Fix regressions
- Push to origin
- Update the 7th September plan status
- Record actual test results, including failures discovered and fixes made

**Exit criterion:** the 7th September plan is no longer "mostly shipped"; its live validation is complete.

---

## Phase 2 — Alpha hardening

Keep this deliberately small. These are safeguards that matter before strangers can burn tokens on autonomous runs.

### 2a. Usage + cost telemetry

Record per project/task/jugnu:
- model
- input tokens
- cached input tokens (if available)
- output tokens
- number of model calls
- retry count
- approximate model cost
- total project cost

Do not build a sophisticated pricing system today. The immediate goal is observability: know what one successful and one failed project actually cost. Surface a developer/admin view first if that is materially faster than polished user UI.

### 2b. Project execution budget

Add a simple configurable project budget/credit ceiling.

Before another expensive model call:
```
estimated/actual spend < project ceiling?
    yes → continue
    no  → pause safely
```

The project must become resumable rather than simply dying. This is the first defense against the "credits ran out halfway through the job" experience. Do not attempt precise pre-job cost prediction today.

### 2c. Bound every autonomous correction loop

Tara↔Leo is already intended to be capped at 2 revisions. Verify that behavior in production.

Also cap Nia↔Founder prototype revision execution defensively. The founder may deliberately request another revision, but the system should never autonomously spin indefinitely.

Every autonomous loop must have:
- attempt counter
- maximum
- failure/escalation state
- recoverable continuation

### 2d. Idempotency / duplicate-dispatch protection

The clarification resume test may expose this. Ensure retries, webhook/API re-entry, watchdog execution, or double clicks cannot accidentally dispatch the same task twice.

Prefer an explicit task execution/claim mechanism rather than relying only on UI state. Keep implementation minimal for today's scope.

---

## Phase 3 — World View v2

The World view should evolve from "interesting visualization" into a recognizable Jugnus product experience.

The user should understand two things immediately:
1. My AI team is doing real work upstairs.
2. I can play downstairs while they work.

Do not introduce a game engine today unless the current implementation genuinely cannot support the required interactions.

### 3a. Preserve the Minecraft-style AI workplace

Keep the existing isometric/Minecraft visual language. The four Jugnus remain visible around their stations.

**Character treatment:**
All Jugnus in the world should retain their firefly identity, including wings. Do not turn them into ordinary Minecraft humans.

Use:
- Recognizable existing Jugnu face/character identity
- Small translucent/pixel-compatible wings
- Subtle glow
- Role-specific station
- Working/idle/done animation states

Minecraft is the world aesthetic. Jugnus are the characters living inside it.

### 3b. Add the live activity ticker

Add a compact live activity surface near the project progress area. It should continuously show the most relevant recent/current work:

```
Nia   Designing hero section…
Leo   Waiting for approval
Tara  Idle
Maya  Plan completed
```

**Preferred behavior:**
- Newest/current action emphasized
- Previous actions move vertically
- Derive content from semantic events/task state
- No separate orchestration state
- Concise human-readable wording
- Click/tap may eventually jump to the related chat event (optional today)

The ticker should make the World view useful even when the visual animation alone cannot communicate exactly what an agent is doing.

### 3c. Split World into WORK + PLAY

```
┌──────────────────────────────────────────┐
│           JUGNUS AT WORK                 │
│                                          │
│     Minecraft/isometric AI workplace     │
│     Maya · Nia · Leo · Tara              │
│     moving artifact + stations           │
│                                          │
│  Project progress + live action ticker   │
├──────────────────────────────────────────┤
│                                          │
│              PLAY WHILE                  │
│             THEY WORK                    │
│                                          │
│          Flappy Jugnu game               │
│                                          │
│             Score: 18                    │
│          Best today: 42                  │
│                                          │
└──────────────────────────────────────────┘
```

The play area should be at least equal in visual importance to the work area, and may be slightly larger. Once the founder understands the team is working autonomously, their active attention naturally moves to the game.

### 3d. Flappy Jugnu MVP

Create a lightweight Flappy-Bird-style mini-game using a Jugnu character (bee with wings, flying through Minecraft-style landscape, collecting glowing fireflies, avoiding obstacles).

**Requirements:**
- Playable without interfering with pipeline execution
- Space bar + click/tap input
- Current score
- Personal best
- Restart
- Game remains presentation-only
- Project events continue updating while playing
- User can immediately see when approval/action is required

Do not let the game hide an approval gate. When founder input is required, visually elevate that state above gameplay.

### 3e. Leaderboard-ready score model

Today, implement only what is cheap enough to support the direction.

**Schema:**
```sql
game_scores
- id
- user_id
- score
- created_at
- project_id (optional)
```

**Support queries for:**
- Personal best
- Today's global high score
- Weekly global high score

If implementing the full global leaderboard would materially threaten today's core work, persist scores correctly now and defer polished leaderboard UI.

**Future leaderboard experience:**
```
TODAY
1. Priya     84
2. Abhijeet  77
3. Sam       69

THIS WEEK
1. ...
```

Winner profile photos/names should only be publicly displayed with an appropriate user-facing consent/privacy design. Do not silently turn account photos into public leaderboard content.

### 3f. Project completion interrupts play

When meaningful events occur:

**Approval required** — Pause or visually interrupt gameplay:
> Nia needs your approval.

Provide a clear route back to the artifact.

**Project completed** — Celebrate inside the world/game:
> ✨ Your Jugnus finished the project.

Lightweight effects: particles, Jugnus celebration, artifact moves to delivered area, completion banner. Game can continue after acknowledgement. No elaborate sound system required today.

---

## Phase 4 — Keep the World architecture clean

The game must remain another consumer of project/user state, not part of orchestration.

```
                PROJECT ENGINE
                      │
                semantic events
                      │
          ┌───────────┴───────────┐
          │                       │
        Chat                    World
                                  │
                         ┌────────┴────────┐
                         │                 │
                    Work renderer      Mini-game
```

The game must never:
- Determine task execution
- Mutate agent state
- Become required for project completion
- Create a second source of project truth

The AI system must work identically if the user never opens World view.

---

## Phase 5 — Context and review quality groundwork

Only start this after Phases 1–3 are stable. Do not attempt a grand context-engineering rewrite today.

### 5a. Canonical project truth

Consolidate the important project state conceptually into:
- Original objective
- Founder constraints
- Accepted alignment artifact
- Task graph
- Produced artifacts
- Execution evidence
- Review history

Agents should not need to reconstruct truth from the last N chat messages. Today's minimum implementation is durable founder constraints from Phase 1a.

### 5b. Tara reviews the objective

Verify Tara's prompt explicitly asks:

> Does the produced result satisfy the founder's original objective and accepted constraints?

Not merely: Did Leo complete this task?

Tara remains an independent reviewer, not a deterministic verifier. Do not claim verification until Jugnus can execute builds/tests/browser checks and inspect their evidence.

---

## Phase 6 — Instrument the product thesis

Start collecting evidence for the statement:

> Align cheaply before executing expensively.

For every software project, record enough state to later calculate:
- Was Nia shown?
- Did founder approve immediately?
- Did founder request changes?
- How many prototype revisions?
- Did direction change before Leo started?
- Did Tara return implementation?
- Total cost before approval
- Total cost after approval
- Project completion/failure

**The most important early metric:**

% of projects where the founder changes direction at Nia's gate before Leo begins.

If meaningful direction changes happen there, Jugnus has evidence that the alignment gate is saving expensive execution/rework.

---

## Explicitly NOT part of 8th September

- Matching Runable's full output catalog
- Videos, ad campaign execution, social publishing
- Carousel generation, slides infrastructure
- Dozens of integrations
- Adding more Jugnus or dynamic agent creation
- Phaser/Unity/game-engine migration
- Complex avatar customization
- Monetized game rewards
- Public winner photos without consent design
- Sophisticated cost prediction
- Deterministic Tara verification platform
- Complete skills/plugin architecture
- Mobile redesign

---

## Priority order if the day runs short

Cut from the bottom, not the top.

**P0 — Must finish**
- Clarification/resume live test
- Bakery end-to-end test
- Lonavala routing test
- Typecheck/build/push
- Fix architectural failures uncovered by those tests

**P1 — Strongly preferred**
- Cost/token telemetry
- Project execution ceiling / safe pause
- Verify bounded correction loops
- Durable founder constraints
- World live activity ticker

**P2 — Product differentiation**
- World WORK + PLAY layout
- Flappy Jugnu playable MVP
- Wings/firefly treatment in Minecraft world
- Approval/completion interruption behavior
- Persist scores / leaderboard-ready schema

**P3 — If time remains**
- Daily/weekly leaderboard UI
- World completion polish/particles
- Additional context architecture cleanup
- Product-thesis analytics dashboard

---

## Exit criteria

The day is successful if:

**Core pipeline**
- [ ] Clarification/resume path has been live-tested
- [ ] Bakery software path has been live-tested
- [ ] Lonavala does not incorrectly become a website
- [ ] Discovered architectural failures are fixed
- [ ] Typecheck passes
- [ ] Production build passes
- [ ] Changes pushed
- [ ] 7th September plan marked fully tested/closed

**Safety/observability**
- [ ] Token/cost usage is observable per project or task
- [ ] Autonomous loops have explicit bounds
- [ ] Project can stop safely at an execution budget boundary
- [ ] Accepted founder constraints have a durable canonical representation

**World v2**
- [ ] Minecraft AI workplace remains functional
- [ ] Jugnus retain their winged/firefly identity
- [ ] Live action ticker shows current agent work
- [ ] World presents clear WORK + PLAY areas
- [ ] Game area is at least as prominent as work visualization
- [ ] Flappy Jugnu MVP is playable
- [ ] Approval-required state cannot be missed while playing
- [ ] Project completion produces an in-world/game celebration
- [ ] Score persistence is implemented or cleanly prepared

---

## What should exist at the end of the day

Jugnus should no longer merely demonstrate:

> Four AI agents can build something.

It should demonstrate:

> Give an AI team an objective, align on the direction before expensive work begins, watch the team execute autonomously, and stay engaged while they work.

```
                     JUGNUS

          ┌────────────────────────┐
          │     AI TEAM ENGINE     │
          │                        │
          │ Maya → Nia → Leo → Tara│
          │ dynamic routing        │
          │ approval boundary      │
          │ review/correction      │
          └───────────┬────────────┘
                      │
              semantic events
                      │
          ┌───────────┴───────────┐
          │                       │
     PRODUCTIVITY              EXPERIENCE
          │                       │
        Chat                  Minecraft World
        Files                 Live ticker
        Preview               Flappy Jugnu
        Approval              Leaderboards
```

The AI team workflow is the product core.  
The alignment gate is the product hypothesis to prove.  
The Minecraft + game world is the differentiated experience layer.

Do not let the experience layer weaken the reliability of the core.
