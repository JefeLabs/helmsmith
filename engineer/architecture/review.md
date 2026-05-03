---
description: Architecture review at multiple lifecycle moments — assessing a new capability against existing architectural identity, reviewing a greenfield project's bootstrap intent, checking a brownfield feature for alignment with accepted decisions, or running periodic fitness function evaluation. Produces structured review reports and optionally drafts ADRs for material decisions surfaced.
argument-hint: <mode: capability|greenfield|brownfield-feature|annual> [description] [--depth quick|standard|full] [--draft-adr] [--compare-to <date>]
allowed-tools: Read, Write, Edit, Bash
---

Architecture review is a lifecycle command. It runs at four
distinct moments, each producing a structured assessment:

| Mode | When to run |
|------|-------------|
| `capability` | A new capability is being introduced to an existing system; review intent before commit |
| `greenfield` | A brand-new project is being bootstrapped; review proposed architecture before code is written |
| `brownfield-feature` | A new feature is being added to an existing project; check alignment with accepted decisions |
| `annual` | Periodic health check against documented intent and fitness targets |

All four modes share the same skeleton (discovery → principles
assessment → identity-fit check → ADR opportunity surfacing →
report) but vary in inputs, emphases, and outputs.

The review **does not make decisions** — that's ADRs. The review
**surfaces** what should be decided, where existing decisions
conflict with proposals, and where the architecture has drifted
from intent. Recommendations point to ADR proposals, diagram
updates, integration documentation, or migration planning as
follow-ups.

## Phase 0: discovery (all modes)

Read:

1. `product/.pencil-architecture.json` — architectural identity
2. `product/.pencil-decisions.json` — accepted ADR index
3. `design/diagrams/` — existing diagrams (context, container,
   component, sequence, data-flow)
4. `design/integrations/` — documented integration patterns
5. `design/dependency-reports/` — most recent dependency
   analysis (for annual mode comparisons)
6. Topology detection per `engineer/maintenance/_context.md` — confirm
   project structure matches manifest

If `.pencil-architecture.json` is missing AND mode is anything
other than `greenfield`, the command pauses:

> No architectural identity manifest found. Either:
>   - Run `/engineer:architecture:diagrams container` to establish one
>   - Run review in `greenfield` mode if this is a new project
>
> Architecture review against an undocumented identity produces
> imprecise findings. Initialize first.

For `greenfield` mode, missing manifest is expected; the review
produces the manifest as one of its outputs.

## Mode: capability

The most common case. A new capability is being introduced —
typically a new service, integration, data subject, or major
external dependency. The review assesses fit before commitment.

### Phase 1: capability description

If the description is provided as `$ARGUMENTS[1]`, use it.
Otherwise prompt:

> Describe the new capability in 2-4 sentences. What is it,
> what problem does it solve, what does it touch?
>
> Examples:
>   - "Real-time student match notifications: when a school
>      posts a scholarship, students whose profile matches get
>      notified within seconds. Touches: notification service,
>      WebSocket layer, match-scoring service."
>   - "PDF export for transcripts: students can download PDF
>      versions of their academic records. Touches: existing
>      transcript service, new PDF generation worker, S3 for
>      temporary storage."

### Phase 2: principles assessment

Walk through architectural principles (drawn from accepted ADRs
and architectural identity):

#### Identity alignment

- Does the capability fit the project's stated style?
  (modular-monolith, microservices, event-driven, etc.)
- Does it follow declared integration patterns? Or does it
  introduce a new one?
- Does it respect declared multi-tenancy strategy?
- Does it use the established tech stack, or introduce new
  technology?

For each, surface:

```
IDENTITY ALIGNMENT — integration pattern
  Project default: sync-request-response (per ADR-009)
  This capability proposes: async messaging via SQS
  
  This is a deviation from the default pattern. Acceptable
  deviations include async use cases like notifications, events,
  long-running work. The proposed use (real-time student match
  notifications) fits this pattern.
  
  Recommendation: document the deviation via ADR. Consider
  proposing now via /engineer:architecture:decisions:propose.
```

