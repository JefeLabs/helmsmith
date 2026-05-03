# Workflows — Unified Index

Pre-built playbooks across product setup, marketing campaigns,
and (forthcoming) maintenance cycles. Each is a multi-phase
sequence that takes you end-to-end with state tracking. Use
`/workflows:manage start <domain>:<workflow>` to begin one with
state persistence, or read the playbook directly and run commands
manually.

Workflows live in their primary domain's `workflows/`
sub-namespace. This index is the unified decision tree spanning
all domains.

## Decision tree — which workflow do I want?

```
Are you setting up a new design system from zero?
└── Yes → product:greenfield

Do you have existing work to migrate?
├── Existing shipped product UI (no Pencil yet) → design:migrate-to-pencil
├── Existing Figma design system (no shipped code) → design:migrate-from-figma
└── No migration needed ↓

Product / design work:
├── Add a new feature / page                     → product:brownfield-add-feature
├── Refresh an existing page                     → product:brownfield-improve-page
├── Iterate on a story you started               → product:brownfield-improve-story
├── System-wide brand update / rebrand           → product:brand-refresh
└── Designer wants to review/iterate in Figma    → design:figma-roundtrip

Marketing / campaign work:
├── Coordinated feature/product launch           → market:launch-campaign
├── Win back lapsed users                        → market:reactivation-campaign
├── Calendar-tied promotion (Black Friday, etc.) → market:seasonal-campaign
├── Plan the year's marketing arc                → market:marketing-calendar-annual
└── Plan the next 4-6 weeks of marketing         → market:marketing-calendar-monthly

Maintenance work (forthcoming):
├── Multi-ecosystem maintenance cycle            → engineer:polyglot-maintenance-cycle
└── Plan annual maintenance cadence              → engineer:maintenance-calendar-annual
```

## Product / design workflows

### product:greenfield

Starting a new project from zero. No existing UI, no committed
brand. Sets up the entire design system end to end.

**Duration**: 4–8 hours interactive (most parallelizable)
**Phases**: 10
**Outputs**: full `design/` directory + foundation React components

When to use: new product, no existing constraints from prior code.
When NOT to use: any existing UI you don't want to lose — use
`design:migrate-to-pencil` instead.

### product:brownfield-add-feature

Adding a new feature, page, or capability to a project that already
has Pencil set up. Brand is settled; foundations are stable;
components exist.

**Duration**: 2–6 hours per feature
**Phases**: 7
**Outputs**: brief, stories, exploration, page design, React

When to use: shipping a new feature in a Pencil-managed project.

### product:brownfield-improve-page

Refreshing an existing page — visual polish, content updates,
layout improvement. The brand stays the same; the page evolves.

**Duration**: 1–4 hours per page
**Phases**: 6
**Outputs**: refined page design, regenerated React, visual diff

When to use: incremental page improvement.
When NOT to use: brand-level changes (use `product:brand-refresh`).

### product:brownfield-improve-story

Iterating on a user story already in flight. The brief exists, the
design is partway done, and feedback came in that requires going
back upstream.

**Duration**: 1–3 hours per iteration
**Phases**: 6
**Outputs**: refined brief, updated stories, refined exploration,
refined page design

When to use: stakeholder feedback on a work-in-progress story
requires re-deriving downstream artifacts.

### design:migrate-to-pencil

Bringing an existing product into Pencil. The current site is the
baseline; Pencil-managed state should reflect it without breaking
production.

**Duration**: 1–2 days for the migration; ongoing for evolution
**Phases**: 5
**Outputs**: brand JSON, foundation `.pen` files locked to existing,
archetype map for existing pages

When to use: existing product going into Pencil for the first time.

### product:brand-refresh

System-wide brand update. New colors, new fonts, new imagery
direction. Cascades across foundations, components, patterns,
templates, and pages.

**Duration**: 3–7 days; high stakes (regression risk)
**Phases**: 8
**Outputs**: new brand JSON + `@theme`, refreshed foundation `.pen`s,
rebuilt components, regenerated patterns + templates, visual diff
report for every affected artifact

When to use: rebrand, brand evolution, or design-system-wide
modernization.
When NOT to use: small visual tweaks (use
`product:brownfield-improve-page`).

