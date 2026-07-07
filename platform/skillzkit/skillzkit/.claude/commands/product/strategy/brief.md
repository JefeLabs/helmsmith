---
description: Generate a design brief that captures the intended goal, data needed to start, and data outcomes — without prescribing the steps to get there. Drives a Socratic Q&A when the input is vague. Output is the upstream input to /product:design:explore.
argument-hint: <problem-statement or @path/to/notes.md> [--name <slug>] [--persona <name>] [--non-interactive] [--from-template <template>] [--out <path>]
allowed-tools: Read, Write, Edit, Bash
---

Capture the **what and why** of a design problem before exploring the
**how**. The brief is a state-change document: what's true about the
system / user after success that isn't true today, what must be true
before the user can start, and how we'll measure that the change took
hold. Steps, click sequences, screen counts — none of that lives here.
Those are the output of `/product:design:explore` working from this brief.

Default output: `design/briefs/<slug>.md`.

## Where this fits

```
brief    →    explore    →    design-page    →    build-components    →    audit
 │              │                  │                   │                     │
 what &       structural        single high-       React + tests          drift
 why          alternatives       fidelity                                 detection
              (storyboard)       direction
```

The brief is the source. Every downstream command can refer back to it
to verify that the flow it's producing actually solves the problem the
brief stated. When `/product:design:explore` generates structural alternatives,
each must satisfy the brief's outcomes; when `/audit` flags
drift, it can include "implementation no longer satisfies brief" as a
finding.

## Pre-flight

1. Read `product/strategy/_context.md` only for brand context (`brand`, `tagline`).
2. Resolve the input:
   - First positional arg is free text → use as the seed.
   - Or `@<path>` → read that file.
   - Or no arg → enter pure interactive mode and gather input via
     Phase 1 questions.
3. Resolve the slug:
   - `--name <slug>` if provided.
   - Else derive from the first noun phrase of the input (4–6 words,
     kebab-case).
4. Resolve flags:
   - `--persona` — pre-fill the primary persona name (still asks for
     role and existing capability).
   - `--non-interactive` — skip Q&A loops; produce a draft brief from
     whatever the input contains, and mark gaps as `[NEEDS INPUT]`
     instead of asking. Useful for batch / CI seeding.
   - `--from-template <name>` — start from one of the canonical brief
     templates: `feature` (new capability), `improvement` (refining
     existing), `migration` (replacing existing), `experiment` (A/B
     test or limited rollout). Each pre-fills different default
     sections.
   - `--out <path>` — override the default output path.
5. If `design/briefs/<slug>.md` already exists, default behavior is
   **iterate**: load the existing brief and continue the conversation
   from where it left off (the markdown's frontmatter tracks
   completion status per section). Pass `--replace` to wipe and
   restart.

## Phase 1 — Parse and classify

Read the seed input. Classify it by what it sounds like:

| Seed shape                                        | Classification    | Treatment                          |
| ------------------------------------------------- | ----------------- | ---------------------------------- |
| Problem statement ("users can't find X")          | clear-problem    | Extract goal as the inverse        |
| Feature request ("add Y")                         | clear-feature    | Probe for the underlying problem   |
| OKR / metric ("improve Z by 15%")                 | clear-metric     | Probe for the user behavior change |
| Support / complaint quote                         | clear-pain       | Extract the unmet outcome          |
| Process description ("user does A then B then C") | flow-leak        | **Redirect** (see Phase 2)         |
| Vague aspiration ("make it better")               | vague            | Full Socratic loop                 |

For flow-leak input, surface the redirect immediately:

> 🛑 **The input describes a process, not a goal.** A design brief
> captures the *state that exists after success*, not the sequence
> of actions to get there. Step sequences belong in
> `/product:design:explore`, where multiple alternatives can be generated.
>
> Let me ask differently: when this works, what is true about the
> user's experience or the system's data that wasn't true before?

