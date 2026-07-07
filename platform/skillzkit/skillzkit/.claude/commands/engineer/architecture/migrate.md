---
description: Plan an architectural migration — transforming an existing system from one structural pattern to another (monolith to microservices, sync to event-driven, single-tenant to multi-tenant, etc.). Distinct from `migrate-to-pencil` (design tool migration) and from `review --capability` (forward-only new capability). Migrations are transformation work with current-state, target-state, phases, and rollback.
argument-hint: <migration-name> [--type structural|integration|tenancy|stack|deployment]
allowed-tools: Read, Write, Edit, Bash
---

Plan an architectural migration. A migration is **transformation
of existing structure** — moving from a current architectural
shape to a different target shape. Examples:

- **Structural**: monolith → modular monolith, monolith →
  microservices, microservices → modular monolith
  (consolidation), splitting a service, merging services
- **Integration**: sync request-response → event-driven, polling
  → push, batch → stream
- **Tenancy**: single-tenant → multi-tenant, schema-per-tenant →
  row-level (or vice versa)
- **Stack**: framework migration (e.g., Express → Fastify,
  Spring Boot 2 → 3, Java EE → Jakarta EE), language migration,
  database migration
- **Deployment**: VMs → containers → Kubernetes, on-prem →
  cloud, single-region → multi-region

Migrations are distinct from:

- **`/engineer:architecture:review --capability`** — that's adding new
  things; migration is changing existing things
- **`/product:design:workflows:migrate-to-pencil`** and
  **`/product:design:workflows:migrate-from-figma`** — those
  migrate design tooling, not architecture
- **`/engineer:architecture:data-model migrate`** — that handles schema
  migrations within an established architecture; this command
  handles broader architectural transformations that may
  include schema changes among other changes

Migrations have specific structural needs that distinguish them
from forward-only work: explicit current-state assessment,
target-state design, phased transition plan, parallel-run
strategy, rollback plan, and success criteria. The command
captures all of these.

## Phase 0: discovery

1. Read `product/.pencil-architecture.json` — the current
   architectural identity (the "from" state)
2. Read `product/.pencil-decisions.json` — accepted ADRs that
   constrain or motivate the migration
3. Read existing diagrams and integration docs — they describe
   the current state
4. Read recent dependency analysis if available

If the current state isn't well documented, surface:

> Migration planning requires a clear current-state. The
> architectural identity manifest is sparse / stale / missing
> sections relevant to this migration.
>
> Recommend running first:
>   - /engineer:architecture:diagrams container --update
>   - /engineer:architecture:dependency services
>   - /engineer:architecture:review annual (lighter alternative)
>
> Migration without clear current-state often produces
> incomplete plans. Continue anyway? [y/N]

## Phase 1: migration definition

Capture:

- **Name** — short kebab-case slug used in file paths and IDs
- **Type** (`--type` flag or prompt): structural / integration /
  tenancy / stack / deployment / hybrid
- **Motivation** — why this migration? (3-5 sentences)
  - Performance issue?
  - Compliance requirement?
  - Scale ceiling reached?
  - Operational pain (deployment, debugging, ownership)?
  - Strategic shift?
- **Initiator** — who's driving this? (engineering, product,
  compliance, leadership)

Surface ADRs that motivate or constrain the migration:

> Existing ADRs relevant to this migration:
>
> ADR-005 (accepted): Spring Boot 3.x with Jakarta EE migration
>   → Applies; this migration may complete or extend it
> ADR-009 (accepted): Sync request-response as default
>   → Tension: this migration moves toward event-driven
>
> Document the relationship to existing ADRs in the migration
> plan? Tensions surface as ADR opportunities (potential
> superseding or refinement).

## Phase 2: current state assessment

The "from" state. Capture in detail:

### What exists today

- Services / containers involved
- Data ownership (which service owns which data)
- Integration patterns currently in use
- Deployment model
- Operational characteristics (deployment frequency, observed
  latency, observed failure modes)

### What works today

Even imperfect systems have load-bearing properties. List what
works:

- Specific behaviors that must be preserved
- Performance characteristics that must be maintained
- Compliance properties that must not regress

### What's broken today

Why we're migrating. Specifics, not generalities:

- "Deploys take 22 minutes; team avoids deploying after 4pm"
- "Debugging cross-tenant issues requires DBA support"
- "Adding a new feature touches 4 services; coordination
  overhead is high"

### What's at risk during migration

What could break:

- Data integrity (during transition window)
- Compliance (if migration steps temporarily violate
  constraints)
- Performance (parallel-running both states may degrade)
- Deployment process (if migration affects CI/CD)

