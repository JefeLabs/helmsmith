---
type: remediator
description: Detect and remediate Storybook drift across the design system. Orchestrates verify:health, verify:a11y, chromatic, catalog, and verify:deploy commands to surface drift, then dispatches fixes via verify:fix and stories:gen-missing. The maintenance-cadence companion to deliberate verification work in frameworks/storybook/verify.
argument-hint: [<scope>] [--fix] [--no-fix] [--include-chromatic] [--strict-a11y]
allowed-tools: Read, Write, Edit, Bash
---

> **Read first**: `engineer/maintenance/_context.md` (meta-anatomy
> + topology detection), `engineer/maintenance/remediation/_context.md`
> (remediation archetype patterns),
> `frameworks/storybook/_context.md` (storybook conventions and
> tool dependencies).
>
> **This routine is cross-grouping.** It lives in
> `engineer/maintenance/remediation/` because drift cleanup is
> engineer-flavored maintenance work scheduled on a cadence; the
> commands it invokes live in `frameworks/storybook/`. This is
> the established cross-grouping invocation pattern.
>
> Drift remediation is distinct from deliberate verification:
> verification (in `frameworks/storybook/verify/`) is for known
> work in progress; this routine catches drift that emerged in
> the gaps between deliberate work.

Detect Storybook drift across the full design system,
classify findings, dispatch fixes via specific commands.
Operates in scan-first, fix-later phases for safety.

**Invoke with:**
`/engineer:maintenance:remediation:storybook-drift` + optional
scope.

## Step 0.0 — Topology detection

Verify the storybook framework binding is active and Storybook
is operable:

```bash
# Storybook binding active?
ACTIVE=$(jq -r '.documentationBindings.storybook.active // false' \
              product/.pencil-frameworks.json 2>/dev/null)
if [ "$ACTIVE" != "true" ]; then
  echo "Storybook binding not active for this project. Drift"
  echo "remediation doesn't apply. If you intend to use Storybook,"
  echo "run /frameworks:init to detect and activate."
  exit 0  # not a failure; just not applicable
fi

# Storybook config exists?
test -f product/.pencil-storybook.json || {
  echo "Storybook deep config missing. Run /frameworks:storybook:init"
  exit 1
}

# Required tools available?
PLAYWRIGHT=$(jq -r '.tools.playwright.interfaces.cli.available // false' product/.pencil-tools.json)
[ "$PLAYWRIGHT" = "true" ] || {
  echo "Playwright required for drift detection. Run /tools:setup playwright"
  exit 1
}
```

## Step 0.1 — Storybook running prerequisite

Drift detection runs verify:health, verify:a11y, etc. against
a running Storybook. Check:

```bash
LOCAL_URL=$(jq -r '.storybook.localUrl' product/.pencil-storybook.json)
if ! curl -sf "$LOCAL_URL" > /dev/null 2>&1; then
  START_CMD=$(jq -r '.storybook.startCommand' product/.pencil-storybook.json)
  echo "Storybook not running. Drift remediation needs it running."
  echo "Start with: $START_CMD"
  echo "Then re-run /engineer:maintenance:remediation:storybook-drift"
  exit 1
fi
```

For maintenance-cycle invocations from
`engineer:polyglot-maintenance-cycle`, the cycle workflow may
start Storybook itself before invoking this routine; the cycle's
phase boundaries handle setup.

## Step 0.2 — Drift class taxonomy

Storybook drift falls into seven classes:

| Class | Code | Detection Source | Severity |
|-------|------|------------------|----------|
| Broken stories (BROKEN/LOADING/BLANK) | SD-1 | verify:health | high |
| Coverage gaps (components without stories) | SD-2 | catalog | medium |
| MDX docs out of sync with current API | SD-3 | catalog + heuristics | low |
| Accessibility violations (WCAG) | SD-4 | verify:a11y | severity-tiered |
| Chromatic baseline drift | SD-5 | chromatic | medium |
| Orphaned story files (component removed) | SD-6 | catalog | low |
| Deploy readiness regressions | SD-7 | verify:deploy | high |

Each class has its own remediation path; some classes auto-fix
(via verify:fix or stories:gen-missing); others surface for
manual review.

## Phase 1 — Reconnaissance

Run the four read-only diagnostic commands and aggregate
findings.

### SD-1: Broken stories

