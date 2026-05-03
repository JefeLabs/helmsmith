---
description: Multi-phase workflow for introducing a new capability to an existing system. Walks through review of current architecture, ADR cycle for the capability, diagram updates, integration documentation, dependency planning, and migration if needed. Composes architecture commands across review, decisions, integration, and migration namespaces.
argument-hint: [<capability-name>] [--phase <name>] [--abort]
allowed-tools: Read, Write, Edit, Bash
---

> **Read first**: `workflows/_context.md`,
> `engineer/architecture/workflows/_context.md`,
> `engineer/architecture/_context.md`,
> `engineer/architecture/decisions/_context.md`,
> `engineer/architecture/_context.md` (capability-introduction
> patterns).

Multi-phase workflow for introducing a new capability to an
existing system. The capability might be a new feature, a new
infrastructure component, an integration with a new external
service, or a new architectural pattern. The workflow ensures
the introduction is documented, reviewed, designed, and
deployable rather than appearing in code without context.

**Invoke with:**
`/workflows:manage start engineer:capability-introduction`

## What "capability" means

A capability is a meaningful unit of system functionality with
its own boundaries, dependencies, and observability. Examples:

- "Add real-time notifications to the platform"
- "Introduce LangGraph for agent orchestration"
- "Add SAML SSO support for enterprise customers"
- "Migrate from in-process queue to managed SQS"
- "Add PostgreSQL pgvector for similarity search"

Distinct from features (which are user-facing) and from
implementation tasks (which are mechanical changes within
existing capabilities).

## State machine overview

```
[idle]
  ↓ user starts workflow with capability name
[review-current] — assess current architecture impacted by capability
  ↓ user approves direction
[scoping] — define boundaries, dependencies, integrations
  ↓ scope approved
[deciding] — invoke /engineer:adr-cycle for the capability decision
  ↓ ADR accepted
[diagramming] — update architecture diagrams to include capability
  ↓ diagrams updated
[integrating] — document integration points
  ↓ integration docs written
[planning-migration] — only if capability replaces existing functionality
  ↓ migration plan reviewed
[ready-for-build] — prerequisites complete; capability ready for implementation
  ↓ user signals build complete
[completed]
```

State persists in `product/.pencil-architecture.json` under
`activeWorkflows.capabilityIntroduction`:

```jsonc
{
  "activeWorkflows": {
    "capabilityIntroduction": {
      "id": "cap-2026-real-time-notifications",
      "capability": "Real-time notifications via SSE/WebSocket",
      "phase": "deciding",
      "started": "2026-05-01T10:00:00Z",
      "involvesMigration": false,
      "checkpoints": { ... },
      "linkedADRs": ["ADR-2026-018"],
      "diagramsUpdated": [],
      "integrationsDocumented": []
    }
  }
}
```

## Phase 0: detect existing or start new

Same pattern as adr-cycle (existing → continue/show/resume/abort).

## Phase 1: review-current

Before introducing a capability, understand what's there:

```
=== Capability Introduction: review-current ===

Capability: Real-time notifications via SSE/WebSocket

Step 1 of 3: Affected modules

What existing modules will this capability touch?
  Examples: api gateway, authentication, user-data store,
            mobile clients, web client, notifications-table

>

Step 2 of 3: Existing related capabilities

Are there capabilities currently solving partially
overlapping problems? (email notifications, SMS, in-app
banner, polling-based notifications)

>

Step 3 of 3: Architecture review

Invoking: /engineer:architecture:review --scope <affected-modules>

[review command runs and produces summary]

Review findings:
  - 3 modules will need integration points
  - Current polling-based notification approach uses
    minute-resolution; SSE/WebSocket gives sub-second
  - Existing rate limiter on /api/notify needs review for
    sustained connections
  - Mobile push (APNs/FCM) is separate from this capability
    and remains unchanged

Direction approved? [Y to continue / e to edit / a to abort]
```

State: `phase: "scoping"`,
`checkpoints.review-current: <now>`,
`affectedModules: [...]`.

## Phase 2: scoping

