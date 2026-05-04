---
description: Derive formal user stories from a design brief using persona × goal × outcome combinatorics. Updates the brief's "Derived user stories" section in place — each story becomes the input to /product:design:explore. Resists step-shaped or task-shaped story formulations.
argument-hint: <brief-slug> [--n <stories-per-persona>] [--persona <name>] [--re-derive] [--non-interactive]
allowed-tools: Read, Write, Edit, Bash
---

Read a design brief and derive formal user stories from it. Each
story is a single "As a [persona], I want to [outcome-expressing
action], so that [benefit]" line that becomes the input to
`/product:design:explore`. The command applies the same goal-vs-steps
discipline as `/product:strategy:brief` — stories must express *outcome state*,
not click sequences.

The output updates the brief's "Derived user stories" section in
place. The brief stays the source of truth; stories are derived
artifacts that link back to specific brief outcomes.

## Where this fits

```
brief                 (the what & why)
  ↓
user-stories          (this command — formalizes the stories the brief implied)
  ↓
explore <story>       (structural alternatives for one story at a time)
  ↓
design-page --based-on (high-fidelity directions for the chosen exploration)
  ↓
build-components      (React from the finalized direction)
```

## Pre-flight

1. Read `product/strategy/_context.md`.
2. Read `design/briefs/<brief-slug>.md`. If absent, instruct the user
   to create the brief first via `/product:strategy:brief` and stop.
3. Validate the brief is mature enough to derive stories:
   - Goal section status: must be `complete`
   - Outcomes section status: at least `partial`
   - Personas section status: at least `partial`
   - If any of these are missing or `unclear`, surface what's missing
     and ask whether to proceed anyway (drives lower-quality stories)
     or run `/product:strategy:brief --re-ask <section>` first.
4. Resolve flags:
   - `--n <count>` — stories per persona. Default `2`. Max `5`.
     Most personas yield 1–3 useful stories; more usually means
     epics-disguised-as-stories.
   - `--persona <name>` — restrict derivation to one named persona.
     Default: derive for every persona in the brief.
   - `--re-derive` — wipe the existing "Derived user stories"
     section and regenerate. Default behavior is to **append** new
     stories (preserving any hand-edited entries).
   - `--non-interactive` — skip Socratic Q&A; use best-effort
     derivation. Useful for batch / CI seeding.

## Phase 1 — Parse the brief

Extract:

| Field          | Used for                                          |
| -------------- | ------------------------------------------------- |
| Goal           | The benefit clause of stories ("so that ...")     |
| Why-now        | Optional secondary benefit framing                |
| Personas       | The persona clause ("As a ...")                   |
| Outcomes       | The action clauses ("I want to ...")              |
| Anti-goals     | Negative constraints — what stories must NOT cover |
| Success criteria | Story-level acceptance criteria when relevant    |

Each persona's "role in this goal" + "existing capability" determines
what stories make sense for them. A persona who already has
capability X doesn't need a story for X; the brief should drive the
*delta* between current and post-goal state.

## Phase 2 — Generate candidate stories per persona

For each persona, generate up to `--n` candidate stories by walking
the brief's outcomes:

### The combinatorics

Each story emerges from one (persona × outcome × benefit) triple.
Outcomes from the brief fall into four categories — use them all
when generating, weighted by relevance to the persona:

1. **Persisted-state outcomes** ("a record exists with X fields")
   → "I want to [create / edit / persist] X" stories
2. **User-visible outcomes** ("a new menu item appears")
   → "I want to [discover / access / find] X" stories
3. **Side-effect outcomes** ("a notification is sent")
   → "I want to [know about / be informed of / signal] X" stories
4. **Knowledge outcomes** ("user knows the saved name")
   → "I want to [confirm / verify / remember] X" stories

For each generated triple, write the formal story:

```
As a {persona-name},
I want to {action expressing the outcome},
so that {benefit derived from goal or why-now}.
```

### The shape rules

Every generated story must satisfy:

