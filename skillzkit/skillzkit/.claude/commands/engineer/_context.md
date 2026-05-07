# Engineer — Grouping Context

> The engineer persona's grouping. Read this when working
> anywhere under `engineer/`.
>
> The engineer is the persona who handles software engineering
> + architecture + QA as one role. The principal engineer /
> staff engineer / senior dev who makes architectural decisions,
> writes features, maintains quality, and owns testing.

## What `engineer/` contains

```
engineer/
├── _context.md                  (this file)
├── architecture/                ADRs, diagrams, API design, data modeling, ...
├── maintenance/                 remediation, upgrades, drift cycles
├── testing/                     (future — QA-flavored)
├── development/                 (future)
└── workflows/                   engineer-domain workflows (in progress)
```

## Sub-namespaces

### `architecture/` — system architecture

Architecture Decision Records, system diagrams (C4 model +
sequence + data flow), API contract design, data modeling,
integration pattern selection, structural dependency analysis,
multi-mode review (capability / greenfield / brownfield-feature
/ annual), architectural migration planning.

The architecture namespace covers the layer between "what
should we build" (product / UX / brief) and "implement this"
(code). It's where systemic decisions get made and documented.

### `maintenance/` — quality routines

Drift remediation (biome issues, atomic-design violations,
component duplication, future: storybook drift) and dependency
upgrades (gradle, maven, npm, infra). Cycle workflows
(polyglot-maintenance-cycle) orchestrate routines on a cadence;
calendar workflows (maintenance-calendar-annual) plan the
cadence strategically.

Maintenance is recurring upkeep. Routines run on cadences
defined in `.pencil-maintenance-calendar.json`; the cycle
workflow dispatches routines based on what's due.

### `storybook/` — moved to `frameworks/storybook/`

Storybook is a framework adapter ecosystem (the
`@storybook/<adapter>` pattern adapts Storybook to React,
Vue, Svelte, Angular, etc.). It's persona-orthogonal — both
product and engineer consume it — and framework-coupled, so
it lives in the cross-persona `frameworks/` grouping rather
than under engineer.

The storybook drift remediation routine still lives in this
persona's namespace at `engineer/maintenance/remediation/storybook-drift.md`
(when built). Drift is engineer-flavored maintenance work
scheduled on a cadence; the commands it invokes happen to live
in `frameworks/storybook/`. This is the cross-grouping
invocation pattern.

For ongoing authoring/verification/migration of stories, see
`/core:frameworks:storybook:*` commands.

### `testing/` — QA and test strategy (planned, not yet built)

Test strategy definition, unit test generation, integration
test generation, e2e test generation, coverage analysis,
flakiness detection, fixture management, regression cycles.
Distinct from architecture-level concerns; focused on testing
discipline as a first-class engineering practice.

### `development/` — forward-motion engineering (planned)

Feature implementation planning, refactor planning (forward-
intent), code review checklists, bug investigation,
architectural-migration execution. Smaller scope than
originally framed because maintenance extracts the recurring
quality work.

### `workflows/` — engineer-domain workflows

Multi-phase orchestration playbooks for engineering work:

- `adr-cycle` (planned) — proposal → stakeholder review →
  refinement → acceptance
- `capability-introduction` (planned) — review → ADR drafting →
  diagram update → integration documentation
- `architecture-review-annual` (planned) — annual architecture
  health check
- `polyglot-maintenance-cycle` — multi-ecosystem maintenance
  cycle (8 phases: topology census, capacity check, scan
  dispatch, prioritize, sequential execution, coordinated
  review, post-cycle audit, schedule next)
- `maintenance-calendar-annual` — strategic maintenance planning

When invoked: `/core:workflows:manage start engineer:<workflow-slug>`.

## Engineer's typical workflows

### Recurring maintenance cycle

```
/core:workflows:manage start engineer:polyglot-maintenance-cycle
```

Multi-ecosystem maintenance. Detects ecosystems present in the
project (npm, gradle, maven, infra), runs read-only quality
scans, prioritizes findings, dispatches routines sequentially
with strict-non-interleaving discipline, ends with full audit
gate. 1-3 days per cycle.

### Introducing a new capability

```
/core:workflows:manage start engineer:capability-introduction  (when built)
```

Review the capability's architectural fit → propose ADRs for
material decisions → update diagrams → document integrations.
Ensures new capabilities don't bypass the architectural review
gate.

### Annual architecture review

```
/core:workflows:manage start engineer:architecture-review-annual  (when built)
```

Yearly fitness check: identity vs reality, ADR coverage, ADR
drift, fitness target evaluation, year-over-year trend.

## Cross-persona reads

Engineer commands read from other personas' authored manifests:

- `.pencil-tone.json` (product-authored) — surfaces voice
  conventions when generating code with user-facing strings
  (form labels, error messages, button text)
- `.pencil-brand.json` (product-authored) — surfaces brand
  identity for component documentation
- `.pencil-component-manifest.json` (product-authored) —
  inventory of components Storybook documents
- `.pencil-marketing-calendar.json` (marketer-authored) —
  awareness of marketing windows that affect maintenance
  scheduling (don't run major upgrades the week of a launch)

## Manifest authorship

Engineer-authored manifests:

- `.pencil-architecture.json` — architectural identity (style,
  integration patterns, multi-tenancy strategy, tech stack,
  fitness targets)
- `.pencil-decisions.json` — ADR index
- `.pencil-maintenance-calendar.json` — maintenance cadence,
  per-ecosystem upgrade schedules, compliance-driven scan
  frequency, capacity assumptions
- `.pencil-storybook.json` — Storybook environment, component
  organization, addons, provider stack, screenshot config,
  visual regression preferences

## Anti-patterns

- **Engineer commands making product or design decisions
  unilaterally** — engineers can have opinions, but decisions
  routed through ADRs (proposal → review → acceptance) prevent
  unilateral choices that affect downstream work.
- **Bypassing architecture review for new capabilities** —
  capability-introduction workflow exists for a reason. Skipping
  it produces code without architectural intent documentation.
- **Conflating maintenance and development** — drift cleanup is
  maintenance (recurring, scheduled); feature work is development
  (planned, intentional). Both are engineer work; they have
  distinct namespaces because they have distinct lifecycles.
- **Storybook drift work in `frameworks/storybook/`** — drift
  remediation belongs to `engineer/maintenance/remediation/`
  because it's drift work scheduled on a cadence. Ongoing
  authoring stays in `frameworks/storybook/stories/`.
- **Tests outside the testing namespace (when built)** —
  testing is a discipline. When the testing namespace is built,
  test-related concerns route through it rather than scattering
  across architecture/maintenance/development.
