---
description: Analyze dependencies at service and package levels — find cycles, measure coupling, identify hotspots, surface anomalies. Distinct from maintenance:upgrades:* which focuses on versions; this command focuses on STRUCTURAL relationships. Outputs dependency reports with date stamps for tracking drift over time.
argument-hint: <scope: services|packages|all> [--cycles-only] [--coupling-threshold N] [--compare-to <previous-report-date>]
allowed-tools: Read, Write, Edit, Bash
---

Analyze structural dependencies. Two layers:

- **Service-level**: which services call which, blast radius
  analysis, cross-service cycle detection
- **Package-level**: which packages/modules depend on which
  within a service, coupling metrics, hotspot identification

This is **structural** analysis. The version-management concern
(what versions of what dependencies are pinned) belongs to
`/engineer:maintenance:upgrades:*`. The two are complementary; this
command identifies "the foo service has 12 callers — should it
be split?" while `maintenance:upgrades:gradle-deps` identifies
"foo service uses Spring Boot 3.2.1; latest is 3.4.0".

Reports are date-stamped because dependency graphs evolve;
comparing reports across time surfaces drift. Audit Plane 12d
consumes these reports.

## Phase 0: discovery

1. Read `product/.pencil-architecture.json`. Note `style`,
   container list, and tech stack.
2. Read `product/.pencil-decisions.json`. Surface accepted ADRs
   with tags: `dependencies`, `coupling`, `architecture-style`.
3. Run topology detection per `engineer/maintenance/_context.md` to
   identify project root and ecosystems present.
4. List existing dependency reports in `design/dependency-reports/`.

## Service-level analysis

### Phase 1: service inventory

Identify services. Sources of truth:

1. Container diagram (if exists at
   `design/diagrams/container-*.mmd`)
2. Architectural identity manifest's container list
3. Filesystem detection (top-level directories with their own
   build configuration: `app-ui/`, `app-service/`, `services/<name>/`,
   etc.)

Cross-check the three. If they diverge, surface for
reconciliation:

> Services per container diagram: app-ui, app-service, modules
> Services per filesystem: app-ui, app-service, maven-dependency,
>   .infra
> Services per architecture manifest: app-ui, app-service,
>   modules, db, queue, cdn
>
> Mismatches detected. Resolve before continuing? Manifest is
> typically the canonical source.

### Phase 2: edge inventory

For each pair of services, identify dependency edges:

- **HTTP/REST calls** — grep for hostnames, base URLs,
  service-discovery patterns
- **Database queries** — which service connects to which DB
- **Message queue producers/consumers** — who publishes / who
  subscribes
- **Shared libraries** — internal packages with cross-service
  consumption (this is where service-level meets package-level)
- **gRPC clients/servers** — which service generates a stub for
  which other service's proto

Detection is heuristic; the user confirms each edge:

> Detected edge: app-ui → app-service (HTTP, base URL from
>   `NEXT_PUBLIC_API_URL`)
> Confirm? [Y/n/edit]

### Phase 3: graph construction

Build a directed graph: nodes = services, edges = dependencies.
Annotate edges with:

- **Type** (sync, async, data, library)
- **Volume** (estimated request rate, if knowable)
- **Criticality** (does failure of the edge break the source
  service? — surfaced via prompts)

### Phase 4: cycle detection

Run Tarjan's algorithm (or similar) to detect strongly connected
components. Any SCC with > 1 node is a cycle.

For each cycle, surface:

```
CYCLE DETECTED:
  app-service → modules → app-service
  Type:        sync (Spring DI)
  Volume:      in-process (always)
  Severity:    info (in-process cycles are common)

CYCLE DETECTED:
  billing-service → notification-service → billing-service
  Type:        async (SQS)
  Volume:      ~100 msg/min
  Severity:    warn (cross-service async cycles indicate
                possible coupling issue)
```

In-process cycles (within a single service's modules) are
typically information-only. Cross-service cycles warrant ADR
discussion.

### Phase 5: blast radius analysis

For each service, compute blast radius:

- **Downstream blast radius**: services that depend on this one
  (transitive)
- **Upstream blast radius**: services this one depends on
  (transitive)
- **Centrality**: how many other services pass through this one
  in the dependency graph

Surface high-blast-radius services:

```
HIGH BLAST RADIUS:
  app-service has 8 downstream dependents (transitive)
  Implications:
    - Failures in app-service cascade widely
    - Changes to app-service need careful coordination
    - Splitting app-service might reduce blast radius
  ADR opportunity: document service splitting strategy if
    appropriate. Run /engineer:architecture:decisions:propose? [y/N]
```

### Phase 6: anomaly surfacing

Detect anomalies:

- **Bypass dependencies**: A → C exists when A → B → C is the
  expected path (direct dependency that should be indirect)
- **Reverse dependencies**: lower-tier service depends on
  higher-tier (e.g., shared library depends on application
  service)
- **Phantom dependencies**: declared but unused
- **Hidden dependencies**: used but not declared (e.g.,
  database access via shared schema, undocumented filesystem
  reads)

## Package-level analysis

### Phase 1: package/module inventory

Per service, identify the package/module structure. Per ecosystem:

- **Maven**: parent POM `<modules>` declarations
- **Gradle**: `settings.gradle` `include` declarations
- **npm/pnpm/yarn workspaces**: workspace declarations in root
  package.json or pnpm-workspace.yaml
- **Nx**: `project.json` files
- **Turborepo**: package.json files in monorepo
- **Java packages within a single module**: directory structure
  under `src/main/java/`
- **TypeScript modules**: directory structure under `src/`,
  `lib/`, `app/`

### Phase 2: import/dependency edge inventory

For each ecosystem, parse import statements / dependency
declarations:

- **Java**: `import` statements per file
- **Kotlin**: `import` statements
- **TypeScript/JavaScript**: `import` and `require` statements
- **Python**: `import` and `from ... import`
- **Go**: package imports
- **Rust**: `use` statements

Build a directed graph: nodes = packages/modules, edges =
imports.

### Phase 3: coupling metrics

For each package, compute:

- **Afferent coupling (Ca)**: number of packages that depend on
  this one
- **Efferent coupling (Ce)**: number of packages this one
  depends on
- **Instability (I)**: Ce / (Ca + Ce). Range 0-1. High = volatile
  (depends on many things). Low = stable (many things depend on
  it).
- **Abstractness (A)**: ratio of abstract types / interfaces to
  total types. (For statically typed languages; skipped for
  dynamic.)
- **Distance from main sequence (D)**: |A + I - 1|. Robert
  Martin's metric. High = either "useless" (high abstract, no
  users) or "pain" (high concrete, high coupling).