Define what's in and out:

```
=== Capability Introduction: scoping ===

Capability: Real-time notifications via SSE/WebSocket

In scope:
  - SSE endpoint at /api/notify/stream
  - Per-user filtering via auth token
  - Reconnection with last-event-id support
  - Event types: announcement, message, mention, system

Out of scope (deferred or alternative capability):
  - Mobile push (handled by APNs/FCM capability)
  - Email notifications (handled by /integrations:email)
  - Push to third-party (Slack, Discord, etc. — separate
    capability)

Dependencies (capabilities this depends on):
  - Authentication
  - Notification persistence (already exists)
  - Rate limiting (existing module; needs review for
    sustained connections)

Dependents (capabilities that will depend on this):
  - In-app notification center (will switch from polling to
    SSE)
  - Live update widgets in admin dashboard (planned;
    blocked-by this capability)

Confirm scope? [Y/edit]
```

State: `phase: "deciding"`,
`checkpoints.scoped: <now>`,
`scope: { in: [...], out: [...], dependsOn: [...], dependedBy: [...] }`.

## Phase 3: deciding

Invokes the ADR cycle workflow:

```bash
/workflows:manage start engineer:adr-cycle \
  "Real-time notifications: SSE/WebSocket vs alternatives"
```

The capability-introduction workflow waits for the inner ADR
cycle to complete. State persists across both workflows
(separate keys in `activeWorkflows`).

When ADR accepted, capability-introduction state updates with
the linked ADR ID:

```jsonc
{
  "linkedADRs": ["ADR-2026-018"]
}
```

State: `phase: "diagramming"`,
`checkpoints.decided: <now>`.

## Phase 4: diagramming

Updates architecture diagrams to include the new capability:

```
=== Capability Introduction: diagramming ===

Capability: Real-time notifications

Step 1 of 2: Identify diagrams to update

Existing diagrams in docs/architecture/:
  - system-overview.mermaid (high-level system view)
  - notifications-flow.mermaid (notification pipeline)
  - api-gateway.mermaid (API boundary)

The capability affects these. Update each? [Y/select]

Step 2 of 2: Generate updates

Invoking: /engineer:architecture:diagrams update notifications-flow
  with capability addition

[diagrams command runs; updated diagram saved]

Updates summary:
  ✓ system-overview.mermaid: added "real-time notifications" box
  ✓ notifications-flow.mermaid: added SSE flow alongside polling
  ✓ api-gateway.mermaid: added /api/notify/stream endpoint

Verify diagrams render correctly? [Y/n]
```

State: `phase: "integrating"`,
`checkpoints.diagrammed: <now>`,
`diagramsUpdated: [...]`.

## Phase 5: integrating

Document integration points with existing modules:

```
=== Capability Introduction: integrating ===

Capability: Real-time notifications

Integration points (from scoping phase):

  authentication:
    Direction: notifications consumes auth tokens
    Contract: bearer JWT in connection request
    Documentation: /engineer:architecture:integration auth-with-notifications
    Status: pending

  notification-persistence:
    Direction: notifications reads from existing table
    Contract: filter by recipient_id; chronological order
    Documentation: /engineer:architecture:integration notifications-storage
    Status: pending

  rate-limiter:
    Direction: notifications subject to rate limiter
    Contract: SSE connection counts as 1 connection regardless
              of duration; events per second limited separately
    Documentation: /engineer:architecture:integration rate-limit-sse
    Status: pending

For each: invoke /engineer:architecture:integration <name>?

[Iterates through each, invoking the integration command]

All integrations documented.
```

State: `phase: "planning-migration"` (if applicable) or
`phase: "ready-for-build"` (if no migration needed),
`checkpoints.integrated: <now>`,
`integrationsDocumented: [...]`.

## Phase 6: planning-migration (conditional)

Only when capability replaces existing functionality. The
review phase identified whether this is the case.

