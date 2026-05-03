# Workflows — Top-Level Namespace Context

> Read this in addition to `product/strategy/_context.md` whenever working
> with workflows in any domain.
>
> The `workflows/` namespace at suite root is the **management and
> orchestration layer** for multi-phase playbooks across the suite.
> The actual workflow playbook files live in their primary domain's
> `workflows/` sub-namespace (`product/strategy/workflows/`,
> `market/workflows/`, `engineer/maintenance/workflows/`, etc.). The
> top-level namespace is reserved for:
>
> 1. The `manage` command (state machine that runs workflows)
> 2. The unified `_index.md` decision tree across all domains
> 3. This `_context.md` (workflow conventions all playbooks follow)
> 4. **Cross-namespace workflows** — the rare workflow that
>    genuinely spans multiple domains without a primary owner

## Why workflows live in their primary domain

Earlier suite versions placed all workflows under `product/strategy/workflows/`
because there was no convention for domain-specific workflows.
This produced a misleading shape: marketing workflows lived under
product/ even though they had nothing to do with product/design.

The primary-domain placement rule fixes this:

**A workflow's primary domain is the domain that owns the
orchestration concern, not the domain whose commands it invokes
most.**

Examples:

- **`market:launch-campaign`** invokes pencil and heroui commands
  (landing page generation, React build), and product commands
  (audit, brief). But it is fundamentally **marketing orchestration**
  — coordinating email + ads + social + PR + landing for a launch.
  Lives in `market/workflows/`.

- **`engineer:polyglot-maintenance-cycle`** invokes routines from
  multiple ecosystems (npm, gradle, maven, infra remediation). But
  it is fundamentally **maintenance orchestration** — coordinating
  quality routines on a cadence. Lives in `engineer/maintenance/workflows/`.

- **`product:greenfield`** orchestrates pencil + heroui + marketing
  setup, but its primary concern is **product/design system
  bootstrap**. Lives in `product/strategy/workflows/`.

The orchestration concern is the architectural identity. Invocation
count is incidental.

## When a workflow lives at root `workflows/`

Reserved for workflows that **genuinely** span multiple domains
without a primary one. None exist yet; the namespace is ready for
them when they emerge.

A hypothetical example: a "feature-with-marketing-and-maintenance"
workflow that coordinates a feature implementation, a marketing
campaign tied to its launch, AND a post-launch maintenance setup.
Three domains; no primary. That workflow would live at
`workflows/feature-with-marketing-and-maintenance.md`.

The bar is high: most workflows that "feel cross-domain" actually
have a primary orchestration concern. Walk through the test
honestly before placing a workflow at root.

## Workflow file conventions

Every workflow file (regardless of domain) follows this shape:

### Frontmatter

```yaml
---
type: workflow
description: <One-sentence description of what the workflow accomplishes>
estimatedDuration: <human-readable duration: "4-8 hours interactive", "1-3 weeks asset production">
phases: <integer count of phases>
prerequisites:
  - <each prerequisite as a bullet>
---
```

### Body structure

```markdown
# Workflow — <Human-Readable Title>

> **When to use**: <concrete scenarios>
>
> **When NOT to use**:
> - <when to use a different workflow>
> - <when no workflow is needed>

## Outputs of a complete run

- <each artifact the workflow produces>

## Phase 1 — <Phase Name>

<description of phase intent>

```bash
<specific commands to run>
```

<rationale for this phase / why first>

**Mark complete**: `/workflows:manage complete <step-slug>`

## Phase 2 — <Phase Name>

...

## What this workflow does NOT do

- <explicit out-of-scope items>
```

### Naming conventions

- **File slug**: kebab-case, descriptive, no `-workflow` suffix
  (the directory is the suffix). Good: `launch-campaign.md`,
  `polyglot-maintenance-cycle.md`. Avoid: `launch-campaign-workflow.md`.
- **Qualified name**: `<domain>:<file-slug>` —
  `market:launch-campaign`, `engineer:polyglot-maintenance-cycle`.
- **Workflow ID** (in state file): `<domain>-<file-slug>-<YYYY-MM-DD>-<HHMMSS>`.

## State management

All workflows share a single state file at
`product/.pencil-workflow-state.json` managed by
`/workflows:manage`. The state file holds:

- One `active` workflow at a time (qualified name + run ID + phase
  state)
- `history` of completed and abandoned workflows
- Per-phase metadata for inspection and resumption

See `workflows/manage.md` for the full state file schema and
subcommand reference.

## Composition — workflows invoking other workflows

Workflows can reference other workflows by their qualified name.
Example: `market:launch-campaign` Phase 8 invokes
`/market:pr:press-release` (a command), and Phase 10 references
the runbook produced earlier. It does NOT directly invoke another
workflow — that would create state-machine ambiguity (which workflow
is "active"?).

When a workflow's phase WOULD logically invoke another workflow,
the right pattern is:

1. The current workflow's phase says "If newsworthy, this is also a
   trigger for `market:launch-campaign-pr` workflow. Run that
   separately when ready."
2. The user pauses the current workflow, runs the other one to
   completion, and resumes.

The state machine supports this via `pause` / `resume`. Workflows
don't nest; they sequence.

## Cross-domain references

Workflows freely reference commands from other namespaces
(`market:launch-campaign` invokes `/product:design:templates:landing-page`,
`/frameworks:heroui:build-components`, `/market:email:promotional`, etc.).
This is normal and correct — workflows are by nature cross-cutting.

What workflows should NOT do:
- Inline the logic of commands they invoke (delegate, don't reimplement)
- Assume specific command behavior beyond what the command's spec
  promises (read the command's `_context.md` if uncertain)
- Hold state that belongs in commands' own outputs (workflow state
  is workflow-progress; command state is in design/ artifacts)

## Index — discovery across domains

`workflows/_index.md` is the unified decision tree across all
domains. When new workflows are added, they should be added to the
index in their domain section.

The `list` subcommand of `/workflows:manage` discovers workflows
dynamically by scanning `<domain>/workflows/*.md` files plus
top-level `workflows/*.md` (excluding `_*.md` and `manage.md`),
so the index isn't load-bearing for runtime discovery — but it IS
load-bearing for human navigation.

## Anti-patterns

- **Workflow files at root of a namespace** instead of in its
  `workflows/` sub-namespace — confuses commands (one-shot operations)
  with workflows (multi-phase playbooks). Always under
  `<domain>/workflows/`.
- **Workflows that try to be commands** — multi-phase playbooks
  with state. If your "workflow" is actually one phase with no
  state tracking, it's a command. Put it at the namespace root,
  not in `workflows/`.
- **Workflows whose orchestration concern is genuinely a single
  domain but invoke many other domains' commands, placed at root
  `workflows/`** — this is the case the primary-domain rule
  prevents. Place by orchestration concern, not invocation count.
- **Inlining command logic** — workflows delegate to commands; if
  a phase reimplements a command's logic, you've created drift
  risk. Always invoke the command.
- **Bare workflow names in scripts** — use qualified names
  (`market:launch-campaign`) for clarity, especially when
  scripts may run in contexts where bare-name disambiguation
  isn't guaranteed.