#### ADR conflict check

For each accepted ADR with overlapping tags:

- Does this capability align with the decision?
- Does it implicitly contradict the decision?
- Does it suggest the decision should be revisited?

If conflicts exist:

```
ADR CONFLICT
  ADR-005: Spring Boot 3.x with Jakarta EE migration
  Conflict: this capability proposes adding a Java 11-era library
  (com.example.legacy:1.2.3) that doesn't support Jakarta packages.
  
  Resolution paths:
    - Find a Jakarta-compatible alternative
    - Contain the legacy library behind an adapter
    - Supersede ADR-005 (likely overkill for one library)
  
  Recommendation: contain via adapter pattern; document the
  containment via ADR.
```

#### Fitness target impact

For each declared fitness target in
`.pencil-architecture.json`, assess impact:

- **Deployment frequency** — does this capability slow it down?
  (more services, more coordination, more tests)
- **Lead time for changes** — same.
- **Mean time to recovery** — does it add new failure modes?
- **Change failure rate** — does it increase coupling that
  could cascade failures?

Surface:

```
FITNESS TARGET IMPACT — mean time to recovery
  Target: < 1 hour
  Capability impact: introduces new external dependency
    (notification delivery service). Outage of that dependency
    is a new failure mode.
  
  Mitigations to consider:
    - Circuit breaker around the dependency
    - Graceful degradation (notifications queued, retried)
    - Runbook for partial-outage scenarios
  
  Recommendation: capability requires explicit failure handling
  design before implementation. Run /engineer:architecture:integration
  select for the notification flow.
```

### Phase 3: gap analysis

Identify what the capability requires that doesn't yet exist:

- New ADRs needed (decisions not yet made)
- New diagrams (or diagram updates) — the capability changes
  the architecture
- New integrations to document
- New data models to design
- New API contracts to define

Each gap becomes a recommended follow-up.

### Phase 4: ADR opportunity surfacing

For each material decision the capability requires, surface the
ADR opportunity:

```
ADR OPPORTUNITIES (4 surfaced):

1. Async messaging substrate for notifications
   Why ADR-worthy: introduces SQS as a new infrastructure
   dependency; affects deployment, ops, observability.
   Tags: messaging, integration, infra
   Confidence: HIGH (clear material decision)

2. Notification delivery semantics
   Why ADR-worthy: at-least-once vs exactly-once vs at-most-once
   has cascading consequences for client implementation.
   Tags: messaging, integration, semantics
   Confidence: HIGH

3. Match scoring algorithm location
   Why ADR-worthy: in app-service vs separate worker affects
   deployment, scaling, isolation.
   Tags: services, scaling
   Confidence: MEDIUM (could fit existing patterns)

4. Real-time delivery mechanism (WebSocket vs SSE vs polling)
   Why ADR-worthy: protocol choice affects client architecture,
   load balancer config, infrastructure.
   Tags: api, real-time, frontend-backend
   Confidence: HIGH
```

Confidence levels help triage. HIGH means "this is clearly
worth an ADR"; MEDIUM means "decision exists but might fit a
broader ADR"; LOW means "minor decision, ADR optional."

### Phase 5: report generation

Output report at
`design/architecture-reviews/<YYYY-MM-DD>-capability-<slug>.md`:

```markdown
# Architecture Review: <Capability Name>

**Date**: YYYY-MM-DD
**Mode**: capability
**Depth**: standard
**Reviewer**: <user>
**Status**: review-only (no decisions made)

## Capability Summary

<the 2-4 sentence description from Phase 1>

## Identity Alignment

<findings from Phase 2 — alignment, deviations, deviations
documented vs not>

## ADR Conflicts

<findings — conflicts with accepted ADRs and resolution paths>

## Fitness Target Impact

<per-target assessment>

## Gap Analysis

### New ADRs needed
- <list>

### Diagrams to update
- <list>

### Integration documentation
- <list>

### Data models
- <list>

### API contracts
- <list>

## ADR Opportunities

<the prioritized list with confidence levels>

## Recommended Follow-Up Sequence

1. <ordered list of next steps with command suggestions>

## Out of Scope for This Review

<explicit list — things the review didn't assess>
```

