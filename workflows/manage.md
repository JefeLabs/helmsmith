---
description: Manage long-running multi-step workflows (greenfield setup, feature additions, marketing campaigns, maintenance cycles, etc.) with persistent state across disconnected sessions. Saves where you are so you can resume days later without losing context. Workflows live in their primary domain's workflows/ sub-namespace; this command is the cross-cutting state machine that runs them all.
argument-hint: <subcommand> [args]
allowed-tools: Read, Write, Edit, Bash
---

Manage multi-step workflows. The skillz suite's command surface is
large; workflows are pre-built playbooks for specific situations
(greenfield setup, feature additions, marketing campaigns, maintenance
cycles, etc.) plus state tracking so a user picking up after days off
can resume where they left off.

Workflows live in their primary domain's `workflows/` sub-namespace
(`product/strategy/workflows/`, `market/workflows/`, `engineer/maintenance/workflows/`,
etc.). This command — `/workflows:manage` — is the domain-agnostic
state machine that starts them, tracks progress, and resumes where
you left off.

## Subcommands

| Subcommand                       | What it does                                       |
| -------------------------------- | -------------------------------------------------- |
| `list`                           | Show available workflow types across all domains   |
| `start <domain>:<workflow>`      | Initialize a workflow; print first step            |
| `status`                         | Show what's active + where you are                 |
| `next`                           | Print the next step to run                         |
| `resume`                         | Same as `status` + `next` combined                 |
| `complete <step>`                | Mark a step complete; advance to next              |
| `pause`                          | Mark workflow paused (preserves state, no advance) |
| `abandon`                        | Mark workflow abandoned (preserves history)        |
| `history`                        | Show completed/abandoned workflows                 |
| `inspect <workflow-id>`          | Deep view of a specific workflow run               |

## Workflow naming — qualified names

Workflows are referenced by **qualified name** in the form
`<domain>:<workflow-slug>`:

- `product:greenfield` — start a greenfield setup
- `product:brownfield-add-feature` — add a new feature to a Pencil project
- `market:launch-campaign` — coordinated feature/product launch
- `market:marketing-calendar-annual` — strategic year-arc planning
- `engineer:polyglot-maintenance-cycle` — multi-ecosystem maintenance cycle
- `engineer:maintenance-calendar-annual` — strategic maintenance planning

The qualified name resolves to a playbook file at
`<domain>/workflows/<workflow-slug>.md`. Run `/workflows:manage list`
to see all available workflows discovered across domains.

For backward compatibility, bare workflow names (e.g.
`/workflows:manage start greenfield`) still resolve when there's no
ambiguity. Prefer qualified names in scripts and documentation.

## State file

Workflow state persists at `product/.pencil-workflow-state.json`:

```jsonc
{
  "version": 1,
  "active": {
    "id": "product-greenfield-2026-05-02-100000",
    "workflow": "product:greenfield",
    "startedAt": "2026-05-02T10:00:00Z",
    "lastActivity": "2026-05-02T14:30:00Z",
    "currentPhase": 5,
    "currentStep": "components:buttons",
    "blockedOn": null,
    "metadata": {
      "industry": "B2B ed-tech",
      "brandSlug": "acme",
      "framework": "heroui-v3"
    },
    "phases": [
      {
        "phase": 1,
        "name": "Brand foundation",
        "status": "complete",
        "completedAt": "2026-05-02T10:30:00Z",
        "outputs": ["product/.pencil-brand.json"]
      },
      {
        "phase": 5,
        "name": "Component generation",
        "status": "in-progress",
        "steps": [
          { "step": "surfaces", "status": "complete" },
          { "step": "buttons", "status": "in-progress" },
          { "step": "forms", "status": "pending" }
        ]
      }
    ]
  },
  "history": [
    {
      "id": "feature-onboarding-2026-04-15-090000",
      "workflow": "product:brownfield-add-feature",
      "status": "complete",
      "completedAt": "2026-04-22T16:45:00Z",
      "outputs": [
        "design/briefs/onboarding.md",
        "design/explorations/onboarding.pen",
        "design/pages/onboarding.pen",
        "src/pages/onboarding.tsx"
      ]
    }
  ]
}
```

Only one workflow can be `active` at a time. Switching workflows
requires either `complete`, `pause`, or `abandon` first — explicit,
no surprise context switches.

## Subcommand: `list`

Print available workflows discovered across all domain `workflows/`
sub-namespaces (`product/strategy/workflows/`, `market/workflows/`,
`engineer/maintenance/workflows/`, etc.) and the top-level `workflows/`
namespace itself for any cross-namespace workflows.

