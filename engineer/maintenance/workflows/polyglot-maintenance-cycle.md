---
type: workflow
description: Tactical multi-ecosystem maintenance cycle. Runs read-only quality scans across all detected ecosystems first, prioritizes findings, dispatches remediation and upgrade routines sequentially with strict-non-interleaving discipline, ends with full audit gate.
estimatedDuration: 1-3 days per cycle (varies with ecosystem count and finding volume)
phases: 8
prerequisites:
  - Maintenance calendar exists at `product/.pencil-maintenance-calendar.json` (run `/workflows:manage start engineer:maintenance-calendar-annual` first if not)
  - Project has at least one detectable ecosystem (npm, gradle, maven, infra)
  - Working directory is clean (no uncommitted changes)
  - User or agent has capacity to review per-routine PRs as they emerge
---

# Workflow — Polyglot Maintenance Cycle

> **When to use**: regular maintenance cadence per the maintenance
> calendar; or in response to security advisory triggering an
> unscheduled cycle; or when a quality scan flags drift exceeding
> tolerance thresholds.
>
> **When NOT to use**:
> - Single-ecosystem maintenance (run the specific routine
>   directly: `/engineer:maintenance:upgrades:npm-deps`)
> - Feature development with incidental refactoring (use
>   development workflows, not maintenance)
> - Strategic planning (use `engineer:maintenance-calendar-annual`)
> - One-off urgent fix (run the specific remediator)

## Outputs of a complete run

- **Ecosystem inventory** — which ecosystems are present and what
  topology each has (captured at Phase 1)
- **Prioritized routine queue** — what to run this cycle, in what
  order, with capacity-aware scoping (Phase 4)
- **Per-routine PRs** — each routine produces its own PR on its
  own branch (Phases 5-6)
- **Post-cycle audit report** — full audit run including Plane
  11 (maintenance drift); shows what improved (Phase 7)
- **Updated calendar state** — last-run timestamps, retro notes
  (Phase 8)
- **Next-cycle scheduling** — based on what was deferred and
  scan-cadence targets (Phase 8)

## Phase 1 — Repository topology census

Scan the repository for all maintainable ecosystems present.
This is the cycle's "Step 0.0" — runs before anything else.

```bash
echo "=== Maven roots ==="
find . -maxdepth 4 -name "pom.xml" -not -path "*/node_modules/*" \
  -not -path "*/target/*" \
  | while read pom; do
      grep -L '<parent>' "$pom" || true
    done

echo "=== Gradle roots ==="
find . -maxdepth 4 \( -name "settings.gradle" -o -name "settings.gradle.kts" \) \
  -not -path "*/node_modules/*" -not -path "*/build/*"

echo "=== npm projects ==="
find . -maxdepth 4 -name "package.json" -not -path "*/node_modules/*" \
  -not -path "*/.next/*" -not -path "*/dist/*" \
  | xargs grep -l '"name"' 2>/dev/null

echo "=== Terraform roots ==="
find . -maxdepth 4 -name "*.tf" -type f | xargs -n1 dirname | sort -u

echo "=== Infrastructure tooling ==="
ls docker-compose*.yml 2>/dev/null
ls .github/workflows/*.y*ml 2>/dev/null
find . -maxdepth 3 -name "Dockerfile*" -not -path "*/node_modules/*"
```

For each detected ecosystem, capture:
- Project root path(s)
- Inner topology (single-module / reactor / workspaces / nx /
  turbo / etc.)
- Last-run timestamps from `.pencil-maintenance-calendar.json`

Output the ecosystem inventory:

```
Repository Topology — <date>

Maven projects:
- maven-dependency/pom.xml (reactor: 4 modules — mtauth, pojos2tables,
                             requestcontext, ttcharts)
- Last cycle:                <date> | NEVER
- Cadence target:            <quarterly minor / monthly patch>

Gradle projects:
- app-service/ (single-module)
- Last cycle:                <date> | NEVER
- Cadence target:            <quarterly minor / monthly patch>

npm projects:
- app-ui/ (single-package, npm)
- Last cycle:                <date> | NEVER
- Cadence target:            <monthly patch / quarterly major>

Terraform roots:
- .infra/ + .infra-shared/ (multi-root)
- Last cycle:                <date> | NEVER
- Cadence target:            <quarterly minor>

Infrastructure tooling:
- Dockerfile (1 file)
- docker-compose*.yml (3 files)
- .github/workflows/ (5 workflow files)
- Last cycle:                <date> | NEVER
```

**Mark complete**: `/workflows:manage complete topology-census`

## Phase 2 — Capacity check