## Phase 3: target state design

The "to" state. Mirror Phase 2 structure:

### What will exist

Services, containers, data ownership, integration patterns,
deployment model.

### What will be preserved

Properties from "what works today" that must survive the
migration.

### What changes

The deltas — explicit list of differences between current and
target.

### What's enabled

What becomes possible after migration that isn't possible now.

The target state design isn't aspirational — it's specific
enough that someone reading it could verify "did we get there?"

## Phase 4: transition strategy

The hard part. Migrations rarely happen in one step;
the strategy chooses among:

### Strangler fig

New functionality is built in the target shape; old
functionality continues in the source shape. Over time, old
functionality is reimplemented in the target shape and the
source is "strangled."

Best for: structural migrations (monolith → microservices),
some integration migrations.

Trade-offs: long migration window (months-years); risk of
permanent dual-state if commitment wavers; rich migration during
ongoing feature work.

### Big bang

Both states are built in parallel; at a chosen moment, traffic
cuts from source to target. Source is decommissioned.

Best for: stack migrations with full rewrites, tenancy
migrations with one-time data conversion.

Trade-offs: high coordination cost; rollback window is brief;
data migration must be flawless on first try (or have explicit
backout).

### Branch by abstraction

Add an abstraction layer over the source. Build the target
under the same abstraction. Switch the abstraction's
implementation from source to target. Remove the source.

Best for: stack migrations within a service, integration
migrations within a service.

Trade-offs: requires upfront abstraction work; cleaner rollback
than big bang.

### Parallel run

Both source and target operate simultaneously; results are
compared (shadow traffic). Once results match, source is
disabled.

Best for: high-risk migrations where correctness validation
matters (financial, compliance-critical).

Trade-offs: high cost (running two systems); complex result
comparison; clear value when correctness is non-negotiable.

### Hybrid

Most real migrations combine strategies — strangler fig
overall, branch-by-abstraction for specific subsystems, big
bang for the database cutover.

The command surfaces these and helps select:

```
Strategy selection inputs:
  Migration type: structural (monolith → modular monolith)
  Risk tolerance: medium (no compliance hard-deadline)
  Timeline pressure: medium (next 2 quarters preferred)
  Reversibility need: high (want to be able to back out)
  Concurrent feature work: yes (team can't pause development)

Recommended primary strategy: STRANGLER FIG
  - Compatible with concurrent feature work
  - High reversibility (can pause migration mid-flight)
  - Low big-bang risk

Sub-strategies:
  - Database split: branch-by-abstraction (domain repositories)
  - Initial extraction: pick low-coupling domains first
```

## Phase 5: phased execution plan

Break the migration into phases. Each phase has:

- **Name** (descriptive)
- **Goal** — what changes after this phase
- **Duration estimate** (weeks; be honest)
- **Prerequisites** — what must be true before starting
- **Steps** — ordered work items
- **Verification** — how we know the phase succeeded
- **Rollback** — how we undo if needed
- **Risk level** — low / medium / high
- **Dependencies on other phases**

Typical migration has 4-8 phases. Examples for a monolith →
modular monolith migration:

1. **Module boundary identification** (low risk, prep work)
2. **Internal API extraction** (medium risk, mostly mechanical
   refactoring)
3. **Test coverage hardening** at module boundaries (medium
   risk; tests are needed for safe extraction)
4. **Module package restructuring** (medium risk; visible code
   changes, no behavior changes)
5. **Module-level deployment artifacts** (low risk; build
   config)
6. **Module-level CI/CD pipelines** (medium risk; deployment
   process changes)
7. **Module ownership documentation** (low risk; org work)
8. **Decommission shared mutable state** (high risk; behavior
   changes)

## Phase 6: parallel-run / cutover plan

For strategies that involve a moment of transition (big bang,
parallel run cutover, strangler-fig final step), capture
explicitly:

- **Cutover prerequisites** — checklist before pulling the
  switch
- **Cutover sequence** — exact steps in order, with timing
- **Communication plan** — who's notified when
- **Observability during cutover** — metrics watched, alarms
  set
- **Decision criteria for proceeding vs aborting** —
  pre-committed thresholds
- **Rollback plan** — exact steps if abort triggered
- **Post-cutover validation window** — how long do we monitor
  before declaring success

This section is what gets opened during the actual cutover, so
it has to be runbook-quality.

## Phase 7: ADR opportunities

Migrations almost always warrant ADRs:

1. **The migration itself** — the decision to migrate, with
   alternatives considered (including "stay put") and
   consequences (including the migration cost itself)
2. **Target-state architectural decisions** — if the target
   state introduces new patterns, those need ADRs
