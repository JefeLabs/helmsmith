# Architecture — Namespace Context (`engineer/architecture/`)

> Read this in addition to `product/strategy/_context.md` whenever any
> `/engineer:architecture:*` command runs. Sub-namespace `_context.md`
> files (`engineer/architecture/decisions/_context.md`) extend this with
> sub-domain-specific conventions.
>
> The `engineer/architecture/` namespace covers software-architecture
> concerns: documenting decisions (ADRs), system diagrams, API
> contracts, data modeling, integration patterns, dependency
> analysis, architecture review, and migration planning. Forward-
> motion (proposing) AND retrospective (capturing what already
> exists).

## What this namespace is for

Architecture work is the part of engineering that's **between**
"what should we build" (product / UX / brief) and "implement this"
(code). It's the layer where systemic decisions get made and
documented:

- **Should this service own its database, or share?**
- **Sync request-response or async messaging?**
- **Tenant isolation: schema-per-tenant, row-level, or separate
  databases?**
- **Where do integration patterns belong on the spectrum from
  "tight coupling" to "fully decoupled"?**

These decisions outlive their authors. They need to be findable,
challengeable, and (when contested) supersedeable. The
architecture namespace gives a project the tools to do that
deliberately.

## Architecture vs product vs pencil

The skillz suite has overlapping-but-distinct namespaces. Be
clear about which one owns what:

| Namespace | Concern |
| --- | --- |
| `product/strategy/` | **Process orchestration** — briefs, research (market/competitor), audit, scaffolding. Tool-agnostic design system process. |
| `product/design/` | **Visual design system** — foundations, components, patterns, templates. Design as a `.pen` source-of-truth. |
| `frameworks/heroui/` | **Implementation stack** — React component generation, build pipeline. |
| `market/` | **Cross-channel marketing** — voice, email, ads, social, PR. |
| `engineer/architecture/` | **System architecture** — ADRs, diagrams, API contracts, data modeling, integration patterns. The how-do-the-pieces-fit-together layer. |
| `ux/` | **Human-centered research** — personas, journey maps, user research (distinct from market research), usability testing. |
| `engineer/maintenance/` | **Quality routines** — remediation, dependency upgrades, audit drift. |

Architecture is **structural**: how systems are organized, how
services talk, what data flows where. Pencil is **visual**: how
interfaces look. UX is **experiential**: how users feel. Product
is **procedural**: how the work gets done. They're orthogonal
concerns; commands in different namespaces don't supplant each
other.

## Sub-namespaces in `engineer/architecture/`

### `decisions/` — ADR lifecycle tooling

Architecture Decision Records (ADRs) are versioned, immutable
documents capturing why a structural choice was made. They have a
distinct lifecycle (proposed → accepted → superseded /
deprecated) and a distinct file format. The sub-namespace
contains:

- **`/engineer:architecture:decisions:propose`** — draft a new ADR with
  full context, alternatives, decision, consequences
- **`/engineer:architecture:decisions:refine`** — iterate on a proposed
  ADR before acceptance
- **`/engineer:architecture:decisions:accept`** — mark an ADR accepted
  (locks the decision; further changes require a superseding ADR)
- **`/engineer:architecture:decisions:supersede`** — create a new ADR that
  replaces an accepted one; updates the old ADR's status
- **`/engineer:architecture:decisions:retrofit`** — capture undocumented
  past decisions as ADRs (for projects where decisions were made
  but never written down)

See `engineer/architecture/decisions/_context.md` for ADR file format,
status taxonomy, and ID conventions.

## Commands at namespace root

Beyond decisions/, the architecture namespace has these flat
commands:

- **`/engineer:architecture:diagrams`** — C4 model diagrams (context,
  container, component), sequence diagrams, data flow diagrams
- **`/engineer:architecture:api-design`** — API contract design,
  versioning strategy, deprecation patterns
- **`/engineer:architecture:data-model`** — entity-relationship modeling,
  schema design, multi-tenancy strategy selection
- **`/engineer:architecture:integration`** — integration pattern selection
  and application (sync request-response, async messaging,
  event-driven, batch, etc.)
- **`/engineer:architecture:dependency`** — service-level and package-
  level dependency analysis (cycles, coupling, hotspots);
  distinct from `maintenance:upgrades:*` which focuses on
  versions, not structural relationships
- **`/engineer:architecture:review`** — fitness function evaluation;
  periodic review of architecture health against documented
  intent
- **`/engineer:architecture:migrate`** — architectural migration planning
  (e.g., monolith → microservices, sync → event-driven, single-
  tenant → multi-tenant). Distinct from `product:migrate-*`
  which migrates design-system tooling.