Then pause for a re-stated input. Don't proceed with a flow-shaped
brief — that pollutes everything downstream.

## Phase 2 — Goal extraction (the central section)

The brief's most important field is one sentence stating the **outcome
state**, not the action. Examples of well-formed goals:

- ✅ "A logged-in user can return to a previously-defined set of search
  criteria with a single tap from anywhere they can search."
- ✅ "Tenant administrators can grant another administrator scoped
  access to a single project without sharing organization-level
  credentials."
- ✅ "Recruiters know within 24 hours of a candidate update which of
  their open roles the candidate now matches."

Examples of common malformed goals (and the redirect):

- ❌ "User clicks Save and the search persists."
  → "That's a step. What's true about the system after that step
  succeeds?"
- ❌ "Add saved searches feature."
  → "What can the user do or know that they can't today?"
- ❌ "Make search better."
  → "Better in what dimension? What does success look like in
  measurable terms?"
- ❌ "Reduce churn by 5%."
  → "That's a metric. What user behavior change drives it? What
  does the user experience differently?"

For each malformed shape, ask the listed redirect question. Loop until
the goal is well-formed. Cap the loop at 3 iterations — if still vague
after 3 redirects, write the best-effort goal with a `[GOAL UNCLEAR]`
flag and let the user fix it manually.

The well-formed goal goes in the brief's first section, as a single
sentence in a blockquote.

## Phase 3 — Inputs (data needed to start)

What must be true *before* the user begins this flow? Brief-time
preconditions, not interface preconditions ("the button is visible" is
not a precondition; "the user has a tenant role" is).

Ask the user, in order, for each subcategory. If they decline a
subcategory, mark it `None`.

### User state

What about the user must already be true?

- Authentication state (logged in? unauthenticated? specific
  role-level?)
- Permissions / role (tenant admin, project member, etc.)
- Profile completeness (has filled X, has verified email, etc.)
- Engagement level (new user, returning, power user)

Probe questions:
- "Who can do this? Anyone with an account? Specific roles?"
- "Does the user need to have done anything else first?"

### System state

What about the system / data must already exist?

- Records that must be present (a tenant exists, a project exists,
  data is indexed)
- Feature flags that must be on
- External integrations that must be connected (OAuth, API keys, etc.)
- Time-of-day / lifecycle constraints (only during business hours,
  only after a release window, etc.)

Probe questions:
- "What records / data must already exist in the system?"
- "Are any feature flags or integrations involved?"

### User-supplied information

What does the user need to bring (or have available in their head /
their hand)?

- Identifiers (email address, phone number, project ID)
- Documents / files (a PDF to upload, a link to share)
- Decisions they've already made (a chosen plan, a declared role)
- Context (knowing what they want vs needing to be guided)

Probe questions:
- "What does the user need to know or have when they arrive?"
- "Are they decided, or exploring?"

### External dependencies

What outside systems must respond?

- Third-party APIs (Stripe, Twilio, OAuth provider)
- Email / SMS delivery
- Background workers / queues

Probe questions:
- "Is anything outside our system involved?"

## Phase 4 — Outcomes (data state after success)

What is true *after* success that wasn't before? This is the symmetric
counterpart to Phase 3. Ask in the same subcategories:

### New / modified persisted state

What records exist in the database that didn't, or what fields changed?

Probe:
- "What new record(s) get created? With what fields?"
- "What existing records get updated? Which fields?"
- "Anything deleted?"

### User-visible state change

What does the user see / have access to that they didn't before?

Probe:
- "What appears in the UI that wasn't there?"
- "What new capability does the user have?"
- "What URL becomes reachable, or what menu item appears?"

### Side effects

What happens elsewhere as a consequence?

Probe:
- "Are notifications sent? To whom?"
- "Does this trigger a workflow / job / webhook?"
- "Are there activity-log entries?"

### What the user knows / believes

What changes in the user's understanding?

Probe:
- "What does the user know after this that they didn't?"
- "What do they trust the system to remember on their behalf?"

