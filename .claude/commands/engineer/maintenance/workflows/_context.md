# Maintenance Workflows — Domain Context (`engineer/maintenance/workflows/`)

> Read this in addition to `workflows/_context.md`,
> `engineer/maintenance/_context.md`, and `product/strategy/_context.md` whenever
> working with maintenance workflow playbooks.
>
> This sub-namespace holds workflow playbooks whose primary
> orchestration concern is maintenance — multi-routine cycles
> across the polyglot infrastructure, calendar planning for
> sustained maintenance cadence. Per the primary-domain placement
> rule (see `workflows/_context.md`), these workflows live here
> even when they invoke routines that span multiple ecosystems
> (npm, gradle, maven, infra).

## Workflows in this sub-namespace

2 workflows currently:

- **`engineer:polyglot-maintenance-cycle`** — Tactical
  multi-ecosystem maintenance cycle. Runs read-only quality scans
  first across all detected ecosystems, prioritizes findings,
  dispatches remediation and upgrade routines sequentially with
  strict-non-interleaving discipline, ends with full audit gate.
- **`engineer:maintenance-calendar-annual`** — Strategic
  12-month maintenance planning. Per-ecosystem cadence targets,
  compliance-driven scan frequency, capacity assumptions, risk
  tolerance settings.

See `workflows/_index.md` for the unified decision tree across
all domains.

## Conventions specific to maintenance workflows

Beyond the universal workflow conventions in
`workflows/_context.md`:

### Cadence-driven, not event-driven

Marketing workflows are typically event-driven (a launch happens;
run launch-campaign). Maintenance workflows are typically
**cadence-driven** — they run on a schedule (weekly security
scans; monthly polyglot cycle; quarterly major-version reviews).
The cadence is established by the calendar workflow and stored
in `.pencil-maintenance-calendar.json`.

Event-driven maintenance does exist — a critical CVE triggers an
out-of-band cycle — but it's the exception, not the rule.

### Polyglot orchestration

Edwin's working environment (and most modern projects) span
multiple ecosystems: npm/JS, JVM (Gradle and/or Maven), Terraform,
Docker, GitHub Actions. Maintenance workflows orchestrate routines
across all of them in a single cycle, with strict
non-interleaving between sister upgrade routines (per
`engineer/maintenance/upgrades/_context.md`).

The `polyglot-maintenance-cycle` workflow's state machine is the
enforcement layer for this — it knows which sister routine's
branch is currently open and refuses to start the next until the
current is committed/PR'd.

### Capacity-aware

Like marketing-calendar workflows, maintenance workflows take
honest team capacity as a first-class input. The 70% capacity
ratchet (per `market/workflows/marketing-calendar-annual.md`)
applies: plan for 70% of available time to leave slack for
unplanned work, security incidents, and the occasional rollback.

### Compliance-driven cadence

Some industries mandate scan/upgrade cadences (FERPA, COPPA,
HIPAA, PCI-DSS, SOC 2). The calendar workflow incorporates
compliance requirements as constraints — the cadence isn't
optional when the calendar declares "biweekly security scans
required by compliance."

For Edwin's SkoolScout project specifically: FERPA + COPPA require
heightened security scan cadence (biweekly minimum) and prompt
remediation of critical CVEs (within 30 days).

### Audit gate as natural ending

Every cycle workflow ends with a full audit run (including Plane
11 — maintenance drift) showing what improved. The audit isn't a
separate workflow phase to remember — it's the cycle's natural
gate, the final verification that the cycle achieved its goals.

If the audit surfaces new drift introduced by the cycle (regression
in coverage, new lint findings, etc.), the cycle isn't complete
until those are addressed.

### Out of scope (boundary)

The maintenance cycle workflow's scope is **maintenance routines
only**. Specifically out of scope:

- Documentation updates (separate concern)
- Release notes / tagging (separate concern; release management
  workflows when those exist)
- Infrastructure changes beyond version bumps (Terraform refactors,
  cost optimization)
- Feature work disguised as refactor (development namespace)

If a maintenance cycle surfaces a need for any of these, the
cycle's report flags the finding for follow-up; the cycle itself
doesn't address it.

### Calendar interaction

The maintenance calendar workflow writes
`.pencil-maintenance-calendar.json`. The cycle workflow reads it
for context (last-run timestamps, cadence targets, risk tolerance
settings) but doesn't modify it during a cycle. Cycle outcomes
update `.pencil-maintenance-calendar.json` only via explicit
calendar workflow runs (typically the quarterly review checkpoint).

### Cross-routine isolation enforcement

The cycle workflow's state machine enforces the
strict-non-interleaving rule for sister upgrade routines:

- gradle-deps, maven-deps, npm-deps, infra-deps each run on
  separate branches
- The cycle workflow tracks which sister branches are open
- It refuses to start the next sister routine until the current
  is committed/PR'd

This is the structural reason the cycle workflow exists. Without
it, agents (Janitr/Bumpr/Verifly) running maintenance routines
in parallel would produce un-bisectable PRs.

## Anti-patterns

- **Maintenance workflows that produce code changes directly** —
  delegate to maintenance routines; workflows orchestrate.
- **Cycle workflows that don't end with audit** — the audit is
  the natural gate; skipping it leaves verification gaps.
- **Workflows that interleave sister upgrade routines** — the
  state machine prevents this; if your workflow allows it, the
  workflow design is wrong.
- **Cadence-blind maintenance** — running cycles without consulting
  the maintenance calendar produces uneven cadence and missed
  compliance windows.
- **Capacity-blind planning** — annual calendar without honest
  capacity input produces unsustainable plans.
- **Mixing maintenance with development work** — a feature push
  that "also includes some refactoring" creates blast-radius
  confusion. Run maintenance cycles independently.
