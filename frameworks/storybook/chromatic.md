---
description: Verify Chromatic integration health. Surfaces missing baselines, unreviewed changes, configuration issues, and project-token state. Distinct from migration:verify (which uses pixelmatch locally) and verify:health (which uses Playwright). Chromatic is a cloud service; this command checks integration state.
argument-hint: [--baseline-only] [--unreviewed-only] [--branch <name>] [--json]
allowed-tools: Read, Write, Edit, Bash
---

Check the health of Chromatic visual regression integration.
Surfaces baseline coverage, pending unreviewed changes, missing
project token, broken configuration, and CI integration state.

Chromatic is a cloud-hosted visual regression service that
takes per-story snapshots, stores baselines, and surfaces diffs
on each Storybook deploy. This command queries Chromatic's
state and reports without making changes.

## Phase 0: pre-flight

Per `frameworks/storybook/_context.md`:
1. Storybook framework binding active in
   `.pencil-frameworks.json`
2. Chromatic enabled in `.pencil-storybook.json`:
   ```bash
   ENABLED=$(jq -r '.visualRegression.chromatic.enabled // false' \
                  product/.pencil-storybook.json)
   if [ "$ENABLED" != "true" ]; then
     echo "Chromatic is not enabled in this project."
     echo "Run /frameworks:storybook:init --update to detect"
     echo "and enable Chromatic, or skip this command if your"
     echo "project doesn't use Chromatic."
     exit 1
   fi
   ```
3. Chromatic addon in manifest's addons:
   ```bash
   CHROMATIC_ADDON=$(jq -r '.addons.chromatic // empty' \
                          product/.pencil-storybook.json)
   if [ -z "$CHROMATIC_ADDON" ]; then
     echo "@chromatic-com/storybook addon not detected."
     echo "Install: npm install --save-dev @chromatic-com/storybook"
     echo "Then run /frameworks:storybook:init --update-addons"
     exit 1
   fi
   ```
4. CHROMATIC_PROJECT_TOKEN environment variable set:
   ```bash
   if [ -z "$CHROMATIC_PROJECT_TOKEN" ]; then
     echo "CHROMATIC_PROJECT_TOKEN not set in environment."
     echo "Get the token from your Chromatic project settings"
     echo "and export it: export CHROMATIC_PROJECT_TOKEN=<token>"
     echo ""
     echo "The manifest does NOT store the token (it's a secret)."
     exit 1
   fi
   ```
5. Chromatic CLI available (`/tools:chromatic`):
   ```bash
   CHROMATIC_CLI=$(jq -r '.tools.chromatic.interfaces.cli.available // false' \
                        product/.pencil-tools.json 2>/dev/null)
   if [ "$CHROMATIC_CLI" != "true" ]; then
     echo "Chromatic CLI not installed. Run /tools:setup chromatic"
     exit 1
   fi
   ```

## Phase 1: query Chromatic state

The Chromatic CLI exposes commands for state inspection. Use
them to gather:

### Project state

```bash
# Default branch (typically main or master)
DEFAULT_BRANCH=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@')

# Branch to check (default to current)
BRANCH="${BRANCH:-$(git rev-parse --abbrev-ref HEAD)}"

# Use Chromatic's API or CLI to fetch project state
# Note: actual API/CLI invocations may vary by Chromatic version
PROJECT_STATE=$(npx chromatic --list-projects --json 2>/tmp/chromatic.log)
```

### Latest build state

```bash
LATEST_BUILD=$(npx chromatic --branch "$BRANCH" --list --json 2>/tmp/chromatic.log | head -1)
```

Captures: build number, status (passed/failed/in-progress),
total snapshots, baseline snapshots, changed snapshots,
unreviewed count.

### Baseline coverage

For each story in the local Storybook index, check if it has
a Chromatic baseline:

```bash
LOCAL_URL=$(jq -r '.storybook.localUrl' product/.pencil-storybook.json)
INDEX=$(curl -sf "${LOCAL_URL}/index.json")
LOCAL_STORIES=$(echo "$INDEX" | jq -r '.entries // .stories | to_entries | map(select(.value.type == "story")) | .[].key' | sort)

# Compare against Chromatic snapshots
CHROMATIC_SNAPSHOTS=$(npx chromatic --list-snapshots --branch "$BRANCH" --json 2>/dev/null | jq -r '.[].storyId' | sort)

# Stories with baselines
HAS_BASELINE=$(comm -12 <(echo "$LOCAL_STORIES") <(echo "$CHROMATIC_SNAPSHOTS"))

# Stories without baselines (in local but not Chromatic)
NO_BASELINE=$(comm -23 <(echo "$LOCAL_STORIES") <(echo "$CHROMATIC_SNAPSHOTS"))

# Orphan baselines (in Chromatic but not local — story removed)
ORPHANED=$(comm -13 <(echo "$LOCAL_STORIES") <(echo "$CHROMATIC_SNAPSHOTS"))
```

### Unreviewed changes

```bash
UNREVIEWED=$(npx chromatic --list-changes --branch "$BRANCH" --status unreviewed --json 2>/dev/null)
UNREVIEWED_COUNT=$(echo "$UNREVIEWED" | jq 'length')
```

## Phase 2: classify findings

Build a structured findings report:

| Finding | Severity | Action |
|---------|----------|--------|
| No build on default branch | FAIL | Run initial Chromatic build to establish baselines |
| Stories without baselines | WARN | Next push will create baselines; or run chromatic --auto-accept-changes for initial setup |
| Orphaned baselines | INFO | Stories removed; baselines persist in Chromatic |
| Unreviewed changes pending | WARN | Review at chromatic.com or auto-accept if intentional |
| Project token misconfigured | FAIL | Update CHROMATIC_PROJECT_TOKEN env var |
| CI not configured | INFO | Add `npx chromatic` to CI pipeline |