## Phase 5 — Anti-goals

What this brief explicitly does NOT include. Critical for
exploration-time scope discipline. Default-elicit at least three:

- A near-neighbor scope expansion that's tempting but not in scope
- A future iteration that this is a foundation for but not yet
- A user need this surfaces but doesn't address

Probe:
- "What's *almost* in scope but isn't? What did you decide not to do?"
- "What might exploration suggest you should add — that you'd say no
  to?"

Anti-goals make later "scope creep" conversations concrete.

## Phase 6 — Success criteria

How will you know this worked? Measurable criteria, not subjective
ones. At least one quantitative target. Distinguish:

- **Adoption metrics** — how many people use it (e.g. `>30% of users
  who run X repeatedly save it within 2 weeks`)
- **Performance metrics** — speed / efficiency (e.g. `median
  time-to-return < 3s`)
- **Quality metrics** — error rates, support load (e.g. `support
  tickets containing 'lost my X' decrease 40% QoQ`)
- **Behavioral metrics** — what the user does differently (e.g. `users
  who save searches return to the product 1.4× more often`)

If the user gives only qualitative criteria ("users will be happier"),
push:
- "How would we measure that? What's a leading indicator we could
  watch in week 1?"

## Phase 7 — Open questions and dependencies

### Open questions

Things the brief deliberately leaves unresolved — exploration will
clarify, or further research is needed. These are the prompts for
`/product:design:explore` to vary on.

Format:
```
- [ ] <question> → exploration variation / research / decision needed
```

Auto-suggest at least three based on the goal:
- Where does the new capability live in the existing UI?
- How is it discovered?
- What happens to it over time (expiry, archive, history)?

### Dependencies

External work this depends on, with status. Pulled into the brief so
review can flag blockers early.

```
- [x] <thing> — DONE
- [ ] <thing> — IN PROGRESS (ETA: <date>; blocking)
- [ ] <thing> — NOT STARTED (blocking / non-blocking)
```

Probe:
- "Does this depend on any other work happening first?"

## Phase 8 — Render the brief

Write `design/briefs/<slug>.md` using this template. Every section
has a status flag in HTML comments so the next iteration can pick up
where this one left off:

````markdown
---
slug: <slug>
title: <title>
status: draft | review | approved
owner: <name or role>
created: <ISO date>
target_release: <release tag or date>
brand: <brand from .pencil-brand.json>
---

# Design Brief: <title>

## Goal
<!-- status: complete | unclear -->

> <one-sentence outcome state>

**Why now**: <2–3 sentences>

## Personas
<!-- status: complete | partial -->

| Persona | Role in this goal | Existing capability |
| ------- | ----------------- | ------------------- |
| <name>  | <relationship>    | <what they can do today> |

## Anti-goals
<!-- status: complete | partial -->

This brief explicitly does NOT include:

- <anti-goal 1>
- <anti-goal 2>
- <anti-goal 3>

## Inputs (data needed to start)
<!-- status: complete | partial -->

### User state
- <preconditions>

### System state
- <preconditions>

### User-supplied information
- <what user brings>

### External dependencies
- <none | list>

## Outcomes (data state after success)
<!-- status: complete | partial -->

### New / modified persisted state
- <records, fields>

### User-visible state change
- <new capabilities, surfaces>

### Side effects
- <notifications, jobs, logs>

### What the user knows
- <belief / understanding changes>

## Success criteria
<!-- status: complete | needs-quantitative -->

- [ ] <measurable criterion 1>
- [ ] <measurable criterion 2>
- [ ] <measurable criterion 3>

## Open questions
<!-- status: in-progress -->

- [ ] <question> → <how it gets resolved>
- [ ] <question> → exploration variation
- [ ] <question> → research needed

## Dependencies

- [x] <dep> — DONE
- [ ] <dep> — IN PROGRESS (ETA: <date>; blocking)