These metrics aren't goal posts; they're indicators. A package
with high Ca and low I is normal for a foundational utility.
Surface anomalies, not absolutes:

```
COUPLING HOTSPOT:
  modules/mtauth-module
  Afferent: 7 (many things depend on this)
  Efferent: 12 (depends on many things)
  Instability: 0.63 (somewhat unstable)
  Abstractness: 0.18 (mostly concrete)
  Distance from main sequence: 0.45 (pain zone)

  Implication: this module is both heavily depended upon AND
  heavily depending on others. Changes here ripple widely AND
  it's affected by changes elsewhere.

  Mitigations to consider:
    - Extract a stable interface; move volatile parts elsewhere
    - Reduce efferent coupling (depend on fewer things)
    - Document via ADR if this coupling is intentional
```

### Phase 4: cycle detection (package level)

Same algorithm as service-level. In-package cycles are typically
problems (the language usually catches them at compile/import
time, but cross-module cycles in monorepos may evade detection).

### Phase 5: depth analysis

Measure dependency tree depth:

- **Maximum depth**: longest path from leaf to root
- **Wide vs deep**: many shallow dependencies vs few deep ones

Deep dependency chains are fragility signals — a change at the
bottom forces work all the way up.

## Phase 6: report generation

Generate a structured report at:

- `design/dependency-reports/<YYYY-MM-DD>-services.md` (for
  service-level)
- `design/dependency-reports/<YYYY-MM-DD>-packages-<service>.md`
  (for package-level, per service)
- `design/dependency-reports/<YYYY-MM-DD>-summary.json`
  (machine-readable, for audit Plane 12d consumption)

Report sections:

- **Executive summary** — top findings
- **Service graph** (mermaid)
- **Cycle inventory** (with severity)
- **Blast radius rankings**
- **Coupling hotspots**
- **Anomalies**
- **Trend (vs previous report)** — if `--compare-to` was used
- **ADR opportunities** — material findings worth ADR-ifying
- **Recommended follow-up**

## Phase 7: comparison mode (if `--compare-to`)

If `--compare-to <date>` is provided, load the previous report
and surface deltas:

- New services / removed services
- New cycles / cycles broken
- Coupling shifts (services becoming more or less coupled)
- New anomalies / resolved anomalies

The comparison is consumed by audit Plane 12d to detect
regressions between annual reviews.

## Phase 8: ADR cross-reference

For findings that exceed thresholds, surface ADR opportunities:

- Cycles that aren't intentional and aren't trivially breakable
- High-blast-radius services that the team hasn't formally
  designed for high availability
- Coupling hotspots flagged across multiple reports without
  resolution

For each, structured prompt:

> Finding: app-service has blast radius 8; no ADR documents
> the team's strategy for handling its failures.
>
> Recommend running:
>   /engineer:architecture:decisions:propose "Failure-handling strategy
>    for app-service as central coordinator" --tags
>    architecture,resilience

## Cross-namespace effects

- **`architecture:diagrams`** — dependency analysis can drive
  diagram updates (a missing edge in a diagram surfaces here)
- **`maintenance:upgrades:*`** — coordinated upgrades respect
  service dependency order (downstream services may need to
  upgrade before upstream consumers)
- **`maintenance:remediation:component-dedup`** — package-level
  duplication surfaced here (same component in multiple places)
  feeds dedup work
- **`product:audit` Plane 12d** — consumes the JSON summary
  report

## Threshold tuning

Defaults:

- Service blast radius warning: 5+ downstream dependents
- Package coupling pain: D > 0.5
- Package instability + abstractness mismatch: |A + I - 1| > 0.4

Override via `--coupling-threshold N` (the threshold number is
context-specific to the metric being filtered).

## What this command does NOT do

- **Manage versions.** That's `maintenance:upgrades:*`.
- **Refactor code.** Identifies structural issues; refactor is
  the team's work.
- **Auto-create ADRs.** Surfaces opportunities; user decides
  what's worth documenting.
- **Cross compile/runtime boundaries automatically.** The
  command doesn't autodetect that a Java service and a
  TypeScript service share an integration via shared DTOs from
  a generator unless directed.

## Examples

```bash
# Full dependency analysis (services + packages)
/engineer:architecture:dependency all

# Service-level only
/engineer:architecture:dependency services

# Package-level focus, only flag cycles
/engineer:architecture:dependency packages --cycles-only

# Compare to last quarter's analysis
/engineer:architecture:dependency all --compare-to 2026-02-15
```
