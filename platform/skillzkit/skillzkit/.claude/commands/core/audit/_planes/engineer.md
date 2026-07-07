# Engineer persona — Audit plane definitions

> Plane definitions consumed by `/audit` for the engineer
> persona. Covers maintenance drift (remediation backlog,
> upgrade lag, routine cadence, post-cleanup hardening, cycle
> gap). Architecture drift (Plane 12) and development drift
> (Plane 13) will be added when those namespaces are built.
>
> Each plane below is a self-contained check sequence the audit
> dispatcher invokes. See `core/audit/audit.md` for the
> dispatch shell.

## Persona scope

| Plane | Name |
|-------|------|
| 11 | Maintenance drift |
| 12 | Architecture drift (planned) |
| 13 | Development drift (planned) |

## Plane 11 — Maintenance drift

Cadence-aware audit of maintenance health: are quality routines
running on schedule? Is dependency lag accumulating? Have
post-cleanup hardening efforts held? When was the last full
maintenance cycle?

This plane reads `product/.pencil-maintenance-calendar.json` (when
present) and per-ecosystem state to detect drift. Run it every
cycle (per the calendar's `audit.plane_11_per_cycle: true`), or
on-demand via `--strict-maintenance` flag.

### 11a — Remediation backlog

Issues found by quality scans (Biome lint, atomic-design rules,
component duplicates, security vulns) that haven't been addressed.

```bash
# npm projects
cd <npm-root>
npx biome lint . --diagnostic-level=error --max-diagnostics=5000 \
  2>&1 | grep -c '^lint/' || echo 0

npm audit --json 2>/dev/null \
  | jq '.metadata.vulnerabilities | to_entries | map(select(.value > 0)) | length'

# Atomic-design (when project uses it; routine's Phase 0 produces counts)
# Component dedup (run dedup discovery; capture candidate count)
```

Severity:
- 0 violations: ok
- 1-50 violations: info
- 51-200 violations: warn
- 201+ violations: fail

The `--strict-maintenance` flag escalates warn → fail.

### 11b — Upgrade lag (per ecosystem)

Versions behind target per ecosystem, by bump type:

```bash
# npm
cd <npm-root>
npm outdated --json | jq 'to_entries | length'

# Gradle
cd <gradle-root>
./gradlew dependencyUpdates -Drevision=release 2>&1 \
  | grep -c "exceeded version"

# Maven
cd <maven-root>
./mvnw versions:display-property-updates -DallowMilestoneUpdates=false 2>&1 \
  | grep -c "->"
./mvnw versions:display-dependency-updates -DallowMilestoneUpdates=false 2>&1 \
  | grep -c "->"
./mvnw versions:display-plugin-updates -DallowMilestoneUpdates=false 2>&1 \
  | grep -c "->"

# Infra (Terraform providers behind target)
for tf_root in <list>; do
  cd "$tf_root"
  # Compare provider.tf constraints with registry latest
done
```

Severity:
- All current: ok
- 1-5 packages behind: info
- 6-20 packages behind: warn
- 21+ packages behind, OR critical CVE in active dep: fail

### 11c — Routine-running frequency

Last-run timestamps from `.pencil-maintenance-calendar.json`
compared against cadence targets:

```bash
# Read the calendar
jq '.ecosystems | to_entries[] | {name: .key, last_run: .value.last_run, cadence: .value.cadence}' \
  product/.pencil-maintenance-calendar.json
```

For each ecosystem, compare last_run against today minus the
cadence target:
- monthly cadence + last_run >35 days: drift
- quarterly cadence + last_run >100 days: drift
- biweekly cadence + last_run >18 days: drift

Severity:
- All on schedule: ok
- 1 ecosystem behind: info
- 2-3 ecosystems behind: warn
- All ecosystems behind, OR compliance-mandated cadence missed: fail

### 11d — Post-cleanup hardening

Verify that post-remediation discipline is holding:

- Biome rules promoted to `error` (per `biome-issues.md`'s
  promotion strategy) — check `biome.json` for `"warn"` entries
  that were previously promoted; flag regressions
- BOM-managed dependencies that were inlined-then-restored —
  check parent POM / `gradle.properties` for explicit pins of
  BOM-managed libs; flag if appearing
- Atomic-design `features/` directory absence (per AD-13) — flag
  if it has reappeared

Severity:
- All hardening intact: ok
- 1 regression: warn
- Multiple regressions: fail

### 11e — Cycle gap detection

When was the last `polyglot-maintenance-cycle` workflow completed?

```bash
jq '.cycle_history | last | .completed_at' \
  product/.pencil-maintenance-calendar.json
```

Compare against expected cadence:
- Most projects: monthly cycle expected
- Less-active codebases: quarterly cycle acceptable
- Compliance-driven: cadence in `.pencil-maintenance-calendar.json`

Severity:
- Last cycle < expected gap: ok
- Slightly overdue (1.5x expected gap): info
- Overdue (2x expected gap): warn
- Severely overdue (3x expected gap), OR compliance window
  missed: fail

### Aggregate Plane 11 result

When all sub-checks are ok: Plane 11 result = clean.
Any warn: Plane 11 result = warn.
Any fail: Plane 11 result = fail.

The `polyglot-maintenance-cycle` workflow's Phase 7 records this
result in `cycle_history[].audit_plane_11_result`.

### What this plane recommends

When findings exist, suggested actions:
- 11a backlog → run the relevant remediator
  (`/engineer:maintenance:remediation:biome-issues`,
  `/engineer:maintenance:remediation:atomic-design`, etc.)
- 11b upgrade lag → run the relevant upgrader
- 11c cadence missed → start the next cycle
  (`/core:workflows:manage start engineer:polyglot-maintenance-cycle`)
- 11d hardening regression → audit the regression's root cause;
  re-promote rules / re-pin via BOM
- 11e cycle gap → start the cycle immediately

The audit's job is detection; resolution is the team's job (or
agent's, when Janitr is dispatching).

## Plane 12 — Architecture drift

Detects architecture-level drift between intent (documented
ADRs, diagrams, capability registry) and reality (current
codebase, dependencies, infrastructure). Distinct from
Plane 11 (maintenance drift) which catches lint/dependency
hygiene; Plane 12 catches conceptual drift at the architecture
level.

### 12a — ADR currency

ADRs become stale or contradicted as systems evolve. The
audit checks:

- **ADRs marked Accepted but referencing deprecated patterns**
  (e.g., ADR accepted "use library X" but library X is now
  deprecated by upstream)
- **ADRs that should be superseded** based on detected
  contradiction (e.g., ADR-2025-005 says "use Maven for all
  Java projects" but new modules use Gradle without ADR
  superseding)
- **Decisions that were implicitly made without ADR** —
  detected by significant architectural changes in code
  (new top-level dependencies, new deployment targets, new
  data stores) without corresponding ADR

Severity: warn for stale references, fail for major
implicit decisions.

```bash
# Stale ADR references
for ADR in docs/adr/*.md; do
  STATUS=$(grep -i "^status:" "$ADR" | head -1)
  
  if [[ "$STATUS" =~ "Accepted" ]]; then
    # Check for deprecated tools/libraries referenced
    DEPRECATED_REFS=$(grep -lE "(deprecated|sunset|EOL)" "$ADR" 2>/dev/null)
    
    if [ -n "$DEPRECATED_REFS" ]; then
      echo "12a warn: $ADR references deprecated patterns; review"
    fi
  fi
done
```

### 12b — Capability documentation freshness

The capability registry tracks what capabilities exist. Drift
when:

- **Code patterns indicate a capability that's not in the
  registry** — e.g., real-time-notifications code exists but
  capability not registered (skipped capability-introduction
  workflow)
- **Capabilities in registry but no corresponding code** —
  registry refers to capability that was reverted or not
  built
- **Capability descriptions in registry don't match current
  implementation** — last-updated timestamp older than 180
  days AND code last-modified more recently

Severity: warn for documentation lag, fail for capability/
code mismatch.

### 12c — Dependency-architecture alignment

Architecture decisions imply specific dependencies. Drift
when:

- **ADR specifies framework X** but project depends on
  alternative framework Y for the same purpose
- **ADR specifies version constraint** but actual version
  diverges (especially major version)
- **New direct dependencies added** without architecture
  review or ADR

Detected by cross-referencing ADRs with package manifests
(package.json, pom.xml, build.gradle.kts, requirements.txt):

```bash
# Example: ADR says "use LangGraph" but Embabel is also
# imported in production code
ADR_LANGGRAPH=$(grep -l "decision: use LangGraph" docs/adr/)
if [ -n "$ADR_LANGGRAPH" ]; then
  EMBABEL_USAGE=$(grep -r "embabel" --include="*.java" \
                       --include="*.kt" src/main/ 2>/dev/null)
  if [ -n "$EMBABEL_USAGE" ]; then
    echo "12c warn: ADR specifies LangGraph; Embabel detected in code"
  fi
fi
```

Severity: warn for unreferenced dependency, fail for
dependency contradicting ADR.

### 12d — Diagram currency

Architecture diagrams become stale as code evolves. The audit
checks:

- **Diagram last-modified > 180 days** AND **code that diagram
  represents has had significant change** (>20% of files
  modified, or new top-level modules added)
- **Diagrams reference modules/components that no longer exist**
  (modules removed without diagram update)
- **New top-level modules without diagram representation**

Heuristic detection — diagrams represent code; comparing
"diagram entities" to "code top-level units" surfaces
mismatches.

```bash
# Diagrams older than 180 days
DIAGRAMS_DIR="docs/architecture"
STALE_THRESHOLD_DAYS=180

for DIAGRAM in "$DIAGRAMS_DIR"/*.mermaid "$DIAGRAMS_DIR"/*.puml 2>/dev/null; do
  LAST_MOD=$(stat -f %m "$DIAGRAM" 2>/dev/null || stat -c %Y "$DIAGRAM")
  AGE_DAYS=$(( ($(date +%s) - LAST_MOD) / 86400 ))
  
  if [ "$AGE_DAYS" -gt "$STALE_THRESHOLD_DAYS" ]; then
    echo "12d warn: $DIAGRAM is ${AGE_DAYS}d old (threshold ${STALE_THRESHOLD_DAYS})"
  fi
done
```

Severity: warn for stale diagrams, fail for diagrams
referencing nonexistent modules.

### 12e — Annual review cadence

The annual architecture review workflow should run yearly.
The audit checks:

- **Days since last completed annual review** > 365 (warn)
- **> 425 days** (fail — overdue by >2 months)
- **No annual review recorded ever** (fail; suggest
  initial run)

Reads `history.architectureReviewAnnual` from manifest:

```bash
LAST_REVIEW=$(jq -r '.history.architectureReviewAnnual | keys | max // empty' \
                    product/.pencil-architecture.json 2>/dev/null)

if [ -z "$LAST_REVIEW" ]; then
  echo "12e fail: No annual architecture review on record"
elif [ -n "$LAST_REVIEW" ]; then
  COMPLETED=$(jq -r ".history.architectureReviewAnnual.\"$LAST_REVIEW\".completed" \
                    product/.pencil-architecture.json)
  AGE_DAYS=$(date_diff_days "$COMPLETED")
  
  if [ "$AGE_DAYS" -gt 425 ]; then
    echo "12e fail: Annual review overdue by $((AGE_DAYS - 365))d"
  elif [ "$AGE_DAYS" -gt 365 ]; then
    echo "12e warn: Annual review due (${AGE_DAYS}d since last)"
  fi
fi
```

### Aggregate Plane 12 result

When all sub-checks are ok: Plane 12 result = clean.
Any warn: Plane 12 result = warn.
Any fail: Plane 12 result = fail.

The `architecture-review-annual` workflow's Phase 7 records
the most recent run's audit-12 result in
`history.architectureReviewAnnual.<year>.audit_plane_12_result`.

### What this plane recommends

When findings exist, suggested actions:
- 12a stale ADRs → review and supersede if needed
  (`/engineer:architecture:decisions:supersede`)
- 12a implicit decisions → run ADR cycle for the decision
  (`/core:workflows:manage start engineer:adr-cycle`)
- 12b capability mismatch → run capability introduction
  workflow (`/core:workflows:manage start engineer:capability-introduction`)
- 12c dependency contradictions → either revise ADR or
  revert dependency; surface for stakeholder discussion
- 12d stale diagrams → run
  `/engineer:architecture:diagrams update`
- 12e annual review due → run
  `/core:workflows:manage start engineer:architecture-review-annual`

The audit's job is detection; resolution is the team's job
(architecture decisions are inherently human-in-the-loop).

## Output

### Human format (default)

Sectioned report with per-plane findings, severity icons (`✅ ok`,
`ℹ️  info`, `⚠️  warn`, `🔒 locked`, `📎 orphan`), and a final
summary block:

```
🔍 Pencil Drift Audit

[ … per-plane sections … ]

Summary:
  Code drift:        2 components warned, 1 locked-divergence (informational)
  Design drift:      1 page → 12 components stale, 0 foundation manifests stale
  Token drift:       3 theme-foundation mismatches, 2 code-manifest mismatches
  Synthesized atoms: 3 unpromoted
  Orphans:           1 .pen, 1 component, 1 stale manifest entry

Action:
  3 issues fixable via /audit --fix
  9 issues require review

Suggested next steps:
  /audit --fix
  /core:frameworks:heroui:build-components dashboard
  Review synthesized atoms in build manifest
```

### JSON format (`--json`)

```jsonc
{
  "auditedAt": "2026-05-02T18:42:00Z",
  "since": null,
  "planes": {
    "codeDrift": { "warn": 2, "locked": 1, "items": [ … ] },
    "designDrift": { "stalePages": 1, "staleFoundations": 0, "items": [ … ] },
    "tokenDrift": { "themeFoundation": 3, "codeManifest": 2, "items": [ … ] },
    "synthesizedAtoms": { "unpromoted": 3, "items": [ … ] },
    "orphans": { "files": 2, "manifestEntries": 1, "items": [ … ] },
    "lockedDivergence": { "count": 2, "items": [ … ] }
  },
  "summary": {
    "totalIssues": 12,
    "fixable": 3,
    "requireReview": 9,
    "exitCode": 1
  },
  "suggestedActions": [ "/audit --fix", "/core:frameworks:heroui:build-components dashboard" ]
}
```

## Exit codes

- `0` — no issues found, system is in sync
- `1` — issues found, mix of fixable and review-required
- `2` — only fixable issues (CI-friendly: `--fix` will resolve)
- `3` — only review-required issues (no autofix would help)
- `4` — pre-flight failed (manifests missing, no git, etc.)

These let CI pipelines distinguish "broken" from "needs attention" and
choose how to gate.

## CI integration pattern

In a typical setup:

```yaml
# .github/workflows/design-system.yml
on: pull_request
jobs:
  pencil-audit:
    steps:
      - uses: actions/checkout@v4
      - run: claude run /audit --json --since origin/main
        # exit code 0 or 2 → continue; 1 or 3 → fail PR
```

The `--since origin/main` scopes the audit to changes in the PR
branch, so a long-standing locked-divergence elsewhere doesn't fail
new PRs.

## What the audit does NOT do

- It does not run visual regression. That's `/core:frameworks:heroui:build-components`.
  Audit only checks structural relationships and hash deltas.
- It does not run interaction tests. Same reasoning.
- It does not modify component source code. Only manifests, `@theme`
  additions, and stale manifest entries are autofixable.
- It does not create or delete `.pen` files.

The principle: **audit reports drift; build fixes drift.** Keeping
those concerns separate prevents an autofix from silently rewriting
something a developer was midway through changing.