## Runtime manifests

### `product/.pencil-architecture.json`

The project's architectural identity. Holds:

```jsonc
{
  "version": 1,
  "lastUpdated": "2026-05-03T12:00:00Z",
  "style": "modular-monolith",  // or "microservices", "soa",
                                 // "event-driven", "serverless",
                                 // "hybrid", etc.
  "integrationPatterns": {
    "default": "sync-request-response",
    "byContext": {
      "user-events": "async-messaging",
      "long-running": "queue-based"
    }
  },
  "multiTenancy": {
    "strategy": "schema-per-tenant",
    "isolation": "logical",
    "constraints": ["FERPA", "COPPA"]
  },
  "techStack": {
    "languages": ["java", "typescript"],
    "primaryRuntime": "spring-boot-3",
    "uiFramework": "next.js-15",
    "database": "aurora-serverless-v2-postgres",
    "messaging": "sqs",
    "cache": "redis"
  },
  "fitnessTargets": {
    "deploymentFrequency": "daily",
    "leadTimeForChanges": "< 1 day",
    "meanTimeToRecovery": "< 1 hour",
    "changeFailureRate": "< 15%"
  }
}
```

Established by `/engineer:architecture:diagrams` (which captures the
overall structure as it documents containers and components) or
explicitly via `/engineer:architecture:review` first run. Updated when
material architectural changes happen (new service, integration
pattern shift, multi-tenancy migration, etc.).

### `product/.pencil-decisions.json`

Index of all ADRs in the project:

```jsonc
{
  "version": 1,
  "decisions": [
    {
      "id": "ADR-001",
      "title": "Schema-per-tenant for multi-tenancy isolation",
      "status": "accepted",
      "proposedDate": "2024-08-15",
      "acceptedDate": "2024-08-22",
      "supersededBy": null,
      "supersedes": null,
      "tags": ["multi-tenancy", "data", "compliance"],
      "filePath": "design/decisions/ADR-001-schema-per-tenant.md"
    },
    {
      "id": "ADR-007",
      "title": "Migrate from sync to event-driven for user-events",
      "status": "proposed",
      "proposedDate": "2026-04-30",
      "acceptedDate": null,
      "supersededBy": null,
      "supersedes": null,
      "tags": ["integration", "events", "performance"],
      "filePath": "design/decisions/ADR-007-event-driven-user-events.md"
    }
  ]
}
```

Maintained by `/engineer:architecture:decisions:*` commands. Read by
`/audit` Plane 12 sub-checks for ADR coverage and drift.

### `design/decisions/`

Directory holding individual ADR files. Each ADR is a standalone
markdown file at `design/decisions/ADR-NNN-kebab-case-slug.md`.
The directory is created on first ADR proposal.

## Audit plane

Plane 12 — Architecture drift (in `product/strategy/audit.md`):

- **12a ADR coverage** — significant architectural decisions
  visible in code without corresponding ADRs (e.g., a new
  integration pattern adopted, a tenancy strategy shift)
- **12b ADR drift** — accepted ADRs whose implementation has
  diverged (the code says one thing, the ADR says another)
- **12c Diagram staleness** — diagrams referencing components,
  containers, or dependencies that no longer exist
- **12d Dependency hygiene** — service-level cycles, unexpected
  cross-service dependencies, package-level coupling anomalies
- **12e Pattern fitness** — fitness target regression
  (deployment frequency, lead time, MTTR, change failure rate);
  anti-patterns introduced since last review

## Workflows

`engineer/architecture/workflows/` holds two workflows:

- **`engineer:adr-cycle`** — ADR lifecycle workflow (propose
  → discussion → refine → accept OR supersede); orchestrates the
  full decision flow with stakeholder review checkpoints
- **`engineer:architecture-review-annual`** — strategic
  architecture review aligned with the maintenance and marketing
  calendar cadence; surfaces drift, plans migrations, validates
  fitness targets

## Conventions

### ADR numbering

Sequential, zero-padded to 3 digits, prefixed `ADR-`:
`ADR-001`, `ADR-002`, ..., `ADR-099`, `ADR-100`. Numbers are
assigned at proposal time and never reused. Superseded ADRs
retain their original number.

### ADR file naming

`design/decisions/ADR-NNN-kebab-case-slug.md`. The slug is
derived from the title at proposal time; it doesn't change even
if the title is later refined. Example:
`ADR-001-schema-per-tenant.md` for "Schema-per-tenant for
multi-tenancy isolation".

### Status transitions