3. **Transition strategy** — significant migrations warrant
   ADR documentation of the chosen strategy and why

Surface these for the user:

```
ADR OPPORTUNITIES (3 surfaced):

1. Migrate from monolith to modular monolith
   Why ADR-worthy: significant structural change; alternatives
   include staying put or going further (microservices); the
   chosen path needs documentation.
   Confidence: HIGH

2. Module boundary criteria
   Why ADR-worthy: how we decide where modules split affects
   future module work; needs principles, not ad-hoc decisions.
   Confidence: MEDIUM

3. Strangler-fig strategy with branch-by-abstraction for
   database access
   Why ADR-worthy: strategy choice has long consequences;
   future contributors need to understand why we picked this
   over big-bang.
   Confidence: HIGH

Draft ADRs for HIGH-confidence opportunities now? [Y/n]
```

If yes, invoke `/engineer:architecture:decisions:propose` for each, with
prefilled context drawn from this migration plan.

## Phase 8: success criteria

Explicit "we're done" criteria. Without these, migrations drift
indefinitely:

- **Functional**: target state's behaviors all working
- **Performance**: meets or exceeds original system on key
  metrics
- **Compliance**: no regression in compliance posture
- **Operational**: deployment / monitoring / debugging
  improved (or at least not regressed)
- **Source removal**: source state fully decommissioned (vs
  permanently dual-state)
- **Documentation**: ADRs accepted; diagrams updated; identity
  manifest reflects new state

The success criteria become Plane 12 audit checks during
migration execution. Audit will surface "migration in progress
but not complete" if the work pauses.

## Phase 9: failure mode and rollback strategy

For each phase, the rollback path. For the migration as a whole,
the abandon path:

- At what point does abandonment cease being feasible?
  (typically after Phase 4-5 of an 8-phase migration; commitment
  point)
- What's the cost of abandoning at each phase?
- What's preserved if abandoned?

This isn't pessimism; it's honesty. Migrations sometimes don't
finish. Knowing the abandon paths reduces the cost of bad
outcomes.

## Phase 10: report and plan output

Generate the migration plan document at:

`design/migrations/<YYYY-MM-DD>-<migration-name>.md`

With sections:
- Migration definition (name, type, motivation, initiator)
- Current state
- Target state
- Transition strategy
- Phased execution plan (each phase with prereqs / steps /
  verification / rollback / risk)
- Parallel-run / cutover plan
- ADR opportunities (and which were drafted)
- Success criteria
- Failure mode / abandon strategy

Also generate a tracker:
`design/migrations/<migration-name>-state.json`

Holds:
- Current phase
- Phase completion timestamps
- Issues encountered per phase
- ADR cross-references

The tracker is updated as phases complete. Plane 12 audit reads
it for migration progress drift detection.

## Cross-namespace effects

- **`architecture:decisions:*`** — migrations almost always
  generate ADRs
- **`architecture:diagrams`** — current state and target state
  both warrant diagrams; refresh during execution
- **`architecture:integration`** — integration migrations
  produce integration documents
- **`architecture:data-model migrate`** — schema-level
  migrations within a broader architectural migration may
  use that command
- **`maintenance:upgrades:*`** — stack migrations may include
  large dependency upgrades; coordinate via this plan, execute
  via maintenance routines
- **`engineer/maintenance/workflows/polyglot-maintenance-cycle`** —
  during active migration, maintenance cycle should be aware
  (some routines may need to skip migration-affected services)
- **`product:audit` Plane 12** — migration state visible as
  drift candidate

## What this command does NOT do

- **Execute the migration.** Plans are produced; execution is
  the team's work over phases.
- **Auto-validate target state.** Success criteria are
  defined; verification is the team's responsibility.
- **Substitute for ADRs.** The plan documents the migration;
  ADRs document the decisions. Both are needed.
- **Couple to specific tooling.** The plan is tool-agnostic;
  feature flags, traffic-shifting, blue-green, canary all stay
  as implementation choices.

## Examples

```bash
# Plan a monolith → modular monolith migration
/engineer:architecture:migrate monolith-to-modular --type structural

# Plan a sync → event-driven integration migration
/engineer:architecture:migrate sync-to-events-for-user-events --type integration

# Plan a tenancy migration
/engineer:architecture:migrate single-to-multi-tenant --type tenancy

# Plan a Spring Boot 2 → 3 migration with Jakarta
/engineer:architecture:migrate spring-boot-2-to-3 --type stack

# Plan a VMs → ECS deployment migration
/engineer:architecture:migrate vms-to-ecs --type deployment
```