### design:figma-roundtrip

Designer-in-Figma iteration loop. Source of truth stays in Pencil;
designer reviews and iterates in Figma. Tracks "out for review"
state so async reviews spanning days don't lose context.

**Duration**: 1–5 days per cycle (mostly async wait for designer)
**Phases**: 6
**Outputs**: exported `.fig` for review, returned `.fig` from
designer, updated `.pen` with merged changes, roundtrip log

When to use: designer and developer are different people, designer
prefers Figma for visual review.
When NOT to use: designer is the same person as developer (run
brownfield workflows directly), or moving source of truth TO
Figma (one-time export, not this workflow).

### design:migrate-from-figma

Bring an existing Figma design system into Pencil. For teams that
designed-first-in-Figma and now want code-level design-system
tooling. Different from `design:migrate-to-pencil` — this assumes
Figma sources but no shipped product code yet.

**Duration**: 1 day for migration; ongoing for evolution
**Phases**: 5
**Outputs**: converted foundations / components / templates as
`.pen`, brand JSON extracted, canonical Pencil structure
established, original Figma files preserved as reference

When to use: existing Figma design system, no shipped code yet.
When NOT to use: existing product UI exists (use
`design:migrate-to-pencil`), or no design system at all (use
`product:greenfield`).

## Marketing / campaign workflows

### market:launch-campaign

Coordinated feature or product launch across email, ads, social
organic, PR, and landing pages. The cross-channel orchestrator
that turns "we shipped X" into a multi-channel announcement.

**Duration**: 1-3 weeks (asset production); 1-2 days execution
**Phases**: 11
**Outputs**: campaign brief, landing page, SEO updates, email
sequence, ad campaigns, press release (when newsworthy), social
organic campaign, launch-day runbook, post-launch retro

When to use: a launch warrants coordinated marketing across
multiple channels.
When NOT to use: routine feature shipping (no marketing); use
`market:reactivation-campaign` or `market:seasonal-campaign`
for those patterns.

### market:reactivation-campaign

Winning back lapsed users via email reactivation sequences +
retargeting ads + landing pages calibrated to the lapsed
audience.

**Duration**: 1-2 weeks production; ongoing execution
**Phases**: 9
**Outputs**: audience-segment definition, campaign brief,
reactivation email sequence, sequential retargeting creative,
optional landing page, suppression list, post-campaign retro

When to use: meaningful lapsed-user segment to win back; team
has capacity to onboard returning users.
When NOT to use: new feature launch (use
`market:launch-campaign`); seasonal moment (use
`market:seasonal-campaign`).

### market:seasonal-campaign

Calendar-tied campaigns (Black Friday, year-end, back-to-school,
fiscal moments). Time-boxed with strict start/peak/end windows.
Includes sunset discipline.

**Duration**: 3-8 weeks production; time-boxed execution
**Phases**: 10
**Outputs**: campaign brief, seasonal landing, seasonal email
sequence, promotional ad creative, social organic seasonal,
optional press (data-led), runbook, sunset checklist, post-season
retro

When to use: calendar-tied moment the brand authentically
participates in.
When NOT to use: feature launch (use `market:launch-campaign`);
reactivation (use `market:reactivation-campaign`).

### market:marketing-calendar-annual

Strategic 12-month marketing arc. Establishes themes per quarter,
identifies date-driven moments, slots in major launches, sets
channel cadence targets calibrated to honest team capacity.

**Duration**: 4-8 hours interactive (single working session)
**Phases**: 8
**Outputs**: `product/.pencil-marketing-calendar.json`,
human-readable strategy doc, quarterly checkpoint schedule

When to use: planning a 12-month marketing arc (typically at
fiscal year start or when team capacity / strategy has shifted
materially).
When NOT to use: tactical 4-6 week scheduling (use
`market:marketing-calendar-monthly`); single campaign (use a
campaign workflow).

### market:marketing-calendar-monthly

Tactical 4-6 week marketing schedule fed by the annual calendar.
Specifies actual posts, emails, ads to produce on which dates.
Surfaces gaps and overload before the period begins.

**Duration**: 1-3 hours interactive
**Phases**: 7
**Outputs**: updated `monthlyCalendar` section in
`.pencil-marketing-calendar.json`, daily-reference schedule
document, week-1 stub assets, coordination check report