### Phase 6: optional ADR drafting (`--draft-adr`)

If `--draft-adr` was provided, after the report is produced, the
command iterates through the HIGH-confidence ADR opportunities
and offers to draft each:

> ADR Opportunity #1: "Async messaging substrate for
> notifications" (HIGH confidence)
>
> Draft this ADR now via /engineer:architecture:decisions:propose? [Y/n]

For each yes, the command invokes the propose flow with
prefilled context (drawn from the review's findings on this
opportunity). The user still walks through the structured
prompting, but the Context section comes pre-populated with the
review's analysis.

This is the integration point with capability-introduction
workflow.

## Mode: greenfield

Run before code is written for a new project. The review
captures bootstrap-level architectural intent.

### Phase 1: project intent gathering

Prompt for foundational facts:

- **Domain** — what business / problem space?
- **Scale assumptions** — initial users, expected growth, peak
  traffic
- **Compliance constraints** — FERPA, GDPR, HIPAA, SOC2, none
- **Team size and structure** — single team, multiple teams,
  remote, in-house
- **Operational constraints** — cloud-native, on-prem, hybrid,
  budget targets
- **Initial capability set** — what's the MVP?

These become the initial `.pencil-architecture.json` content
plus inputs to the review.

### Phase 2: stack assessment

For each stack choice, walk through trade-offs:

- **Primary language(s)** — Java, TypeScript, Go, Python, etc.
  (project may have multiple)
- **Web framework / runtime** — Spring Boot, Next.js, Express,
  FastAPI, etc.
- **Database(s)** — Postgres, MySQL, DynamoDB, MongoDB, hybrid
- **Messaging** (if needed) — SQS, Kafka, EventBridge, RabbitMQ,
  none
- **Deployment platform** — ECS, EKS, Lambda, App Runner,
  Vercel, self-hosted
- **Auth** — homegrown, Auth0, Cognito, Clerk, Supabase, etc.

Each choice surfaces ADR opportunities. Greenfield projects
typically generate **5-12 foundational ADRs** in this phase.

### Phase 3: structural decisions

Walk through structural questions:

- **Style** — monolith, modular monolith, microservices,
  serverless, event-driven, hybrid
- **Multi-tenancy** (if applicable) — schema-per-tenant,
  row-level, separate databases, none
- **API style** — REST, GraphQL, gRPC, hybrid
- **State management** — server-rendered, SPA + API, hybrid

Each is an ADR opportunity. Recommendation strength is
HIGH for all of these in greenfield context — these decisions
shape everything downstream.

### Phase 4: greenfield-specific gap analysis

What the project will need that doesn't exist yet:

- Architectural identity manifest (output of this review)
- Initial ADR set (5-12 foundational decisions)
- Container diagram (immediate priority post-review)
- Initial data model
- Auth strategy ADR
- Deployment / infra ADR

### Phase 5: report and bootstrap output

The report at
`design/architecture-reviews/<YYYY-MM-DD>-greenfield-bootstrap.md`
plus initialization of:

- `product/.pencil-architecture.json` (with captured intent)
- `product/.pencil-decisions.json` (initialized empty, ready for
  ADRs to be proposed)

### Phase 6: ADR drafting (greenfield default)

For greenfield mode, `--draft-adr` is the default behavior. The
command offers to draft each foundational ADR after the manifest
is initialized:

> Foundational ADRs identified: 8 HIGH-confidence opportunities.
> Draft them in sequence now? Each will be created in `proposed`
> status; refine and accept individually as the team aligns.
> [Y/n]

Each yes invokes propose with greenfield-flavored prefilled
context. Each ADR-1 through ADR-N becomes the project's
founding decision record.

## Mode: brownfield-feature

