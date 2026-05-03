---
description: Chromatic CLI for cloud-hosted visual regression testing of Storybook stories. CLI only — no MCP. Pushes Storybook builds to Chromatic for snapshot capture, baseline comparison, and visual review workflows. Distinct from migration:verify (which uses pixelmatch locally) — Chromatic is for ongoing visual regression on every change.
argument-hint: <free-form-prompt> [--auto-accept-changes] [--exit-zero-on-changes] [--branch <name>]
allowed-tools: Read, Write, Edit, Bash
---

Direct invocation of the Chromatic CLI for cloud visual
regression. Used for pushing Storybook builds, querying build
state, and triggering baseline updates.

## Phase 0: pre-flight

1. Verify chromatic active in tools manifest:

   ```bash
   ACTIVE=$(jq -r '.tools.chromatic.active // false' \
                 product/.pencil-tools.json 2>/dev/null)
   if [ "$ACTIVE" != "true" ]; then
     echo "Chromatic CLI not active. Run /tools:setup chromatic"
     exit 1
   fi
   ```

2. Verify Chromatic CLI is invokable:

   ```bash
   if ! npx --no-install chromatic --version >/dev/null 2>&1; then
     # Check global install
     if ! command -v chromatic >/dev/null 2>&1; then
       echo "Chromatic CLI not installed."
       echo "Project: npm install --save-dev chromatic"
       echo "Global:  npm install -g chromatic"
       exit 1
     fi
   fi
   ```

3. Verify project token is available:

   ```bash
   if [ -z "$CHROMATIC_PROJECT_TOKEN" ]; then
     echo "CHROMATIC_PROJECT_TOKEN not set."
     echo "Get token from your Chromatic project settings."
     echo "Then: export CHROMATIC_PROJECT_TOKEN=<token>"
     exit 1
   fi
   ```

   The token is environment-managed (not stored by suite).
   This matches Chromatic's CI integration pattern; CI systems
   set the env var.

## Phase 1: prompt interpretation

Operations Chromatic CLI handles:

### Push operations

- **Standard push** — build Storybook, upload, get Chromatic
  build number
- **Push with auto-accept** — accept all visual changes as
  baseline (initial setup, intentional batch changes)
- **Push with branch metadata** — feature branches, PR
  associations

### Query operations

- **List builds** — recent build history
- **Build status** — specific build's pass/fail/in-progress
- **Snapshot inventory** — stories with baselines
- **Changes pending review** — visual changes awaiting
  human review

### Configuration operations

- **Project setup** — initial Chromatic configuration
- **Skip stories** — patterns that shouldn't be snapshot
  (animations, randomized content)

## Phase 2: execution

### Standard push

```bash
# Default: build Storybook, upload, exit non-zero on visual
# changes (so CI fails until reviewer accepts)
npx chromatic --project-token="$CHROMATIC_PROJECT_TOKEN"

# CI-friendly: don't fail CI on changes (just report)
npx chromatic --project-token="$CHROMATIC_PROJECT_TOKEN" \
              --exit-zero-on-changes

# Auto-accept (initial baseline establishment, brand refreshes,
# intentional sweeping changes)
npx chromatic --project-token="$CHROMATIC_PROJECT_TOKEN" \
              --auto-accept-changes
```

### Push with branch metadata

```bash
# Specific branch
npx chromatic --project-token="$CHROMATIC_PROJECT_TOKEN" \
              --branch-name="$BRANCH_NAME"

# PR association
npx chromatic --project-token="$CHROMATIC_PROJECT_TOKEN" \
              --pull-request-number="$PR_NUMBER" \
              --commit-sha="$COMMIT_SHA"
```

### Skip rebuild (use existing Storybook build)

```bash
# When you've already built locally and just want to upload
npx chromatic --project-token="$CHROMATIC_PROJECT_TOKEN" \
              --storybook-build-dir=storybook-static
```

## Phase 3: result interpretation

Chromatic CLI outputs structured info. The integration parses:

- **Build URL** — for human review
- **Snapshot count** — total stories captured
- **Changes count** — stories with visual differences from
  baseline
- **Errors count** — stories that failed to render
- **New stories** — stories without prior baseline

```
=== Chromatic Push ===
Build:       #88
URL:         https://www.chromatic.com/build?appId=...&number=88
Storybook:   storybook-static/ (built locally)
Snapshots:   247

Changes detected: 3
  Stories with visual differences:
    - core-atoms-button--ghost
    - core-atoms-card--default
    - core-molecules-search-bar--default
  
  Review at: https://www.chromatic.com/build?appId=...&number=88

New stories (no baseline yet): 2
  - core-atoms-icon-badge--default
  - core-atoms-icon-badge--with-count

Errors: 0
```

