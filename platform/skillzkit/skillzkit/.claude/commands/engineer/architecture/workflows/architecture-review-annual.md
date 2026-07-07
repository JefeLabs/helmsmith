---
outcome: Run annual architecture review
description: Annual strategic architecture review workflow. Runs the architecture review command in annual mode, walks findings with stakeholders, identifies decision needs and capability gaps, schedules quarterly checkpoints. Multi-week timeline (typically 4-8 weeks from kickoff to commitments). Composes review, ADR cycle, and capability introduction workflows.
argument-hint: [--year <YYYY>] [--phase <name>] [--abort]
allowed-tools: Read, Write, Edit, Bash
---

> **Read first**: `workflows/_context.md`,
> `engineer/architecture/workflows/_context.md`,
> `engineer/architecture/_context.md`,
> `engineer/architecture/decisions/_context.md`.

Annual strategic architecture review. Runs once per year (or
on a custom cadence per project). Surfaces architecture-level
findings — drift from intended state, capability gaps,
decision lag, observability gaps, technical debt — and turns
findings into commitments via ADR cycles, capability
introductions, and scheduled checkpoints.

This is the heaviest-duration workflow in the suite. From
kickoff to final commitments typically takes 4-8 weeks
because architecture-level changes don't conclude in a single
session.

**Invoke with:**
`/core:workflows:manage start engineer:architecture-review-annual`

## State machine overview

```
[idle]
  ↓ user starts annual review
[scoping] — define what's in scope (full system, or specific bounded contexts)
  ↓ scope confirmed
[running-review] — invokes /engineer:architecture:review --annual
  ↓ findings produced
[stakeholder-walkthrough] — present findings to stakeholders, gather context
  ↓ context-enriched findings ready
[prioritizing] — rank findings by impact + urgency; identify top 5-10
  ↓ priorities locked in
[committing] — for each prioritized finding, define follow-up
  ↓ commitments documented
[scheduling-checkpoints] — schedule quarterly checkpoints
  ↓ checkpoints on calendar
[completed]
```

State persists in `product/.pencil-architecture.json` under
`activeWorkflows.architectureReviewAnnual`:

```jsonc
{
  "activeWorkflows": {
    "architectureReviewAnnual": {
      "id": "annual-review-2026",
      "year": 2026,
      "phase": "stakeholder-walkthrough",
      "started": "2026-04-15",
      "lastActivity": "2026-05-03",
      "scope": "full-system",
      "findings": [...],
      "stakeholders": [...],
      "checkpoints": { ... },
      "commitments": [...],
      "scheduledCheckpoints": [...]
    }
  }
}
```

## Phase 1: scoping

```
=== Annual Architecture Review: scoping ===

Year: 2026

Scope options:
  [f] Full system (all bounded contexts)
  [s] Selected bounded contexts (you specify)
  [t] Top tier (most-impactful contexts only)

Choice:
> f

Stakeholders to involve:
  - Engineering leadership (CTO, VP Eng)
  - Staff/principal engineers
  - Tech leads per major domain
  - Platform / infrastructure leads
  - Security (if scope includes auth/data flow)
  - Compliance (if regulated industry)

> [confirm or edit list]

Timeline:
  Kickoff:           2026-04-15 (today)
  Review run:        2026-04-15 to 2026-04-22
  Stakeholder walks: 2026-04-23 to 2026-05-06
  Prioritization:    2026-05-07 to 2026-05-13
  Commitments:       2026-05-14 to 2026-05-20
  Final scheduling:  2026-05-21 to 2026-05-27

> [confirm or adjust]

Scope locked.
```

State: `phase: "running-review"`,
`checkpoints.scoped: <now>`.

## Phase 2: running-review

Invokes the architecture review command in annual mode:

```bash
/engineer:architecture:review --annual --scope <scope>
```

The review command produces structured findings across
categories:

- **Drift** — architecture diverged from documented intent
- **Capability gaps** — missing capabilities for current
  needs
- **Decision lag** — decisions deferred or made implicitly
  without ADR
- **Observability gaps** — areas without adequate
  monitoring/tracing
- **Technical debt** — accumulated shortcuts impacting
  velocity or risk
- **Dependency staleness** — frameworks/runtimes/libraries
  approaching EOL