When to use: every 4-6 weeks during the annual calendar's active
period.
When NOT to use: annual planning (use
`market:marketing-calendar-annual`).

## Maintenance workflows

### engineer:polyglot-maintenance-cycle

Tactical multi-ecosystem maintenance cycle. Runs the read-only
quality scans first across all detected ecosystems
(npm/gradle/maven/infra), prioritizes findings, dispatches
remediation and upgrade routines sequentially with
strict-non-interleaving discipline, ends with full audit gate.

**Duration**: 1-3 days per cycle (varies with ecosystem count)
**Phases**: 8
**Outputs**: ecosystem inventory, prioritized routine queue,
per-routine PRs ready for review, post-cycle audit report,
next-cycle scheduling

When to use: regular maintenance cadence per the maintenance
calendar; or in response to security advisory triggering an
unscheduled cycle.
When NOT to use: single-ecosystem maintenance (run the routine
directly); strategic planning (use
`engineer:maintenance-calendar-annual`).

### engineer:maintenance-calendar-annual

Strategic 12-month maintenance planning. Per-ecosystem cadence
targets, compliance-driven scan frequency, capacity assumptions,
risk tolerance settings.

**Duration**: 2-4 hours interactive
**Phases**: 7
**Outputs**: `product/.pencil-maintenance-calendar.json`, human-
readable strategy doc, quarterly checkpoint schedule

When to use: planning maintenance cadence at fiscal year start or
when compliance requirements / team capacity shifts.
When NOT to use: tactical execution (use
`engineer:polyglot-maintenance-cycle`); mid-year minor
adjustments (edit `.pencil-maintenance-calendar.json` directly).

## Cross-cutting practices

### State checkpoints

Every workflow records state after each phase in
`product/.pencil-workflow-state.json`. Use `/workflows:manage status`
to see where you are; `/workflows:manage resume` to pick up where
you left off after a break.

### Resumable from any phase

Workflows are designed to be paused and resumed. Each phase has
explicit prerequisites (what must be true before this phase runs)
and outputs (what must exist after). If a workflow is paused for
days, the prereq check ensures phase N still applies when you come
back.

### Decision points

Some phases include explicit decisions — "Run research?",
"Match conventions or differentiate?", "Use these components or
inline?". Decisions are recorded in state so you don't re-prompt
on resume.

### Audit gates

Most workflows include an audit checkpoint between major phases.
Audit findings of severity ≥ fail block forward progress until
addressed. Severity warn surfaces but doesn't block.

### Constrained-mode compatibility

All workflows function in constrained mode (corporate proxy,
restricted LLM provider). The CLI path is the default; MCP-driven
hot-reload is optional. See `product/design/constrained-mode.md`.

### Figma interoperability (when open-pencil is installed)

Most product/design workflows gain Figma-aware capabilities when
**open-pencil** is on PATH (`brew install open-pencil` or
`npm install -g @open-pencil/cli`):

- **Designer review checkpoints** — `product:greenfield` Phase 10,
  `product:brownfield-add-feature` Phase 7, and
  `product:brand-refresh` Phase 6 include optional `.fig` export
  for designer sign-off
- **Higher-fidelity capture** — `product:brownfield-improve-page`
  Phase 2 and `design:migrate-to-pencil` Phase 1 prefer
  `.fig`-based extraction over screenshot-based when Figma sources
  are available
- **Designer-edit imports** — `product:brownfield-improve-story`
  Phase 2 handles "designer iterated in Figma" as a first-class
  upstream feedback path
- **Pre-refresh archival** — `product:brand-refresh` Phase 1
  archives `.fig` snapshots alongside `.pen` snapshots
- **Design-layer linting** — every audit invocation runs
  `open-pencil lint` on `.pen` files when available, surfacing
  contrast / naming / accessibility issues at the design layer

Two product/design workflows are explicitly Figma-driven:
- `design:figma-roundtrip` — async designer iteration cycle
- `design:migrate-from-figma` — bringing Figma design systems into
  Pencil

If open-pencil is not installed, the suite degrades gracefully —
non-Figma capture paths remain, design-layer linting is skipped,
and the `.fig` export points to install instructions.