## Phase 4: error handling

| Error | Likely cause | Suite guidance |
|-------|--------------|----------------|
| Invalid project token | Token wrong or revoked | Re-fetch from Chromatic project settings |
| Storybook build failed | Upstream build error | Check Storybook config; run build locally to debug |
| Can't connect to chromatic.com | Network/proxy issue | Check connectivity; configure proxy if behind one |
| No stories found | Storybook build empty | Verify Storybook config; check stories glob |
| Rate limited | Plan limits exceeded | Check Chromatic plan; spread builds across time |

## Cross-namespace integration

Chromatic CLI is consumed by:

- **`frameworks/storybook/chromatic`** — the integration
  command that wraps this tool with richer prompt
  interpretation and reporting
- **`engineer/maintenance/remediation/storybook-drift`** —
  SD-5 drift detection (orphaned baselines, unreviewed
  changes pending too long)
- **CI pipelines** — typically the canonical caller; this
  tool integration is for ad-hoc pushes and queries

## Distinction from pixelmatch and migration:verify

| Tool | Purpose |
|------|---------|
| pixelmatch | Local visual diff between two images |
| ImageMagick compare | Local visual diff with sophisticated metrics |
| Chromatic | Cloud-hosted visual regression workflow |
| migration:verify Loop 4 | Uses pixelmatch (local) for migration sweeps |
| frameworks:storybook:chromatic | Uses Chromatic CLI (cloud) for ongoing |

The local tools handle deliberate, contained verification
work. Chromatic handles ongoing change tracking with team
review workflows.

## What this tool does NOT do

- **Replace Storybook build.** Builds Storybook (or uses a
  pre-built directory) and uploads.
- **Manage baselines manually.** Baselines are managed in
  Chromatic UI or via the API; CLI just pushes builds.
- **Manage team accounts.** Chromatic UI handles user
  management.
- **Provide local visual regression.** That's pixelmatch /
  ImageMagick.

## Examples

```bash
# Push current Storybook to Chromatic
/tools:chromatic "push the current Storybook build"

# Auto-accept (initial setup or sweeping intentional change)
/tools:chromatic "push and auto-accept all changes"

# Push for a feature branch
/tools:chromatic "push as branch feature/new-cards"

# Query latest build
/tools:chromatic "show the latest Chromatic build status"
```

Most users will invoke the higher-level
`/frameworks:storybook:chromatic` command (which wraps this
tool with project-aware logic). Direct `/tools:chromatic`
usage is for ad-hoc pushes and CI integration debugging.

---

# Registry definition

## Tool metadata

```yaml
name: chromatic
displayName: Chromatic CLI
provider: chromatic
category: visual-regression-cloud
optional: true   # only required when project uses Chromatic
```

## Interfaces

### CLI

```yaml
executable: chromatic (or npx chromatic)
detectionCommand: |
  npx --no-install chromatic --version || \
  command -v chromatic
installCommand: |
  Project (recommended):
    npm install --save-dev chromatic
  Global:
    npm install -g chromatic
authMethod: project-token-via-env
authEnvVar: CHROMATIC_PROJECT_TOKEN
notes: |
  Chromatic uses a project-scoped token from Chromatic UI.
  Token is environment-managed, NOT stored by the suite.
  Matches Chromatic's CI integration pattern.
```

### MCP

**Not available.** No Chromatic MCP exists or is needed.

## Version constraint

Recommended: chromatic 11.x. The CLI surface has been stable.

## Required by skillz commands

Auto-populated. Currently:
- /frameworks:storybook:chromatic
- /engineer:maintenance:remediation:storybook-drift (SD-5)

## Cross-tool dependencies

- Storybook (builds Storybook before upload, unless
  --storybook-build-dir provided)
- Network access to chromatic.com

## System requirements

- Node.js 16+
- ~50 MB disk for the CLI package
- Network: HTTPS to chromatic.com
- CHROMATIC_PROJECT_TOKEN env var set

## Compliance considerations

Chromatic stores screenshots in their cloud. For projects with
sensitive design content (financial UI, customer data
visualizations), verify Chromatic's data handling against
compliance requirements. Most public-facing UI is fine; some
internal/admin UI may not be appropriate to push to a
third-party service.

For high-compliance contexts, the local pixelmatch +
migration:verify path may be preferable.
