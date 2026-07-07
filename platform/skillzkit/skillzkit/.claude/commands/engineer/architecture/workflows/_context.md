# Architecture Workflows — Domain Context (`engineer/architecture/workflows/`)

> Read this in addition to `workflows/_context.md`,
> `engineer/architecture/_context.md`, and `engineer/architecture/decisions/_context.md`
> when working with architecture workflow playbooks.
>
> This sub-namespace holds workflow playbooks whose primary
> orchestration concern is architecture — managing the ADR
> lifecycle, introducing new capabilities to existing systems,
> and conducting periodic architecture review. Per the
> primary-domain placement rule (see `workflows/_context.md`),
> these workflows live here even when they invoke commands
> from product, pencil, or other namespaces.

## Workflows in this sub-namespace

3 workflows:

- **`engineer:adr-cycle`** — ADR proposal-to-acceptance
  lifecycle workflow. Orchestrates proposal, stakeholder review,
  refinement, and acceptance with explicit checkpoints.
- **`engineer:capability-introduction`** — multi-phase flow
  for adding a new capability to an existing system. Covers
  review → ADR drafting → diagram update → integration
  documentation → migration planning if needed.
- **`engineer:architecture-review-annual`** — strategic
  yearly architecture review. Runs annual-mode review, walks
  through findings with stakeholders, identifies follow-up
  work, schedules quarterly checkpoints.

See `workflows/_index.md` for the unified decision tree across
all domains.

## Conventions specific to architecture workflows

Beyond the universal workflow conventions in
`workflows/_context.md`:

### Stakeholder review checkpoints

Architecture workflows typically include explicit checkpoints
where stakeholders (engineering leads, principal engineers,
architecture council) review work products before progression.
These checkpoints are first-class workflow phases, not
afterthoughts:

- ADR proposed → review → refined (loop) → ready for acceptance
- Capability review report produced → review → ADRs proposed
  → review → ADRs accepted
- Annual review report produced → review → action items agreed
  → quarterly checkpoints scheduled

Workflow state captures whether a checkpoint is pending review,
in review, or completed. The `pause` subcommand of
`/core:workflows:manage` is commonly used during stakeholder review
windows.

### ADR-centric

Most architecture workflows produce or consume ADRs. The
`adr-cycle` workflow is purely ADR-centric;
`capability-introduction` produces 1-N ADRs as output;
`architecture-review-annual` evaluates ADR coverage and surfaces
opportunities.

Workflows respect the ADR immutability rule: once an ADR is
accepted, the workflow doesn't modify it. Workflows that span
multiple ADRs (capability-introduction can produce 4+ ADRs)
process them sequentially with explicit acceptance gates.

### Integration with product workflows

Architecture workflows are invoked from product workflows at
specific moments:

- **`product:greenfield`** invokes
  `/engineer:architecture:review greenfield` early (after brand
  foundation, before system scaffolding); the review produces
  the project's foundational ADR set.
- **`product:brownfield-add-feature`** invokes
  `/engineer:architecture:review brownfield-feature` after brief
  generation; the review checks alignment before exploration
  begins.

These invocations are direct command calls, not nested workflow
starts (workflows don't nest; see `workflows/_context.md`). The
invoking workflow waits for the review report before
progressing.

### Integration with maintenance workflows

The annual architecture review may surface migration work that
maintenance can't handle:

- Maintenance handles version drift (gradle/maven/npm
  upgrades), code drift (atomic-design, biome), and
  configuration drift (infra-deps).
- Architecture migrations (monolith → modular monolith, sync
  → event-driven) are NOT maintenance work; they're plan-
  driven transformations using `/engineer:architecture:migrate`.

`architecture-review-annual` surfaces both:
- Drift items maintenance handles → suggest scheduling in
  `/core:workflows:manage start engineer:polyglot-maintenance-cycle`
- Drift items requiring architectural transformation →
  suggest `/engineer:architecture:migrate` to plan the work

### Diagram updates as workflow phases

Architecture workflows that modify the architecture (capability
introduction, migration phases) include explicit diagram-
update phases. Diagrams that aren't updated drift; the workflow
makes the update mandatory rather than optional.

Diagram update phases are short — typically the last phase of
a capability introduction, or a recurring phase in a multi-
phase migration. Skipping is allowed but warned.

## Anti-patterns

- **Architecture workflows that try to make decisions
  unilaterally** — workflows orchestrate; ADRs decide. A
  workflow that "approves" a decision without team review is
  bypassing the review checkpoints by design.
- **Skipping ADR drafting in capability-introduction** —
  the whole point of the workflow is producing the
  decision-record output. A capability introduction without
  ADRs is a code change without architectural intent
  documentation.
- **Annual review without follow-through** — finishing the
  review with a report and no scheduled actions defeats the
  purpose. The workflow's last phase is "schedule
  follow-ups," not "produce report."
- **Workflows that bypass stakeholder review** — the
  checkpoint phases exist because architectural decisions
  benefit from team input. Solo-architect workflows that
  skip review checkpoints are an anti-pattern; even
  single-person teams benefit from "sleep on it" style
  pauses.
- **Workflows for everything** — not every architectural
  task warrants a workflow. Single-step tasks (one ADR,
  one diagram update) should use the commands directly.
  Workflows are for multi-step orchestration with state
  tracking value.