- **One persona only** per story. Multi-persona stories ("as a
  manager and a recruiter, I want...") split into separate stories.
- **Outcome-expressing action**, not a step. "I want to save my
  search" passes; "I want to click Save" fails (it's a step).
- **Single benefit** per story. If two distinct benefits motivate
  the same action, split into two stories with different "so that"
  clauses.
- **Independent** — can be designed and built without depending on
  another story being designed first. If two stories must ship
  together, consider whether they should merge.
- **Sized** — between an epic (too big) and a task (too small). A
  good rule: a single story's exploration set (`/product:design:explore`)
  should produce 3–6 distinct screens per row, not 1 (too small) or
  15 (too big).

### Common malformations and redirects

When the AI generates a story that violates a shape rule, run an
internal redirect and regenerate:

| Malformation | Redirect |
| ------------ | -------- |
| "I want to click X" | That's a step. Restate as the outcome the click produces. |
| "I want to log in and view dashboard and save preferences" | Multiple actions. Split into separate stories. |
| "I want to use the search feature" | Too vague. What outcome does using search produce? |
| "I want X so that Y, and also Z so that W" | Two stories. Split. |
| "I want a button that saves" | UI-level, not user-level. Restate from the user's perspective. |
| "As a user, I want..." | Persona too generic. Use a persona name from the brief. |

Cap each redirect at 2 attempts. If the third attempt still fails the
shape rules, write the best-effort story with a `[NEEDS REVIEW]` flag
and let the user fix it.

## Phase 3 — Acceptance criteria (optional per story)

For each derived story, optionally append 2–4 acceptance criteria
pulled from the brief's success criteria + the specific outcome it
maps to. These help downstream `/product:design:explore` set acceptance
gates per direction.

```
- [ ] After completing this flow, a SavedSearch record exists with
      owner, query, filters, name, and created_at fields.
- [ ] The user can find their saved search from any page that has
      search capability.
- [ ] Median time-to-return for a saved search is under 3 seconds.
```

The criteria are not the steps — they're the verifiable post-state.
Include only criteria that this specific story is responsible for;
overall product-level metrics (e.g. "30% adoption rate") stay in
the brief.

## Phase 4 — Quality check

Before writing, run a final pass on the generated story set:

1. **Coverage** — does every brief outcome appear in at least one
   story? If an outcome has no corresponding story, surface it as a
   gap; either a persona is missing or the outcome is incompletely
   specified.
2. **Independence** — can each story be ordered independently in a
   roadmap? If story B requires story A as a precondition, that's
   fine (note the dependency); if they must ship together, consider
   merging.
3. **Anti-goal compliance** — does any generated story violate an
   anti-goal? If so, drop the story (or surface for review if the
   anti-goal might need reconsideration).
4. **De-duplication** — within a persona, near-duplicate stories
   collapse into one. "I want to save my search" and "I want to
   persist my search filters" are the same story.
5. **Persona-fit** — does each story fit the persona's role and
   existing capability? A persona who already has capability X
   shouldn't have a story for acquiring X.

## Phase 5 — Write to the brief

Update the brief's "Derived user stories" section in place:

```markdown
## Derived user stories
<!-- status: populated; populated by /product:strategy:user-stories on 2026-05-02 -->

The brief produces the following user stories. Each is the input to
`/product:design:explore` for structural alternatives.

### {{persona-1.name}} ({{persona-1.role}})

- [ ] **{{slug-1a}}** — As a {{persona-1.name}}, I want to {{action-1a}},
      so that {{benefit-1a}}.
      *Maps to outcome*: {{brief-outcome-reference-1a}}
      Acceptance:
      - [ ] {{criterion-1}}
      - [ ] {{criterion-2}}

- [ ] **{{slug-1b}}** — As a {{persona-1.name}}, I want to {{action-1b}},
      so that {{benefit-1b}}.
      *Maps to outcome*: {{brief-outcome-reference-1b}}
      Acceptance:
      - [ ] {{criterion}}

### {{persona-2.name}} ({{persona-2.role}})

- [ ] **{{slug-2a}}** — As a {{persona-2.name}}, ...
```

Each story has a **slug** (kebab-cased noun-phrase identifier) so
downstream commands can reference it: `/product:design:explore <slug>` or
`/product:design:explore @design/briefs/<brief-slug>.md#<slug>`.

The status flags update:
- "Derived user stories" section: `populated`
- Brief's overall status field: leave alone (this command doesn't
  promote draft → review)

## Phase 6 — Idempotency

Re-running on a brief that already has populated stories:

1. Default behavior: **append-only** — generate new stories from any
   brief outcomes that don't yet have story coverage. Existing
   stories (which may be hand-edited) are preserved.
2. `--re-derive` — wipe the section and regenerate fully. Loses any
   hand edits. Useful when the brief has changed substantially.
3. The "Derived user stories" status flag tracks whether the section
   is fresh: if status is `stub`, treat as empty; if `populated`,
   apply append logic; if `re-derive`, wipe.

## Reporting

```
✅ Updated design/briefs/{{brief-slug}}.md
   Stories derived: 5 (across 2 personas)
   - {{persona-1.name}}: 3 stories
   - {{persona-2.name}}: 2 stories

   New stories appended: 5
   Existing stories preserved: 0
   Stories flagged [NEEDS REVIEW]: 0

   Outcome coverage:
   - 4 of 5 brief outcomes covered by at least one story
   - Uncovered: "Side effect: activity log entry on save"
     → Consider adding a story for the persona who consumes the activity log

📝 Suggested next:
   /product:design:explore "<story-text>"      # for any individual story
   /product:design:explore @design/briefs/<brief-slug>.md#<story-slug>
                                       # explore a specific story
```

## What this command does NOT do

- It does not generate the brief itself. Brief authoring is
  `/product:strategy:brief`'s job.
- It does not run exploration, design, or build. Those happen
  downstream.
- It does not auto-prioritize stories or assign them to releases.
  That's product-management work outside this command's scope.
- It does not split a story into sub-tasks. Stories are sized for
  exploration; if a story is too big, it should be re-derived as
  multiple smaller stories from the brief, not decomposed here.
- It does not write outside the brief file. Stories live with the
  brief that spawned them.