- **Security posture** — gaps in auth, encryption, access
  control
- **Compliance** — drift from required standards

```
=== Architecture Review Findings: 2026 ===

Run completed: 2026-04-22

Findings (47 total):

Drift (8):
  - Spring Modulith boundary violations between auth and api
    modules (4 violations)
  - Cross-module direct repository access (3 instances)
  - Missing module-level documentation for embabel-core
  
Capability gaps (5):
  - No automated dependency-vulnerability monitoring (Snyk
    or equivalent integrated)
  - No formal API versioning strategy beyond URL versioning
  - No structured event sourcing for audit trail
  - ...

Decision lag (12):
  - Choice between LangGraph and Embabel still implicit (no
    ADR; both libraries used in different modules)
  - GraphRAG storage choice (Neo4j vs pgvector) made via
    chat threads but no ADR
  - ...

[More categories with findings]

Findings have been saved to:
  product/.pencil-architecture.json
    activeWorkflows.architectureReviewAnnual.findings
```

State: `phase: "stakeholder-walkthrough"`,
`checkpoints.review-completed: <now>`,
`findings: [...]`.

## Phase 3: stakeholder-walkthrough

Multi-week phase. Findings are presented to stakeholders;
their context refines the findings.

```
=== Stakeholder Walkthrough ===

Total findings: 47
Stakeholders to walk through with: 6

Per-stakeholder progress:

  CTO:                 Pending walkthrough (scheduled 2026-04-25)
  VP Engineering:      Pending (scheduled 2026-04-26)
  Staff Engineer 1:    Walked 2026-04-23 (added context to 8 findings)
  Staff Engineer 2:    Walked 2026-04-24 (added context to 12 findings)
  Tech Lead Platform:  Pending (scheduled 2026-04-29)
  Tech Lead Auth:      Pending (scheduled 2026-04-30)

Outstanding action: schedule remaining walkthroughs

Findings with stakeholder context:
  Drift: Spring Modulith violations
    Staff Engineer 2 context: "These accumulated during the
    rapid feature push for Q1 launch. Acceptable short-term;
    needs cleanup in Q2."
    → Promotes to "tech debt" classification
    → Adds estimated cleanup effort

[More finding-level context]

When all walkthroughs complete:
  /core:workflows:manage walkthrough-complete engineer:architecture-review-annual
```

The workflow records context per finding. When all
walkthroughs done, surfaces:

```
=== Walkthrough Complete ===

All 6 stakeholder walkthroughs done.
Findings enriched with context: 31 of 47

Moving to prioritization phase.
```

State: `phase: "prioritizing"`,
`checkpoints.walkthroughs-complete: <now>`,
`findings` updated with stakeholder context.

## Phase 4: prioritizing

Apply impact × urgency × effort to identify top findings.

```
=== Prioritization ===

47 findings to prioritize.

Each finding rated:
  Impact   (1-5): how much it affects velocity, risk, or
                   compliance
  Urgency  (1-5): how soon it needs attention
  Effort   (S/M/L/XL): rough effort to address

Walkthrough findings in priority order...

[For each finding, surface to user with stakeholder context;
 user provides Impact/Urgency/Effort assessment]

After scoring, rank by composite (Impact × Urgency / Effort):

Top 10 priorities:
  1. ADR for orchestration framework choice (LangGraph vs
     Embabel) — Impact 5, Urgency 5, Effort S
  2. Spring Modulith boundary cleanup — Impact 4, Urgency 4,
     Effort M
  3. Snyk vulnerability monitoring integration — Impact 5,
     Urgency 4, Effort M
  ...
```

State: `phase: "committing"`,
`checkpoints.prioritized: <now>`,
`prioritizedFindings: [...]`.

## Phase 5: committing

For each prioritized finding, define a follow-up:

```
=== Commitments ===

Top 10 priorities → follow-up commitments

Priority 1: ADR for orchestration framework choice
  Type: decision-needed
  Follow-up: /engineer:adr-cycle
              "Choose between LangGraph and Embabel"
  Owner: <staff-engineer-1>
  Target completion: 2026-06-15
  
  Confirm? [Y/edit/defer]

Priority 2: Spring Modulith boundary cleanup
  Type: refactor
  Follow-up: technical task tracked in /core:integrations:jira
              SCOOL-XXXX
  Owner: <tech-lead-platform>
  Target completion: 2026-Q3
  
  Confirm? [Y/edit/defer]

Priority 3: Snyk integration
  Type: capability-introduction
  Follow-up: /engineer:capability-introduction
              "Snyk vulnerability monitoring"
  Owner: <staff-engineer-2>
  Target completion: 2026-07-01
  
  Confirm? [Y/edit/defer]

[Continues for each priority]

All 10 commitments documented.
```