Establish how much maintenance time is available this cycle.
This is separate from feature-development capacity and should be
calibrated honestly.

Read from `.pencil-maintenance-calendar.json`:
- Allocated maintenance hours this cycle
- 70% capacity ratchet (leave slack for unplanned work)
- Compliance-driven non-negotiables for this period

Surface to the user:

```
Cycle Capacity — <month>

Allocated hours:           <N>
70% planning ratchet:      <N * 0.7>  (recommended planning ceiling)
Compliance non-negotiables:
  - <e.g., security scans required by FERPA: biweekly>
  - <e.g., critical CVE remediation within 30 days>

Available for elective work: <N * 0.7> - <compliance hours>
```

If capacity is below the threshold needed for compliance
non-negotiables, escalate immediately — compliance work blocks
elective maintenance until resolved.

**Mark complete**: `/workflows:manage complete capacity-check`

## Phase 3 — Quality scan dispatch (read-only)

Run the read-only scans across all ecosystems to inventory
findings. **This phase makes no changes to the codebase.** It
produces a unified findings report.

For each detected ecosystem:

### npm projects
```bash
cd <npm-root>
npm outdated --json > /tmp/npm-outdated-<root>.json 2>/dev/null
npm audit --json > /tmp/npm-audit-<root>.json 2>/dev/null
```

### Gradle projects
```bash
cd <gradle-root>
./gradlew dependencyUpdates -Drevision=release > /tmp/gradle-outdated-<root>.txt 2>&1
./gradlew dependencyCheckAnalyze > /tmp/gradle-vulns-<root>.txt 2>&1 || true
```

### Maven projects
```bash
cd <maven-root>
./mvnw versions:display-property-updates -DallowMilestoneUpdates=false -DallowSnapshots=false > /tmp/maven-property-updates-<root>.txt
./mvnw versions:display-dependency-updates -DallowMilestoneUpdates=false -DallowSnapshots=false > /tmp/maven-dependency-updates-<root>.txt
./mvnw versions:display-plugin-updates -DallowMilestoneUpdates=false -DallowSnapshots=false > /tmp/maven-plugin-updates-<root>.txt
./mvnw versions:display-parent-updates -DallowMilestoneUpdates=false -DallowSnapshots=false > /tmp/maven-parent-updates-<root>.txt
./mvnw dependency-check:aggregate > /tmp/maven-vulns-<root>.txt 2>&1 || true
```

### Terraform roots
```bash
for tf_root in <list>; do
  cd "$tf_root"
  terraform providers > /tmp/tf-providers-${tf_root#.}.txt 2>&1
done
```

### Lint / quality scans (per-ecosystem)
```bash
# npm projects
cd <npm-root>
npx biome lint . --diagnostic-level=error > /tmp/biome-errors-<root>.txt 2>&1

# Atomic-design (when project uses atomic-design)
# Run reconnaissance only via the routine's Phase 0
```

Aggregate all findings into a unified report:

```
Unified Findings Report — <date>

== SECURITY VULNERABILITIES ==
Critical:    <count> (across <N> ecosystems)
High:        <count>
Medium:      <count>
Low:         <count>
Details:     <CVE list with affected packages>

== OUTDATED DEPENDENCIES ==
npm:
  Patches:     <count>
  Minors:      <count>
  Majors:      <count>
gradle:
  Patches:     <count>
  Minors:      <count>
  Majors:      <count>
maven:
  Property updates:    <count>
  Dependency updates:  <count>
  Plugin updates:      <count>
  Parent update:       <yes/no>
infra:
  Terraform:   <count>
  Actions:     <count>
  LocalStack:  <yes/no>
  Docker base: <count>

== CODE QUALITY ==
Biome errors:       <count>
Biome warnings:     <count>
Atomic-design violations: <count> (if project uses atomic-design)
Component duplicates:     <count> (when scan available)
```

**Mark complete**: `/workflows:manage complete quality-scan`

## Phase 4 — Prioritize

Build the prioritized routine queue based on findings + priorities
+ time budget. Apply these rules:

### Compliance non-negotiables first

Any scan with compliance-driven cadence that's overdue runs first.
Examples:
- Critical CVEs → security remediation (elevates upgrade
  groupings by one tier per `upgrades/_context.md`)
- FERPA-mandated biweekly security scans missed → run scan now

### Critical security vulns next

Critical/High CVEs that aren't compliance-mandated still get
priority. These elevate the affected upgrade routine's groupings
but never jump the risk-tier queue (per `upgrades/_context.md`).

### Routine cadence targets