Run when a new feature is being added to an existing project.
Lighter than capability mode because the architecture is
established; the review checks alignment.

### Phase 1: feature description

If `$ARGUMENTS[1]` is the feature description, use it. Otherwise
prompt:

> Describe the feature being added. What does it do? Which
> existing services/components/data models does it touch? What
> new artifacts does it introduce?

### Phase 2: depth-aware assessment

The `--depth` flag governs how deep the review goes. Default is
`standard`.

#### `--depth quick`

Identity-fit check only:
- Does the feature align with established style?
- Does it use the established stack?
- Does it respect multi-tenancy?

Quick mode is for small / well-understood features where the
architectural shape is obvious. Output: short report (~1 page).

#### `--depth standard` (default)

Quick mode + ADR conflict check + integration pattern alignment.
Most brownfield features fit this depth.

Output: structured report (~2-3 pages).

#### `--depth full`

Standard mode + dependency analysis + fitness target impact +
diagram update assessment.

Full mode is for features that genuinely affect architectural
shape — new external dependencies, new services, new data
patterns, integration changes.

Output: comprehensive report; closer in scope to capability
review.

### Phase 3: alignment surfacing

For each existing architectural element the feature touches:

- ADRs whose constraints apply
- Diagrams that should be updated
- Integration patterns that constrain implementation
- Data models that constrain shape

Surface:

```
APPLICABLE CONSTRAINTS:
  ADR-001: Schema-per-tenant for multi-tenancy isolation
    → Feature must respect tenant scoping in any new tables
  ADR-009: Sync request-response as default integration pattern
    → New service-to-service calls should use sync unless
      pattern justifies async
  Container diagram (last updated 2026-02): shows current
    services
    → New service introduction would require diagram update
```

### Phase 4: tension flagging

If the feature implicitly contradicts an accepted ADR or
established pattern, flag the tension:

```
TENSION:
  Feature introduces direct database access from app-ui
  (server actions querying Postgres).
  
  This conflicts with: implicit pattern of "app-ui calls API
  service for all data access" (visible in container diagram,
  not yet ADR-formalized).
  
  Resolution paths:
    - Maintain the pattern: route through API service
    - Establish a new pattern: server actions allowed for
      specific cases (then document via ADR)
    - Hybrid: server actions for read-only display, API for
      mutations
  
  Recommendation: bring to team discussion; outcome warrants
  ADR.
```

### Phase 5: report

Output at
`design/architecture-reviews/<YYYY-MM-DD>-feature-<slug>.md`.

Standard sections (lighter than capability mode):

- Feature summary
- Applicable constraints
- Tensions flagged
- Required follow-ups (diagram updates, ADRs, etc.)

## Mode: annual

Periodic health check. Runs against documented intent and
fitness targets. Surfaces drift over time.

### Phase 1: identity vs reality check

Compare `.pencil-architecture.json` to current state:

- Container list — services in manifest vs services on
  filesystem / in deployment
- Tech stack — declared vs actually used
- Integration patterns — declared default vs observed patterns
- Multi-tenancy strategy — manifest claim vs implementation

For each mismatch, classify:

- **Drift** (manifest is stale; reality has moved)
- **Aspiration** (manifest says what we want; reality is the
  starting point)