## Phase 3: report

### Default human-readable

```
=== Chromatic Integration Health ===
Branch:                main (default)
Project:               skoolscout-storybook
Project URL:           https://www.chromatic.com/builds?appId=...

Latest build:
  Number:              #87
  Status:              passed
  Snapshots:           247
  Changed:             0
  Unreviewed:          0
  Built:               2h ago

Baseline coverage:
  Stories with baseline:    245 / 247  (99%)
  Stories missing baseline: 2 (will be captured on next push)
    - core-atoms-icon-badge--default
    - core-atoms-icon-badge--with-count

  Orphaned baselines:       1 (story removed but baseline persists)
    - core-molecules-old-card--default

Configuration:
  ✓ CHROMATIC_PROJECT_TOKEN set
  ✓ @chromatic-com/storybook addon installed
  ✓ Project token validated against Chromatic API

Unreviewed changes:
  None pending.

Status: HEALTHY

Recommendations:
  - 2 new stories will get baselines on next chromatic push
  - 1 orphaned baseline can be ignored or manually removed
    in Chromatic UI

Next steps:
  - Push current changes to capture missing baselines:
      npx chromatic --project-token=$CHROMATIC_PROJECT_TOKEN
  - Or run with auto-accept for initial baseline establishment:
      npx chromatic --project-token=$CHROMATIC_PROJECT_TOKEN \
                    --auto-accept-changes
```

### Mode: `--baseline-only`

Filtered output focused on baseline coverage:

```
=== Baseline Coverage ===
Stories total:    247
With baseline:    245 (99.2%)
Missing baseline: 2

Missing baselines:
  core-atoms-icon-badge--default
  core-atoms-icon-badge--with-count

Action: Push to main to capture baselines, or run:
  npx chromatic --auto-accept-changes
```

### Mode: `--unreviewed-only`

Filtered output focused on pending review:

```
=== Unreviewed Changes ===
Branch:           main
Pending reviews:  3

Story:    core-atoms-button--default
  Changed since:  2h ago
  PR:             #1234 (https://github.com/.../pull/1234)
  Diff URL:       https://www.chromatic.com/build/...
  Status:         awaiting review

Story:    core-atoms-button--solid-primary
  Changed since:  2h ago
  ... (etc.)

Action: Review at https://www.chromatic.com/builds?appId=...
        or auto-accept if changes are intentional:
          npx chromatic --auto-accept-changes
```

### JSON (`--json`)

```jsonc
{
  "version": 1,
  "queryAt": "2026-05-03T17:30:00Z",
  "branch": "main",
  "project": {
    "id": "...",
    "url": "https://www.chromatic.com/..."
  },
  "latestBuild": {
    "number": 87,
    "status": "passed",
    "snapshotCount": 247,
    "changedCount": 0,
    "unreviewedCount": 0,
    "builtAt": "2026-05-03T15:00:00Z"
  },
  "baselineCoverage": {
    "withBaseline": 245,
    "missingBaseline": 2,
    "missingBaselineStories": [...],
    "orphanedBaselines": 1,
    "orphanedBaselineStories": [...]
  },
  "configuration": {
    "tokenSet": true,
    "tokenValid": true,
    "addonInstalled": true,
    "ciConfigured": true
  },
  "unreviewedChanges": [],
  "status": "HEALTHY"
}
```

## Exit codes

- `0` — HEALTHY (no issues, or only INFO-level)
- `1` — WARN (missing baselines, unreviewed changes pending,
  orphaned baselines)
- `2` — FAIL (no build on default branch, project token broken,
  configuration broken)

## Cross-namespace effects

This command is invoked by:
- `engineer/maintenance/remediation/storybook-drift` (when
  built) as part of drift detection — orphaned baselines and
  unreviewed-changes-stale-too-long are drift signals
- CI pipelines for pre-deploy checks
- The `frameworks:storybook:catalog` command for chromatic
  coverage stats

## Branch-specific reporting

Default branch (typically `main`) is what most teams care
about for production baselines. Feature branch reporting via
`--branch <name>` shows that branch's state separately. Useful
when:

- Verifying a feature branch is ready for merge (no
  unreviewed Chromatic changes)
- Understanding why a deployed branch has issues

## What this command does NOT do

- **Push to Chromatic.** Reports state; doesn't trigger builds.
  Builds are triggered by CI or manual `npx chromatic`
  invocations.
- **Approve or reject changes.** Surfaces unreviewed changes;
  the user reviews at chromatic.com or runs
  `--auto-accept-changes` themselves.
- **Manage project token.** Token is environment-managed; this
  command verifies it's set and works but doesn't store or
  rotate it.
- **Replace migration:verify.** That uses pixelmatch locally
  for migration-specific verification with structured loops.
  Chromatic is for ongoing visual regression of all changes
  to the design system; migration:verify is for one-time
  framework migrations.

## Examples

```bash
# Default — full health check
/frameworks:storybook:chromatic

# Baseline coverage only
/frameworks:storybook:chromatic --baseline-only

# Unreviewed changes only
/frameworks:storybook:chromatic --unreviewed-only

# Specific branch
/frameworks:storybook:chromatic --branch feature/new-cards

# CI integration
/frameworks:storybook:chromatic --json > chromatic-health.json
```