Per the calendar, ecosystems have target cadences:
- npm patches monthly → if last-run >30 days, prioritize
- gradle/maven minors quarterly → if last-run >90 days, prioritize
- Major reviews quarterly → if last-run >90 days, prioritize

### Cosmetic findings defer

Lint findings (warn-level), atomic-design warnings, low-severity
dedup matches: defer if capacity is tight. They become next
cycle's queue.

### Capacity-aware scoping

The queue must fit in the 70% capacity allocation from Phase 2.
If full queue exceeds capacity:
1. Defer cosmetic items first
2. Then defer non-compliance major bumps
3. Then defer routine-cadence items past their target
4. Compliance items NEVER defer

Surface the prioritized queue:

```
Prioritized Routine Queue — <date>

Capacity: <N> hours (70% ratchet applied)

1. [SECURITY] /engineer:maintenance:upgrades:infra-deps terraform
   → Critical CVE in hashicorp/aws (affects 2 roots)
   → Estimated: 2h

2. [COMPLIANCE] Run biweekly security scan
   → Overdue by 5 days
   → Estimated: 30 min (via Phase 3 scan; already done above)

3. [CADENCE] /engineer:maintenance:upgrades:npm-deps app-ui
   → Last run 35 days ago; cadence target monthly
   → 8 patches + 12 minors + 0 majors → light cycle
   → Estimated: 3h

4. [CADENCE] /engineer:maintenance:upgrades:maven-deps maven-dependency
   → Last run 88 days ago; cadence target quarterly
   → 4 minor groupings; Spring Boot patch available
   → Estimated: 4h

5. [REMEDIATION] /engineer:maintenance:remediation:biome-issues
   → 23 lint errors + 47 warnings detected
   → Estimated: 2h

DEFERRED (over capacity):
- /engineer:maintenance:upgrades:gradle-deps app-service (Tier 3 majors)
- /engineer:maintenance:remediation:component-dedup (12 candidates;
   non-blocking)

Queue total:               11.5h (within capacity)
Compliance items covered:  YES
```

**Mark complete**: `/workflows:manage complete prioritize`

## Phase 5 — Sequential execution

Execute the prioritized routines **in order**, **on separate
branches**, with **strict non-interleaving** between sister
upgrade routines.

For each routine in the queue:

### State machine guard

Before starting:

```
Active sister branches check:
- chore/npm-upgrade-<date>:    <open|closed>
- chore/gradle-deps-upgrade-<date>: <open|closed>
- chore/maven-deps-upgrade-<date>:  <open|closed>
- chore/infra-deps-upgrade-<date>:  <open|closed>

Status: <PROCEED | BLOCKED on <branch>>
```

If a sister branch is open (committed but not merged), wait. The
state machine refuses to start until the open branch is merged
or explicitly closed.

### Branch creation

```bash
# Per routine convention
git checkout main && git pull
git checkout -b chore/<routine-slug>-<YYYY-MM-DD>
```

Branch names:
- `/engineer:maintenance:upgrades:npm-deps` → `chore/npm-upgrade-<date>`
- `/engineer:maintenance:upgrades:gradle-deps` → `chore/gradle-deps-upgrade-<date>`
- `/engineer:maintenance:upgrades:maven-deps` → `chore/maven-deps-upgrade-<date>`
- `/engineer:maintenance:upgrades:infra-deps` → `chore/infra-deps-upgrade-<date>`
- Remediators: `chore/<remediator-slug>-<date>`

### Dispatch

Run the routine. The routine has its own phases and gates;
the cycle workflow doesn't second-guess them.

```bash
/engineer:maintenance:<sub-namespace>:<slug> [<scope-arg>]
```

The routine runs to completion (all groupings handled or skipped)
or fails. On failure:
- Don't auto-revert (per archetype guard rails)
- Document the failure in the cycle report
- The branch remains for human review
- Continue to the next routine in the queue

### Per-routine commit + PR

When the routine completes (or partially completes with
documented skips):

```bash
git push -u origin chore/<routine-slug>-<date>
gh pr create --title "chore: <routine-slug> upgrade <date>" --body "<routine report>"
```

Update the cycle's tracking state:

```json
{
  "cycle_id": "polyglot-maintenance-cycle-2026-05-03",
  "routines_completed": [
    {
      "routine": "infra-deps",
      "branch": "chore/infra-deps-upgrade-2026-05-03",
      "pr": "https://github.com/.../pull/123",
      "status": "completed",
      "skipped_groupings": []
    },
    {
      "routine": "npm-deps",
      "branch": "chore/npm-upgrade-2026-05-03",
      "pr": "https://github.com/.../pull/124",
      "status": "completed",
      "skipped_groupings": []
    }
  ],
  "routines_pending": ["maven-deps", "biome-issues"],
  "started_at": "2026-05-03T08:00:00Z"
}
```