```
Available workflows:

product/
  product:greenfield                  Setup new project from zero
  product:brownfield-add-feature      Add new feature to existing project
  product:brownfield-improve-page     Refresh an existing page
  product:brownfield-improve-story    Iterate on a current user story
  design:migrate-to-pencil           Bootstrap existing product into Pencil
  design:migrate-from-figma          Bring Figma design system into Pencil
  product:brand-refresh               System-wide brand update / rebrand
  design:figma-roundtrip             Designer-in-Figma iteration loop

marketing/
  market:launch-campaign           Coordinated feature/product launch
  market:reactivation-campaign     Win back lapsed users
  market:seasonal-campaign         Calendar-tied promotion
  market:marketing-calendar-annual Strategic year-arc planning
  market:marketing-calendar-monthly Tactical 4-6 week schedule

maintenance/                          (when populated)
  engineer:polyglot-maintenance-cycle
  engineer:maintenance-calendar-annual

Run /workflows:manage start <domain>:<workflow-slug> to begin one.
```

## Subcommand: `start <domain>:<workflow>`

1. Verify no active workflow already exists (or prompt to abandon
   first)
2. Resolve qualified name `<domain>:<workflow-slug>` to playbook file
   at `<domain>/workflows/<workflow-slug>.md`. Bare names (e.g.
   `greenfield`) resolve when unambiguous; otherwise prompt for
   the qualified form.
3. Generate workflow ID: `<domain>-<workflow-slug>-<YYYY-MM-DD>-<HHMMSS>`
4. Write initial state to `product/.pencil-workflow-state.json`
   (state stores qualified workflow name)
5. Print Phase 1, Step 1 with the specific commands to run

```
Started workflow: product-greenfield-2026-05-02-100000
Workflow:         product:greenfield (Setup new project from zero)
Estimated time:   4-8 hours interactive

Phase 1 of 10 — Brand foundation
Step:             1.1 — Define brand inputs

Action: Run /product:strategy:scaffold with brand inputs (or skip to Phase 2 if
brand JSON already exists)

  /product:strategy:scaffold "Acme" --primary "#0A84FF" --secondary "#7C3AED"

Or interactively:

  /product:strategy:scaffold

When complete, run: /workflows:manage complete brand-foundation
```

## Subcommand: `status`

Read state, print current position:

```
Active workflow: greenfield-2026-05-02-100000
Started:         2026-05-02 10:00 (4 hours ago)
Last activity:   2026-05-02 14:30 (15 minutes ago)
Workflow:        greenfield

Progress:
  ✓ Phase 1 — Brand foundation                (complete)
  ✓ Phase 2 — Research                        (complete)
  ✓ Phase 3 — Foundation selection            (complete)
  ✓ Phase 4 — Foundation rendering            (complete)
  ⏳ Phase 5 — Component generation            (in progress, 2/12)
  ⏸ Phase 6 — Pattern + template selection
  ⏸ Phase 7 — Pattern generation
  ⏸ Phase 8 — Template generation
  ⏸ Phase 9 — Audit
  ⏸ Phase 10 — First production page

Current step:    5.3 — components:buttons
Last completed:  5.2 — components:surfaces

Run /workflows:manage next for the next step.
```

## Subcommand: `next`

Read state, print the next step's command:

```
Phase 5 of 10 — Component generation
Step:    5.3 — components:buttons

Action: Generate Button + IconButton + ButtonGroup components

  /frameworks:heroui:components:buttons

When complete, run: /workflows:manage complete components:buttons
```

If the workflow has branching (e.g. "Did you want to run research?
Yes / no"), prompt the user:

```
Phase 2 of 10 — Research (optional)

Decision: Do you want to run competitive research before foundations?

  Yes — recommended for brand differentiation. Adds ~1 hour.
        Run: /product:strategy:research "<your-industry>"
        Then: /workflows:manage complete research

  No  — skip to Phase 3 (foundations driven by brief alone)
        Run: /workflows:manage complete research --skip
```

## Subcommand: `resume`

Combination of `status` + `next`. The default invocation when
returning to a project after time away.

## Subcommand: `complete <step>`

1. Mark the step complete in state
2. Validate expected outputs exist (if step declares them)
3. Advance state to next step
4. Print the next step (same as `next` would)

If outputs are missing, warn but don't block — user may have run
the underlying command without producing all outputs:

```
⚠️  Step 5.3 marked complete but expected outputs not found:
    - design/heroui/components/buttons.pen (missing)

    Continue anyway? [y/N]
```

## Subcommand: `pause`

Mark active workflow paused. State preserved. Useful when
context-switching to ad-hoc work that isn't part of the workflow.

```
⏸  Workflow paused: greenfield-2026-05-02-100000
   Last step:  5.3 components:buttons (complete)
   Next step:  5.4 components:forms

   Resume with: /workflows:manage resume
```

While paused, individual `/product:design:*` commands work normally without
advancing workflow state.

## Subcommand: `abandon`

Mark active workflow abandoned. Moved to `history` with
`status: "abandoned"`. State preserved for inspection but no longer
active.

Useful when:
- The workflow's premise changed (e.g. greenfield turned out not to
  be greenfield because the team had existing work)