```bash
echo "=== SD-1: Broken stories ==="

/frameworks:storybook:verify:health "$SCOPE" --json > /tmp/sd-1.json

SD1_FAIL=$(jq '.summary.FAIL' /tmp/sd-1.json)
SD1_LOADING=$(jq '.summary.LOADING' /tmp/sd-1.json)
SD1_BLANK=$(jq '.summary.BLANK' /tmp/sd-1.json)
SD1_TOTAL=$((SD1_FAIL + SD1_LOADING + SD1_BLANK))

echo "  FAIL:    $SD1_FAIL"
echo "  LOADING: $SD1_LOADING"
echo "  BLANK:   $SD1_BLANK"
echo "  Total broken: $SD1_TOTAL"
```

### SD-2: Coverage gaps

```bash
echo "=== SD-2: Coverage gaps ==="

/frameworks:storybook:catalog --format json > /tmp/sd-2.json

SD2_MISSING=$(jq '.gaps.componentsWithoutStories | length' /tmp/sd-2.json)
echo "  Components without stories: $SD2_MISSING"
```

### SD-3: MDX docs out of sync

```bash
echo "=== SD-3: MDX docs out of sync ==="

# Heuristic: MDX file's lastModified < component file's lastModified
# AND component file changed since the catalog's recorded mdxLastUpdated

SD3_STALE=()
for COMPONENT in $(jq -r '.components[]?' /tmp/sd-2.json); do
  COMPONENT_FILE=$(echo "$COMPONENT" | jq -r '.path')
  MDX_FILE=$(echo "$COMPONENT" | jq -r '.mdxPath // empty')
  
  if [ -n "$MDX_FILE" ] && [ -f "$MDX_FILE" ]; then
    COMPONENT_MTIME=$(stat -f %m "$COMPONENT_FILE" 2>/dev/null || stat -c %Y "$COMPONENT_FILE")
    MDX_MTIME=$(stat -f %m "$MDX_FILE" 2>/dev/null || stat -c %Y "$MDX_FILE")
    
    if [ "$COMPONENT_MTIME" -gt "$MDX_MTIME" ]; then
      DIFF_DAYS=$(( (COMPONENT_MTIME - MDX_MTIME) / 86400 ))
      if [ "$DIFF_DAYS" -gt 30 ]; then
        SD3_STALE+=("$COMPONENT_FILE: MDX is ${DIFF_DAYS}d behind component")
      fi
    fi
  fi
done

echo "  Stale MDX (>30d behind component): ${#SD3_STALE[@]}"
```

### SD-4: Accessibility violations

```bash
echo "=== SD-4: Accessibility violations ==="

A11Y_ADDON=$(jq -r '.addons.a11y // empty' product/.pencil-storybook.json)
if [ -z "$A11Y_ADDON" ]; then
  echo "  @storybook/addon-a11y not installed; skipping a11y drift detection"
  SD4_CRITICAL=0; SD4_SERIOUS=0
else
  SEVERITY="${STRICT_A11Y:-serious}"  # default: catch serious + critical
  /frameworks:storybook:verify:a11y "$SCOPE" --severity "$SEVERITY" --json > /tmp/sd-4.json
  
  SD4_CRITICAL=$(jq '[.results[] | select(.violations[]?.impact == "critical")] | length' /tmp/sd-4.json)
  SD4_SERIOUS=$(jq '[.results[] | select(.violations[]?.impact == "serious")] | length' /tmp/sd-4.json)
  
  echo "  Critical violations: $SD4_CRITICAL"
  echo "  Serious violations:  $SD4_SERIOUS"
fi
```

### SD-5: Chromatic baseline drift

```bash
echo "=== SD-5: Chromatic baseline drift ==="

CHROMATIC_ENABLED=$(jq -r '.visualRegression.chromatic.enabled // false' product/.pencil-storybook.json)
if [ "$CHROMATIC_ENABLED" != "true" ] || [ "$INCLUDE_CHROMATIC" != "true" ]; then
  echo "  Chromatic not enabled or skipped; skipping baseline drift"
  SD5_MISSING=0; SD5_ORPHANED=0; SD5_UNREVIEWED=0
else
  /frameworks:storybook:chromatic --json > /tmp/sd-5.json
  
  SD5_MISSING=$(jq '.baselineCoverage.missingBaseline' /tmp/sd-5.json)
  SD5_ORPHANED=$(jq '.baselineCoverage.orphanedBaselines' /tmp/sd-5.json)
  SD5_UNREVIEWED=$(jq '.latestBuild.unreviewedCount' /tmp/sd-5.json)
  
  echo "  Missing baselines:   $SD5_MISSING"
  echo "  Orphaned baselines:  $SD5_ORPHANED"
  echo "  Unreviewed pending:  $SD5_UNREVIEWED"
fi
```