**Mark complete after each routine**: `/workflows:manage complete execute-<routine-slug>`

## Phase 6 — Coordinated review

After all routines in the queue are dispatched, surface what's
ready for review across all PRs from this cycle:

```
Cycle PRs Ready for Review — <date>

| Routine | PR | Status | Reviewer Domain |
|---------|----|--------|-----------------|
| infra-deps | #123 | open | SRE |
| npm-deps | #124 | open | FE |
| maven-deps | #125 | open | JVM expert |
| biome-issues | #126 | open | FE |

Cross-domain review pattern:
- npm-deps (#124) and biome-issues (#126) can be reviewed in
  parallel (same FE reviewer pool)
- maven-deps (#125) review independently (JVM expert)
- infra-deps (#123) review independently (SRE)
```

This is informational — the workflow doesn't auto-merge or
auto-assign reviewers. It surfaces the coordinated state.

**Mark complete**: `/workflows:manage complete coordinated-review`

## Phase 7 — Post-cycle verification

Once all PRs are merged (cycle's natural ending), run the full
audit including Plane 11 (maintenance drift):

```bash
/audit --strict-maintenance
```

The audit verifies:
- Plane 11a — remediation backlog (issues found by scans not yet
  acted on)
- Plane 11b — upgrade lag (per ecosystem: gradle / maven / npm /
  infra — versions behind target)
- Plane 11c — routine-running frequency (last-run timestamps from
  `.pencil-maintenance-calendar.json` vs cadence targets)
- Plane 11d — post-cleanup hardening (e.g., promoted Biome rules
  staying promoted; BOM-managed deps not regressing to inline
  pins)
- Plane 11e — cycle gap detection (when last polyglot-maintenance-cycle
  ran; overdue surfaces drift)

Audit findings of severity ≥ fail block cycle completion until
addressed.

Document the post-cycle improvements:

```
Post-Cycle Audit — <date>

Plane 11 — Maintenance Drift:
- 11a (remediation backlog):     before <X> → after <Y>
- 11b (upgrade lag):
  - npm:    before <X> patches behind → after <Y>
  - gradle: before <X> minors behind → after <Y>
  - maven:  before <X> minors behind → after <Y>
  - infra:  before <X> patches behind → after <Y>
- 11c (routine-running frequency): all green | <list overdue>
- 11d (post-cleanup hardening):    no regressions
- 11e (cycle gap detection):       cycle ran on schedule
```

**Mark complete**: `/workflows:manage complete post-cycle-audit`

## Phase 8 — Schedule next cycle

Update the maintenance calendar with cycle outcomes:

```json
{
  "cycle_history": [
    {
      "cycle_id": "polyglot-maintenance-cycle-2026-05-03",
      "completed_at": "2026-05-04T17:00:00Z",
      "routines_run": ["infra-deps", "npm-deps", "maven-deps", "biome-issues"],
      "routines_deferred": ["gradle-deps", "component-dedup"],
      "skipped_groupings": [],
      "audit_plane_11_result": "clean",
      "retro_notes": "Spring Boot 3.5.5 → 3.6.0 deferred for dedicated migration PR"
    }
  ],
  "last_run_per_ecosystem": {
    "npm": "2026-05-04",
    "gradle": "2026-02-04",
    "maven": "2026-05-04",
    "infra": "2026-05-04"
  }
}
```

Determine next cycle date based on:
- Deferred items + their cadence targets
- Compliance scan windows
- Upcoming cadence ticks (e.g., next monthly cycle ~30 days out)

Schedule the next cycle:

```
Next Cycle Scheduled — <date>

Triggered by: <cadence | compliance | event>

Anticipated queue:
- gradle-deps cadence (deferred from this cycle)
- npm-deps monthly tick
- biome-issues drift if accumulated

Estimated capacity needed: <N> hours
```

**Mark complete**: `/workflows:manage complete schedule-next`

## Cycle complete

The workflow ends. Summary report:

```
Cycle Summary — <date>

Routines run:        <N>
Routines deferred:   <N>
PRs opened:          <N>
PRs merged:          <N>
Vulnerabilities resolved: <count>
Outdated deps resolved:   <count>
Audit Plane 11 result:    clean | <N findings>
Cycle duration:           <hours>
Capacity used vs allocated: <X> / <Y> hours

Next cycle: <date>
```