## Derived user stories
<!-- status: stub | populated; populated by /product:strategy:user-stories or hand-edited -->

The brief produces one or more user stories. Each story is the input
to `/product:design:explore`. The brief's goal usually fans out into 1–4 stories
per persona.

- [ ] As a <persona>, I want to <action expressing the goal> so that <benefit>.
- [ ] As a <persona>, I want to <related action> so that <benefit>.

## Linked artifacts

- [ ] Explorations: `design/explorations/<story-slug>.pen`
- [ ] Pages: `design/pages/<page-slug>.pen`
- [ ] Components: `src/components/<...>`
- [ ] Build manifest: `product/.pencil-build-manifest.json`
````

If any section is in `partial`, `unclear`, `stub`, or
`needs-quantitative` state, list those in the final output so the user
knows what's still unresolved.

## Verify

After writing the brief, do a final integrity check:

1. The Goal section is a single sentence describing state, not a
   process description (no "user clicks", "user navigates", "user
   types").
2. Inputs and Outcomes are symmetric in shape — both have user state,
   system state, etc. — even if some categories say "None".
3. Success criteria has at least one quantitative entry.
4. Anti-goals has at least one entry.
5. The brief contains no placeholder lorem text — every section either
   has real content or an explicit `[NEEDS INPUT]` flag.
6. Word count is between 250 and 800. Briefer than 250 means under-
   specified; longer than 800 usually means flow-leak (process
   description sneaking in). Flag both.

If any check fails, surface what's wrong and offer a follow-up
question to fix it.

## Reporting

End with:

```
✅ design/briefs/<slug>.md
   Status:        draft | review | approved
   Goal:          <one-line summary>
   Inputs:        <count> preconditions across 4 categories
   Outcomes:      <count> changes across 4 categories
   Anti-goals:    <count>
   Success criteria: <count> measurable, <count> qualitative
   Open questions:   <count>
   Dependencies:     <count> (<n> blocking, <n> done)

⚠️  Sections still incomplete:
   - <section>: <reason>

📝 Suggested next:
   - Review with stakeholders, mark status: approved
   - Pick a user story from the brief and run /product:design:explore
     "<story-text>"
   - Or run /product:strategy:user-stories <slug> to expand the brief into
     formal user stories (when that command exists)
```

## Idempotency

Re-running with the same slug:

1. Loads the existing markdown.
2. Reads the section status flags from HTML comments.
3. For each `partial | unclear | stub | needs-quantitative` section,
   re-enters that phase's Q&A.
4. Sections marked `complete` are left alone.
5. The user can always force a phase to re-run with
   `--re-ask <section>` (e.g. `--re-ask outcomes`).
6. `--replace` wipes and starts over.

## What this command does NOT do

- It does not prescribe steps, screen counts, or visual treatments.
  Those are the output of exploration, not the input.
- It does not consult the foundation manifests or the design system.
  The brief is design-system-agnostic by design — the same brief
  could yield different exploration results in different visual
  systems.
- It does not auto-generate user stories. A separate
  `/product:strategy:user-stories` command (not yet built) would derive formal
  stories from the brief; for now the brief lists them by hand in the
  "Derived user stories" section, and `/product:design:explore` accepts a
  story line directly.
- It does not write to any manifest. Briefs are versioned source
  material, like a `README.md`. They live in git, not in a build
  cache.

## A note on the relationship between brief and exploration

When `/product:design:explore` runs against a brief-derived user story, the
brief's **outcomes** become the explorations' acceptance criteria.
Every exploration must, in its final screen, demonstrate the user
arriving at the post-condition state described by the brief. Different
explorations can take radically different routes there — that's the
whole point — but they all converge on the same end-state.

When `/audit` runs, an "implementation drift from brief"
finding fires when the built component's behavior no longer satisfies
the brief's outcomes. This requires the brief slug to be tracked in
the build manifest's metadata — a small extension that ties the whole
pipeline together.