### SD-6: Orphaned story files

```bash
echo "=== SD-6: Orphaned story files ==="

# Story files referencing components that no longer exist
SD6_ORPHANED=()
for STORY in $(find "$COMPONENT_ROOT" -name "*.stories.tsx" -o -name "*.stories.ts"); do
  COMPONENT_NAME=$(basename "$STORY" | sed 's/\.stories\.[jt]sx\?$//')
  COMPONENT_DIR=$(dirname "$STORY")
  
  if [ ! -f "${COMPONENT_DIR}/${COMPONENT_NAME}.tsx" ] && \
     [ ! -f "${COMPONENT_DIR}/${COMPONENT_NAME}.jsx" ]; then
    SD6_ORPHANED+=("$STORY")
  fi
done

echo "  Orphaned story files: ${#SD6_ORPHANED[@]}"
```

### SD-7: Deploy readiness regressions

```bash
echo "=== SD-7: Deploy readiness regressions ==="

# Only run if scope is unrestricted (deploy verify is expensive)
if [ -z "$SCOPE" ] || [ "$SCOPE" = "all" ]; then
  /frameworks:storybook:verify:deploy --no-rebuild --json > /tmp/sd-7.json 2>/dev/null || true
  
  if [ -f /tmp/sd-7.json ]; then
    SD7_BUILD_PASS=$(jq -r '.build // false' /tmp/sd-7.json)
    SD7_BLANK=$(jq '.validation.blank // 0' /tmp/sd-7.json)
    SD7_BROKEN=$(jq '.validation.broken // 0' /tmp/sd-7.json)
    
    echo "  Build pass:    $SD7_BUILD_PASS"
    echo "  Blank in prod: $SD7_BLANK"
    echo "  Broken in prod: $SD7_BROKEN"
  else
    echo "  Deploy verification not run (scope-restricted or unavailable)"
  fi
else
  echo "  Skipped (scope-restricted run; SD-7 runs only on full scope)"
fi
```

## Phase 2 — Triage

Build the consolidated drift report:

```
=== Storybook Drift Inventory ===
Scope:                 atoms (45 components, 198 stories)
Catalog run:           2026-05-03 17:55

Drift class                   Count  Severity
SD-1: Broken stories          3      high
SD-2: Coverage gaps           2      medium
SD-3: Stale MDX (>30d)        7      low
SD-4: A11y critical           1      severity-tiered
SD-4: A11y serious            5      severity-tiered
SD-5: Missing baselines       2      medium
SD-6: Orphaned story files    1      low
SD-7: Deploy regressions      0      —

Total findings:               21

Routing:
  Auto-fixable (with --fix):
    SD-1 broken stories:       3 → /frameworks:storybook:verify:fix
    SD-2 coverage gaps:        2 → /frameworks:storybook:stories:gen-missing
    SD-6 orphaned story files: 1 → confirm and remove
    SD-3 stale MDX:            7 → /frameworks:storybook:stories:doc --update

  Surface for manual review:
    SD-4 a11y violations:      6 (critical + serious; component changes needed)
    SD-5 missing baselines:    2 (next push captures; or auto-accept)
    SD-7 deploy regressions:   0
```

## Phase 3 — Confirmation

```
=== Confirmation ===

Plan:
  Auto-fix in batches:
    Batch 1: SD-1 broken stories (3 stories, ~2 min)
    Batch 2: SD-2 coverage gaps (2 components, ~1 min)
    Batch 3: SD-6 orphaned files (1 file, ~10s after confirmation)
    Batch 4: SD-3 stale MDX (7 docs, ~3 min)
  
  Surface (no auto-fix):
    SD-4 a11y violations: 6 findings to review
    SD-5 missing baselines: 2 (action: push to capture, or
                              auto-accept on next chromatic run)

Total auto-fix time estimate: ~6 min
Continue? [Y/skip-class/cancel]
```

`skip-class` lets the user opt out of specific classes:
- `Y skip SD-3` → process all classes except SD-3
- `Y skip SD-3,SD-6` → process all except SD-3 and SD-6