State: `phase: "scheduling-checkpoints"`,
`checkpoints.committed: <now>`,
`commitments: [...]`.

## Phase 6: scheduling-checkpoints

Quarterly checkpoint workflows for tracking progress:

```
=== Schedule Checkpoints ===

Annual review commitments span 2026 Q2 through 2026 Q4.

Recommended checkpoints:
  Q2 checkpoint: 2026-07-15 (review Q2 commitments;
                              status of priorities 1-3)
  Q3 checkpoint: 2026-10-15 (review Q3 commitments;
                              status of priorities 4-7)
  Q4 checkpoint: 2027-01-15 (review Q4 commitments;
                              full annual review prep)

Each checkpoint is a quarterly invocation of:
  /core:workflows:manage start engineer:architecture-checkpoint
  --year 2026 --quarter Q2

(Quarterly checkpoint workflow exists separately; this annual
review schedules them.)

Add reminders to /core:integrations:gcal? [Y/n]
```

When confirmed, integrations are invoked to set calendar
reminders and Jira tickets. State updated with scheduled
checkpoints.

State: `phase: "completed"`,
`checkpoints.scheduling-complete: <now>`,
`scheduledCheckpoints: [...]`.

## Phase 7: completed

```
=== Annual Architecture Review: COMPLETED ===

Year:                 2026
Findings produced:    47
Walkthroughs done:    6 stakeholders
Priorities defined:   10
Commitments:          10 (3 ADR cycles, 4 jira tickets,
                          3 capability introductions)
Checkpoints scheduled: 3 quarterly

Workflow archived to history.

Next annual review recommended: 2027-04-15
  (will be auto-suggested via Plane 12 audit when
  approaching the annual mark)
```

State moves from `activeWorkflows` to `history`.

## Composition

This workflow composes:

- **`/engineer:architecture:review --annual`** in Phase 2
- **`/core:workflows:manage start engineer:adr-cycle`** in Phase 5
  for each decision-needed commitment
- **`/core:workflows:manage start engineer:capability-introduction`**
  in Phase 5 for each capability-introduction commitment
- **`/core:integrations:jira`** for ticketing commitments
- **`/core:integrations:gcal`** for checkpoint reminders

The annual review is the highest-level architecture
orchestrator. It can run continuously (some commitments
extend across the year) while subordinate workflows complete.

## Multi-year continuity

The workflow's history persists year-over-year. Year N+1's
annual review reads year N's history to:

- Track which commitments were completed (Q4 checkpoint
  results inform next year)
- Identify recurring findings (drift that came back; capability
  gaps unfilled)
- Surface trend data (decision lag count year-over-year;
  technical debt trajectory)

The history table:

```jsonc
{
  "history": {
    "architectureReviewAnnual": {
      "2025": { ... 2025 review data ... },
      "2026": { ... 2026 review data ... }
    }
  }
}
```

## What this workflow does NOT do

- **Replace strategic discussion.** The workflow tracks state;
  humans discuss.
- **Auto-prioritize without input.** Prioritization always
  involves user-stakeholder judgment.
- **Execute commitments.** Schedules follow-up workflows; the
  follow-ups happen separately.
- **Validate findings against ground truth.** The review
  command produces findings based on what's documented; if
  documentation is incomplete, findings may miss things.
- **Replace ongoing architecture work.** Annual is strategic;
  day-to-day architecture happens through normal commands and
  workflows.

## Examples

```bash
# Start annual review
/core:workflows:manage start engineer:architecture-review-annual

# Resume in-progress
/core:workflows:manage continue engineer:architecture-review-annual

# Specific year (e.g., re-running a past year for analysis)
/core:workflows:manage start engineer:architecture-review-annual --year 2025

# Skip to specific phase
/core:workflows:manage start engineer:architecture-review-annual \
  --phase prioritizing
```
