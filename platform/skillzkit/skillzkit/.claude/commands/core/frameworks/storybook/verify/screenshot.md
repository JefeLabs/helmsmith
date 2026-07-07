---
description: Capture screenshots of Storybook stories. Standalone or as a building block for visual regression workflows. Supports local and deployed sources, configurable viewport and browser, batch processing for multiple stories. The fundamental capture primitive other verify and migration commands compose with.
argument-hint: [scope] [--source local|deployed] [--output-dir <path>] [--viewport <w,h>] [--browser chromium|firefox|webkit] [--label <name>]
allowed-tools: Read, Write, Edit, Bash
---

Capture screenshots of Storybook stories. Standalone for
documentation/comparison work; composed by other commands
(`verify:health`, `migration:verify`, drift cycles) for their
visual checks.

## Phase 0: pre-flight

Per `frameworks/storybook/verify/_context.md`:
1. Storybook framework binding active
2. `.pencil-storybook.json` exists
3. Storybook running (for `--source local`) OR deployedUrl
   configured (for `--source deployed`)
4. Playwright tool available
5. Kill stale browser processes

## Phase 1: source resolution

```bash
SOURCE="${SOURCE:-local}"

case "$SOURCE" in
  local)
    BASE_URL=$(jq -r '.storybook.localUrl' product/.pencil-storybook.json)
    TIMEOUT=$(jq -r '.screenshots.firstStoryTimeoutMs // 30000' product/.pencil-storybook.json)
    DEFAULT_OUTPUT_SUBDIR="local"
    ;;
  deployed)
    BASE_URL=$(jq -r '.storybook.deployedUrl // empty' product/.pencil-storybook.json)
    if [ -z "$BASE_URL" ]; then
      echo "deployedUrl not configured in .pencil-storybook.json"
      echo "Run /core:frameworks:storybook:init to set deployedUrl, or use --source local"
      exit 1
    fi
    TIMEOUT=$(jq -r '.screenshots.deployedStoryTimeoutMs // 5000' product/.pencil-storybook.json)
    DEFAULT_OUTPUT_SUBDIR="deployed"
    ;;
  *)
    echo "Unknown source: $SOURCE. Use 'local' or 'deployed'."
    exit 1
    ;;
esac
```

## Phase 2: scope resolution

Same pattern as `verify:health` Phase 1. Story IDs resolved
from scope (component / category / specific ID / all).

## Phase 3: output configuration

Determine output directory:

```bash
SCREENSHOT_DIR=$(jq -r '.screenshots.directory' product/.pencil-storybook.json)

if [ -n "$OUTPUT_DIR" ]; then
  # User-provided override
  OUT="$OUTPUT_DIR"
elif [ -n "$LABEL" ]; then
  # Custom label
  OUT="${SCREENSHOT_DIR}${LABEL}"
else
  OUT="${SCREENSHOT_DIR}${DEFAULT_OUTPUT_SUBDIR}"
fi

mkdir -p "$OUT"
```

Common label conventions:
- `before` / `after` for migration verification
- `baseline` for visual regression baselines
- `chromatic-failed` for chromatic comparison investigations
- Date-stamped: `2026-05-03-pre-upgrade`

## Phase 4: capture

For each story ID, sequentially:

```bash
VIEWPORT_OVERRIDE="${VIEWPORT:-$(jq -r '.screenshots.viewport' product/.pencil-storybook.json)}"
BROWSER="${BROWSER:-$(jq -r '.screenshots.browser' product/.pencil-storybook.json)}"

CAPTURED=0
FAILED=0

# First story per component takes longer
LAST_COMPONENT=""

for STORY_ID in $STORY_IDS; do
  # Extract component prefix (everything before --)
  COMPONENT="${STORY_ID%--*}"
  
  # Adjust timeout based on whether this is a new component
  if [ "$COMPONENT" != "$LAST_COMPONENT" ]; then
    CURRENT_TIMEOUT="$TIMEOUT"  # full first-story timeout
  else
    SUBSEQUENT=$(jq -r '.screenshots.subsequentStoryTimeoutMs // 8000' product/.pencil-storybook.json)
    CURRENT_TIMEOUT="$SUBSEQUENT"
  fi
  LAST_COMPONENT="$COMPONENT"
  
  OUTPUT_FILE="${OUT}/${STORY_ID}.png"
  
  npx playwright screenshot \
    --browser "$BROWSER" \
    --viewport-size "$VIEWPORT_OVERRIDE" \
    --wait-for-timeout "$CURRENT_TIMEOUT" \
    "${BASE_URL}/iframe.html?id=${STORY_ID}&viewMode=story" \
    "$OUTPUT_FILE" 2>/tmp/screenshot.log
  
  if [ $? -eq 0 ]; then
    CAPTURED=$((CAPTURED + 1))
    echo "✓ $STORY_ID"
  else
    FAILED=$((FAILED + 1))
    echo "✗ $STORY_ID — $(tail -1 /tmp/screenshot.log)"
  fi
  
  # Small breather to let dev server reset
  sleep 0.2
done
```

## Phase 5: report

```
=== Screenshot Capture Report ===
Source:          local (http://localhost:6006)
Scope:           atoms (37 stories)
Output:          .screenshots/local/
Browser:         chromium
Viewport:        800,600

Captured:        35 / 37
Failed:          2

Capture time:    4m 12s

Failed stories:
  core-atoms-button--with-icon
    Error: Timeout 30000ms exceeded
    
  core-atoms-link--external
    Error: net::ERR_CONNECTION_REFUSED

Output files in: .screenshots/local/
  core-atoms-avatar--default.png
  core-atoms-avatar--bordered.png
  ...
```

## Use as a building block

Other commands invoke this command for their capture needs.
Two patterns:

### Direct invocation (composing in shell)

```bash
# Capture before migration
/core:frameworks:storybook:verify:screenshot all --label before-migration

# After migration
/core:frameworks:storybook:verify:screenshot all --label after-migration

# Then diff via /core:tools:pixelmatch (or via /core:frameworks:storybook:migration:verify)
```

### Programmatic invocation (within commands)

When `verify:health`, `migration:verify`, or
`maintenance:remediation:storybook-drift` need screenshots,
they invoke this command's logic. The shared screenshot
capture pattern lives here; consumers reference the pattern
without re-implementing.

## What this command does NOT do

- **Compare screenshots.** That's `/core:tools:pixelmatch` or
  `/core:frameworks:storybook:migration:verify`.
- **Verify rendering correctness.** That's
  `verify:health`. This command captures whatever rendered
  (or didn't); it doesn't classify.
- **Manage screenshot directories beyond the current run.**
  Old screenshots aren't auto-cleaned. Users handle
  housekeeping (typically: keep before/after pairs;
  delete old debug captures).
- **Process in parallel.** Sequential or fail.

## Examples

```bash
# Capture all stories, default output
/core:frameworks:storybook:verify:screenshot

# Specific story
/core:frameworks:storybook:verify:screenshot core-atoms-button--default

# Component
/core:frameworks:storybook:verify:screenshot Button

# Category with custom output dir
/core:frameworks:storybook:verify:screenshot atoms --output-dir /tmp/atoms-shots

# Before/after labeling
/core:frameworks:storybook:verify:screenshot all --label baseline
# (do upgrade work)
/core:frameworks:storybook:verify:screenshot all --label post-upgrade

# Custom viewport and browser
/core:frameworks:storybook:verify:screenshot Button --viewport 1440,900 --browser firefox

# Deployed Storybook
/core:frameworks:storybook:verify:screenshot atoms --source deployed
```