```
=== Capability Introduction: planning-migration ===

Capability: Real-time notifications
Replaces: polling-based notifications (existing)

Migration considerations:
  - Existing polling consumers (3 components in admin UI)
    need to switch to SSE
  - Polling endpoint should remain operational during
    transition window
  - Rollback: keep polling functional; switch back if SSE
    has issues

Plan:
  Phase A: Build SSE alongside polling (both operational)
  Phase B: Migrate one client (admin UI) to SSE; verify
  Phase C: Migrate remaining clients
  Phase D: Deprecate polling endpoint (sunset notice)
  Phase E: Remove polling endpoint (after sunset)

Invoking: /engineer:architecture:migrate plan
  --capability real-time-notifications
  --replaces polling-notifications

[migrate command runs and produces detailed plan]

Migration plan documented at:
  docs/migrations/real-time-notifications.md

Schedule:
  Phase A: 2026-05-15 to 2026-05-22 (build)
  Phase B: 2026-05-23 to 2026-05-29 (admin UI)
  Phase C: 2026-05-30 to 2026-06-12 (remaining clients)
  Phase D: 2026-06-13 (sunset notice)
  Phase E: 2026-08-15 (removal — 2 month sunset)
```

State: `phase: "ready-for-build"`,
`checkpoints.migration-planned: <now>`,
`migrationPlan: { ... }`.

## Phase 7: ready-for-build

The pre-build checkpoint. All architectural prerequisites are
complete.

```
=== Capability Introduction: ready-for-build ===

Capability: Real-time notifications

Prerequisites complete:
  ✓ Architecture review
  ✓ Scope defined
  ✓ ADR-2026-018 accepted
  ✓ Diagrams updated (3 diagrams)
  ✓ Integration points documented (3 integrations)
  ✓ Migration plan documented (5 phases)

The capability is ready for implementation. Implementation
work happens outside this workflow — typically:
  - Create implementation tickets in /integrations:jira
  - Assign to engineering team
  - Track progress via /integrations:github (PRs)

When implementation is complete, return here:
  /workflows:manage complete engineer:capability-introduction

This will:
  - Mark workflow as completed
  - Update capability registry in product/.pencil-architecture.json
  - Move workflow to history
```

State: `phase: "completed"` after user signals build complete.

## Phase 8: completed

Capability is now part of the system architecture. Workflow
moves to history.

```
=== Capability Introduction: COMPLETED ===

Capability:     real-time-notifications
ADR:            ADR-2026-018
Diagrams:       system-overview, notifications-flow, api-gateway
Integrations:   3 documented
Migration:      planned, executing through 2026-08-15

Workflow archived. The capability is now part of the
architecture registry. To revisit, see:
  product/.pencil-architecture.json
    history.capabilityIntroduction.real-time-notifications

  capabilityRegistry.real-time-notifications
```

## Composition

This workflow composes the ADR cycle workflow as a sub-step.
Both can be active simultaneously (parent
capability-introduction in `deciding` phase; child adr-cycle
in `stakeholder-review` phase). When the inner ADR cycle
completes, the outer workflow's state machine advances.

When invoked from an even-larger workflow
(`engineer:architecture-review-annual` may invoke this for
each new capability identified during annual review), the
nesting is three-deep at maximum. The state machine handles
this; each workflow has its own key under `activeWorkflows`.

## What this workflow does NOT do

- **Implement the capability.** Architecture and decisions;
  not code.
- **Replace project management.** Doesn't track sprint
  progress, ticket assignments, build velocity.
- **Auto-update architecture diagrams.** Surfaces what to
  update and invokes the diagrams command; final diagrams
  are user-reviewed.
- **Validate the migration plan against actual constraints.**
  Plan reflects what was discussed; real execution may
  diverge and the migration command handles those updates
  separately.

## Examples

```bash
# Start a new capability introduction
/workflows:manage start engineer:capability-introduction \
  "Real-time notifications via SSE/WebSocket"

# Resume in-progress
/workflows:manage continue engineer:capability-introduction

# Skip to a specific phase
/workflows:manage start engineer:capability-introduction \
  --phase integrating

# Mark complete (after implementation)
/workflows:manage complete engineer:capability-introduction
```