## Phase 4 — Sequential remediation

Each class processes in order. After each class completes, the
report updates with progress.

### SD-1: Dispatch broken stories to verify:fix

```bash
echo "=== Phase 4: SD-1 — Broken stories ==="

BROKEN_STORIES=$(jq -r '.results[] | select(.status == "FAIL" or .status == "LOADING" or .status == "BLANK") | .storyId' /tmp/sd-1.json)

FIXED=0
FAILED=0
for STORY_ID in $BROKEN_STORIES; do
  echo "Fixing: $STORY_ID"
  /frameworks:storybook:verify:fix "$STORY_ID"
  
  if [ $? -eq 0 ]; then
    FIXED=$((FIXED + 1))
  else
    FAILED=$((FAILED + 1))
  fi
done

echo "SD-1 results: $FIXED fixed, $FAILED failed"
```

### SD-2: Dispatch coverage gaps to stories:gen-missing

```bash
echo "=== Phase 4: SD-2 — Coverage gaps ==="

# Run gen-missing for the scope
/frameworks:storybook:stories:gen-missing "$SCOPE"
```

### SD-3: Refresh stale MDX docs

```bash
echo "=== Phase 4: SD-3 — Stale MDX ==="

for STALE_ENTRY in "${SD3_STALE[@]}"; do
  COMPONENT=$(extract_component_name "$STALE_ENTRY")
  /frameworks:storybook:stories:doc "$COMPONENT" --update --sections api
done
```

### SD-6: Confirm and remove orphaned story files

```bash
echo "=== Phase 4: SD-6 — Orphaned story files ==="

for ORPHAN in "${SD6_ORPHANED[@]}"; do
  echo "Orphaned story: $ORPHAN"
  echo "  Component file no longer exists at expected location."
  read -p "  Remove story file? [y/N/q] " choice
  
  case "$choice" in
    y|Y) rm "$ORPHAN"; echo "    Removed." ;;
    q|Q) echo "    Stopping SD-6 phase"; break ;;
    *) echo "    Skipped." ;;
  esac
done
```

## Phase 5 — Surface manual-review items

For SD-4 (a11y), SD-5 (chromatic baselines), SD-7 (deploy
regressions) that aren't auto-fixed, build a structured manual
review report:

```
=== Manual Review Items ===

SD-4: A11y violations requiring component changes (6)

CRITICAL (1):
  core-atoms-button--ghost
    Issue: Color contrast 2.93:1 (WCAG AA needs 4.5:1)
    Location: components/core/atoms/button/Button.tsx
    Fix path: Component code change (theme token or hardcoded
              color); not auto-fixable.
    Reference: https://dequeuniversity.com/rules/axe/4.8/color-contrast

SERIOUS (5):
  core-atoms-input--default
    Issue: No associated label found
    Location: components/core/atoms/input/Input.tsx
    Fix path: Component code change; add label support or
              aria-label requirement.
  
  ... (4 more)

SD-5: Chromatic baselines (2)

  core-atoms-icon-badge--default
  core-atoms-icon-badge--with-count
    Action: Push to main to capture baselines, or run:
      npx chromatic --auto-accept-changes
    
    No code changes needed; baseline establishment is a
    Chromatic operation.
```

## Phase 6 — Final mandatory verification gate

After all phases complete, run a final verification to confirm
remediation didn't introduce new drift:

```bash
echo "=== Phase 6: Final verification gate ==="

# Re-run health check on remediated stories
/frameworks:storybook:verify:health "$SCOPE" --json > /tmp/post-remediation-health.json

POST_FAIL=$(jq '.summary.FAIL' /tmp/post-remediation-health.json)
POST_LOADING=$(jq '.summary.LOADING' /tmp/post-remediation-health.json)

if [ "$POST_FAIL" -gt 0 ] || [ "$POST_LOADING" -gt 0 ]; then
  echo "WARNING: Final verification failed."
  echo "  FAIL after remediation:    $POST_FAIL"
  echo "  LOADING after remediation: $POST_LOADING"
  echo ""
  echo "Some remediation may have introduced new drift, or fixes"
  echo "didn't fully resolve the original drift. Review:"
  
  jq -r '.results[] | select(.status == "FAIL" or .status == "LOADING") | "  - " + .storyId + ": " + .issue' \
    /tmp/post-remediation-health.json
  
  exit 1
fi

echo "✓ All remediated stories pass final verification"
```