- User wants to start fresh with a different workflow
- Workflow blocked permanently by external factors

## Subcommand: `history`

```
Completed workflows:

  feature-onboarding-2026-04-15-090000
    Type:        brownfield-add-feature
    Duration:    7 days (active 4 sessions)
    Completed:   2026-04-22
    Outputs:     4 files

  page-pricing-refresh-2026-03-08-140000
    Type:        brownfield-improve-page
    Duration:    1 day
    Completed:   2026-03-09
    Outputs:     6 files

Abandoned workflows:

  greenfield-2026-02-15-090000
    Type:        greenfield
    Abandoned:   2026-02-16 (after 1 day)
    Reason:      User switched to brownfield-add-feature

Run /workflows:manage inspect <workflow-id> for details.
```

## Subcommand: `inspect <workflow-id>`

Deep dive into one workflow run. Shows every phase and step with
timestamps, outputs, decisions made.

## Branching and decisions

Workflows can have decision points. When the workflow markdown
declares a decision, `/workflows:manage next` prompts the user:

```yaml
# In greenfield.md frontmatter or phase metadata:
decisions:
  - id: with-research
    phase: 2
    prompt: "Run competitive research before foundations?"
    options:
      - id: yes
        next: phase-2-research
      - id: no
        next: phase-3-foundations
```

The user's answer is recorded in state under `decisions: { ... }`
so subsequent `resume` calls don't re-prompt.

## Best-effort state tracking from individual commands

When an individual `/product:design:*` command runs (outside the workflow
flow), it MAY check for an active workflow and append to state's
"ad-hoc activity" log. This is opportunistic, not mandatory — the
command continues to work whether or not workflow tracking is on.

```jsonc
{
  "active": {
    // ...
    "adHocActivity": [
      {
        "command": "/audit",
        "ranAt": "2026-05-02T13:15:00Z",
        "exitCode": 0,
        "duringStep": "5.2 components:surfaces"
      }
    ]
  }
}
```

This helps the user understand what they did between formal workflow
steps when reviewing history.

## Reporting

On every subcommand, end with a clear "what's next" hint:

```
✓ Step 5.3 marked complete

Next: 5.4 components:forms
Run: /frameworks:heroui:components:forms
Then: /workflows:manage complete components:forms

Or: /workflows:manage status to see overall progress
```

## Failure modes

### Workflow state file missing or corrupt

If `product/.pencil-workflow-state.json` is malformed:

1. Print the corruption details
2. Offer recovery: rebuild from git history (find the last valid
   state file commit) or start fresh
3. Don't auto-overwrite — preserve the bad file as
   `product/.pencil-workflow-state.json.bad-<timestamp>` so the user
   can inspect

### Workflow file not found

If `product/design/workflows/<workflow>.md` doesn't exist:

```
❌ Workflow 'unknown-workflow' not found.

Available workflows: greenfield, brownfield-add-feature, ...

Run /workflows:manage list for full descriptions.
```

### Active workflow already exists when `start` invoked

```
⚠️  An active workflow already exists:
    greenfield-2026-05-02-100000 (started 4 hours ago, currently at Phase 5)

    Choose:
      [c] Complete the active workflow first (run /workflows:manage status)
      [p] Pause it (preserves state, frees you to start a new one)
      [a] Abandon it (preserves history but unblocks)
```

## What this command does NOT do

- Does not run the underlying Pencil commands automatically. It tells
  you what to run; you run it. This is intentional — workflow steps
  often need user judgment (pick a direction, refine a brief, etc.)
  that an autopilot can't supply.
- Does not enforce workflow order. A user can run any individual
  `/product:design:*` command at any time. Workflow tracking is advisory.
- Does not validate output quality. It checks that expected files
  exist; whether they're "good" is the user's call (or `audit`'s).
- Does not handle branching beyond simple decisions. Complex
  workflow forks (e.g. "if research surfaces N+ competitors with
  pattern X, take this path") are out of scope.