```
                    ┌──────────────┐
                    │   proposed   │
                    └───┬───────┬──┘
                        │       │
                  refine│       │abandon
                        │       │
                        ▼       ▼
              ┌──────────┐  ┌──────────┐
              │ accepted │  │ rejected │
              └────┬─────┘  └──────────┘
                   │
       ┌───────────┼───────────┐
       │           │           │
supersede     deprecate     (terminal)
       │           │
       ▼           ▼
  ┌────────────┐ ┌──────────────┐
  │ superseded │ │  deprecated  │
  └────────────┘ └──────────────┘
```

- **proposed** — drafted, under discussion. Mutable.
- **rejected** — proposed, considered, declined. Terminal.
  Kept for the historical record.
- **accepted** — decision in force. Immutable except for
  status transitions.
- **superseded** — replaced by a newer ADR (which references
  this one). Status auto-updated by
  `/engineer:architecture:decisions:supersede`.
- **deprecated** — explicitly retired without replacement.
  The decision no longer applies but no new decision was made.

### Diagram conventions

When `/engineer:architecture:diagrams` produces diagrams, they're stored
at `design/diagrams/<level>-<scope>.<format>`. Levels: `context`
(C4 L1), `container` (C4 L2), `component` (C4 L3), `sequence`
(interaction-specific), `data-flow` (data movement). Format:
`mermaid` (default) or `plantuml`.

### Dependency analysis output

`/engineer:architecture:dependency` writes structured findings to
`design/dependency-report-<YYYY-MM-DD>.json` and a
human-readable summary to
`design/dependency-report-<YYYY-MM-DD>.md`. Reports are dated
because the dependency graph evolves; comparing reports across
time surfaces drift.

## Cross-namespace coordination

### With `product/strategy/`

Architecture decisions inform the design system process. When a
brief mentions architectural constraints (e.g., "must integrate
with existing event bus"), the brief authors should reference the
relevant ADR. `/product:strategy:brief` reads `.pencil-decisions.json`
when generating context.

### With `engineer/maintenance/`

Architecture review (Plane 12) and maintenance review
(Plane 11) are complementary — Plane 11 catches version drift,
Plane 12 catches structural drift. The annual architecture review
workflow may surface migration work that maintenance routines
will execute.

`maintenance:upgrades:*` routines respect ADRs that pin specific
library or framework choices. If ADR-005 says "Spring Boot 3.x
because of Jakarta EE migration", the gradle/maven upgrade
routines stay within Spring Boot 3.x until the ADR is
superseded.

### With `ux/`

UX research informs architectural decisions, especially around
data flow and user-facing performance. Personas with offline
needs change integration patterns. Journey maps with critical-
path latency requirements affect caching and async strategies.
Cross-reference: a journey map's "moments of truth" become
architectural fitness targets.

### With `product/design/`

Generally orthogonal — pencil cares about visual design,
architecture cares about system structure. The exception is at
the integration boundary: when an architectural decision
constrains visual implementation (e.g., "no client-side state
management beyond React state" implies pencil patterns can't
assume Redux), document it as an ADR and reference from the
relevant pencil pattern's `_context`.

## Anti-patterns

- **ADRs as design docs** — ADRs document **decisions**, not
  designs. A 30-page document explaining how a feature works is
  not an ADR; it's a design doc. ADRs are typically 1-3 pages,
  focused on the choice and its consequences.
- **Architecture-as-aspiration** — `.pencil-architecture.json`
  should reflect what the project IS, not what someone hopes it
  will be. If the codebase is a modular monolith and someone
  writes "microservices" in the manifest, audit Plane 12e will
  flag the gap.
- **Diagram-driven development without ADR backing** — diagrams
  show structure; ADRs explain why. A diagram alone doesn't
  capture the alternatives considered or the consequences
  accepted. When a diagram shows a non-obvious structure, there
  should be an ADR alongside it.
- **Retrofitting decisions that weren't actually decisions** —
  retrofit ADRs for past **deliberate** choices that just
  weren't documented. Don't retrofit accidents or
  default-behavior outcomes; those aren't decisions, and
  documenting them as such creates false history.
- **Skipping the supersede workflow** — when a decision changes,
  create a new ADR that supersedes the old one. Don't edit the
  old ADR's content; that destroys the historical record. The
  whole point of ADR-as-immutable is that future readers can
  trace why we did things differently then.
- **One ADR per micro-decision** — ADRs are for material
  decisions with non-trivial consequences. "We use camelCase for
  variable names" is a code style guide entry, not an ADR.
  Reserve ADRs for choices that are hard to reverse, that have
  cross-cutting impact, or that future engineers might
  reasonably question.