- **Documentation gap** (something deliberate happened but
  wasn't recorded)

### Phase 2: ADR coverage assessment

For each significant architectural pattern visible in the
codebase, check for ADR coverage:

- Multi-tenancy approach — covered?
- Auth strategy — covered?
- Caching strategy — covered?
- Messaging substrate — covered?
- Deployment model — covered?
- Observability approach — covered?

Surface gaps as retrofit opportunities.

### Phase 3: ADR drift assessment

For each accepted ADR, check whether implementation matches:

- ADR-005 says Spring Boot 3.x; build files use Spring Boot
  3.4.0 ✓
- ADR-009 says sync request-response default; codebase has
  significant async messaging in user-events context — is this
  documented as an exception? If not, drift.

### Phase 4: fitness target evaluation

For each declared fitness target, evaluate against measured
reality (where measurable):

- Deployment frequency — measured?
- Lead time for changes — measured?
- MTTR — measured?
- Change failure rate — measured?

If targets aren't measurable (no data collection in place),
surface as gap:

> FITNESS TARGET — measurement gap
> Target: deployment frequency < daily
> Measurement: not currently captured
> Recommendation: instrument deployment-tracking; bring to
> annual review for next cycle.

### Phase 5: trend analysis (with `--compare-to`)

If `--compare-to <date>` is provided, load the previous annual
review and surface deltas:

- Drift items resolved since last review
- New drift introduced
- ADR proposals from last review that were accepted (and
  effects observable in code)
- ADR proposals that weren't acted on

### Phase 6: report

Output at
`design/architecture-reviews/<YYYY-MM-DD>-annual.md`.

Comprehensive sections:

- Identity vs reality findings
- ADR coverage assessment
- ADR drift assessment
- Fitness target evaluation
- Trend (if comparison)
- Recommended follow-ups (retrofits, supersessions, manifest
  updates)
- Items to surface in next year's review

## Cross-namespace effects

- **`architecture:decisions:*`** — every review surfaces ADR
  opportunities; with `--draft-adr`, review directly invokes
  the propose flow
- **`architecture:diagrams`** — review surfaces diagram update
  needs; can be followed by diagram refresh
- **`architecture:integration`** — review surfaces integration
  documentation gaps
- **`architecture:dependency`** — full-depth reviews trigger
  dependency analysis
- **`product:audit` Plane 12** — annual review's findings feed
  Plane 12 sub-checks (12a coverage, 12b drift, 12c diagram
  staleness, 12e fitness regression)
- **`product:workflows:greenfield`** — invokes greenfield mode
  in Phase 1
- **`product:workflows:brownfield-add-feature`** — invokes
  brownfield-feature mode after brief
- **`architecture:workflows:capability-introduction`** —
  invokes capability mode in Phase 1
- **`architecture:workflows:architecture-review-annual`** —
  invokes annual mode

## Phase 7: report indexing

Maintain `design/architecture-reviews/_index.md` listing all
reviews chronologically with mode, status, key findings count.
Useful for the team to see review history at a glance.

```markdown
# Architecture Review Index

| Date | Mode | Subject | ADR opportunities | Status |
|------|------|---------|-------------------|--------|
| 2026-05-03 | capability | Real-time match notifications | 4 (3 HIGH) | 2 ADRs proposed |
| 2026-04-15 | brownfield-feature | PDF transcript export | 1 (1 MEDIUM) | resolved (no ADR needed) |
| 2026-01-12 | annual | 2026 review | 7 (3 HIGH, 2 MEDIUM, 2 LOW) | in progress |
```

## What this command does NOT do

- **Make decisions.** Reviews surface opportunities for
  decisions; ADRs make them.
- **Implement changes.** Reviews recommend follow-ups; the team
  executes them.
- **Auto-update the architectural identity manifest.** Manifest
  changes are deliberate, gated by ADR acceptance (per
  `engineer/architecture/decisions/_context.md`).
- **Replace `dependency` analysis.** Full-depth reviews invoke
  it; reviews aren't a substitute for it.
- **Replace team review.** The review structures the
  assessment; the team's judgment determines what to act on.

## Examples

```bash
# New capability assessment (most common)
/engineer:architecture:review capability "Real-time student match notifications"

# With ADR drafting
/engineer:architecture:review capability "Real-time student match notifications" --draft-adr

# Greenfield bootstrap
/engineer:architecture:review greenfield

# Brownfield feature review (default depth: standard)
/engineer:architecture:review brownfield-feature "PDF export for transcripts"

# Brownfield with full analysis
/engineer:architecture:review brownfield-feature "Real-time scoring service" --depth full

# Annual review
/engineer:architecture:review annual

# Annual with year-over-year comparison
/engineer:architecture:review annual --compare-to 2025-01-12
```