The final gate is **mandatory** per maintenance routine pattern.
A routine that says "I cleaned up drift" but leaves stories
broken has failed.

## Phase 7 — Report

```
=== Storybook Drift Remediation Report ===
Scope:           atoms (45 components, 198 stories)
Started:         2026-05-03 17:55
Completed:       2026-05-03 18:11 (16 min)

Drift class                   Before   After   Auto-fixed   Manual
SD-1: Broken stories          3        0       3            0
SD-2: Coverage gaps           2        0       2            0
SD-3: Stale MDX               7        0       7            0
SD-4: A11y critical           1        1       0            1 (review)
SD-4: A11y serious            5        5       0            5 (review)
SD-5: Missing baselines       2        2       0            2 (push)
SD-6: Orphaned story files    1        0       1            0
SD-7: Deploy regressions      0        0       0            0

Final verification: ✓ PASS

Files modified:
  - 5 story files (SD-1 fixes + SD-2 generations)
  - 1 story file deleted (SD-6 orphan)
  - 7 MDX files updated (SD-3 refresh)

Manual review needed: 8 items
  - SD-4: 6 a11y violations (component changes required)
  - SD-5: 2 baselines pending Chromatic push

Recommendations:
  - Address SD-4 critical violation first (color contrast)
  - Push to main to capture missing Chromatic baselines
  - Re-run /engineer:maintenance:remediation:storybook-drift
    after manual fixes
```

## Cross-routine invocation

This routine is invoked by
`engineer:polyglot-maintenance-cycle` as part of multi-
ecosystem maintenance cycles. The cycle's phases:

1. Topology census
2. Capacity check
3. Read-only quality scan dispatch (this routine runs in this
   phase as a scan-mode invocation, no fixes)
4. Prioritization
5. Sequential execution (this routine runs again, this time
   with `--fix`)
6. Coordinated review
7. Post-cycle audit
8. Schedule next

The cycle workflow handles starting Storybook, sequencing this
routine alongside other maintenance routines (atomic-design,
component-dedup, biome-issues, dependency upgrades), and
coordinating the final review.

This routine also coordinates with sister routines:
- **atomic-design** routine — generates SD-2 candidates
  (components that violate atomic-design rules often have
  no stories); both routines fix coverage gaps
- **component-dedup** routine — uses Storybook for visual
  regression source; SD-7 issues flag potential dedup
  problems

## Tool dependencies

Required:
- Playwright (verify:health, verify:a11y, verify:fix,
  verify:deploy, migration:verify)
- pixelmatch (for any visual diff sub-checks)

Optional (degrade gracefully):
- Chrome DevTools MCP (richer console error capture)
- ImageMagick (for color-related drift sub-checks)
- Chromatic CLI (only when chromatic enabled)

## Project-specific adaptation

This routine is **mostly portable** but has a few project-
specific knobs:

- **A11y severity threshold** (`--strict-a11y`) — projects with
  strict a11y compliance set this; others may default to
  `serious` or `moderate`
- **MDX staleness threshold** — currently 30 days; projects
  with faster API churn may want shorter
- **SD-7 deploy verification** — only runs on unrestricted
  scope by default (it's expensive); projects can opt in for
  scoped runs

These adaptations live in
`.pencil-storybook.json` extensions or could be flag-driven.

## What this routine does NOT do

- **Modify component source code.** All fixes route through
  story files (verify:fix), MDX files (stories:doc), or are
  surfaced for manual review.
- **Force chromatic baselines.** Surfaces missing baselines;
  capturing happens via push (project's CI) or
  `--auto-accept-changes` (user's call).
- **Replace verify commands.** Verify commands are for
  deliberate work; this routine is for scheduled drift
  cleanup. They have different cadences and coverage
  expectations.
- **Audit framework binding manifest staleness.** That's
  Plane 11+ in the audit dispatcher; not this routine's
  scope.

## Examples

```bash
# Full drift remediation
/engineer:maintenance:remediation:storybook-drift

# Scoped to atoms
/engineer:maintenance:remediation:storybook-drift atoms

# Detection only (no fixes)
/engineer:maintenance:remediation:storybook-drift --no-fix

# Include Chromatic baseline drift
/engineer:maintenance:remediation:storybook-drift --include-chromatic

# Stricter a11y threshold
/engineer:maintenance:remediation:storybook-drift --strict-a11y critical
```
