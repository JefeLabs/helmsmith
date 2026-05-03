---
description: Verify Storybook stories render without errors. Captures screenshots, detects broken/loading/blank states, classifies findings, produces a per-story report. The fastest signal that something is wrong with the component library; runs across all stories or scoped to a category/component.
argument-hint: [scope] [--json] [--limit N] [--no-screenshots]
allowed-tools: Read, Write, Edit, Bash
---

Verify Storybook stories render without errors. The
fastest-signal verification: which stories pass, which are
broken, which are stuck loading, which render blank.

Catches:
- React component errors (uncaught exceptions during render)
- Infinite loading (component renders a spinner that never
  resolves)
- Blank pages (errors swallowed by error boundaries)
- Missing dependencies (chunk load errors)
- Provider stack issues (story missing required context)

This is THE health check command — quick, broad, classifying.
Use as a first-pass before deeper verification.

## Phase 0: pre-flight

Per `frameworks/storybook/verify/_context.md`:
1. Verify storybook framework binding active in
   `.pencil-frameworks.json`
2. Verify `.pencil-storybook.json` exists with required fields
   (auto-trigger `/frameworks:storybook:init` for missing
   fields)
3. Verify Storybook is running at the manifest's `localUrl`
4. Verify Playwright tool available
5. Kill stale browser processes

## Phase 1: scope resolution

Per the shared scope resolution pattern in `verify/_context.md`:

```bash
# Read scope arg
SCOPE="${1:-all}"

# Fetch story index
INDEX=$(curl -sf "${LOCAL_URL}/index.json")

# Resolve story IDs from scope
STORY_IDS=$(resolve_scope_to_story_ids "$SCOPE" "$INDEX")

# Apply --limit if provided
if [ -n "$LIMIT" ]; then
  STORY_IDS=$(echo "$STORY_IDS" | head -n "$LIMIT")
fi

TOTAL=$(echo "$STORY_IDS" | wc -l)
echo "Health-checking $TOTAL stories..."
```

## Phase 2: per-story health check

For each story ID, sequentially:

```bash
SCREENSHOT_DIR=$(jq -r '.screenshots.directory' product/.pencil-storybook.json)
mkdir -p "${SCREENSHOT_DIR}health"

VIEWPORT=$(jq -r '.screenshots.viewport' product/.pencil-storybook.json)
BROWSER=$(jq -r '.screenshots.browser' product/.pencil-storybook.json)
TIMEOUT=$(jq -r '.screenshots.firstStoryTimeoutMs' product/.pencil-storybook.json)

for STORY_ID in $STORY_IDS; do
  STATUS="UNKNOWN"
  ISSUE=""
  
  # Capture screenshot (unless --no-screenshots)
  if [ "$NO_SCREENSHOTS" != "true" ]; then
    OUTPUT="${SCREENSHOT_DIR}health/${STORY_ID}.png"
    
    npx playwright screenshot \
      --browser "$BROWSER" \
      --viewport-size "$VIEWPORT" \
      --wait-for-timeout "$TIMEOUT" \
      "${LOCAL_URL}/iframe.html?id=${STORY_ID}&viewMode=story" \
      "$OUTPUT" 2>&1 | tee /tmp/playwright-out.log
    
    EXIT_CODE=$?
  fi
  
  # Classify based on outcome
  if [ "$EXIT_CODE" -ne 0 ]; then
    if grep -q "Timeout" /tmp/playwright-out.log; then
      STATUS="LOADING"
      ISSUE="Story didn't render within ${TIMEOUT}ms"
    else
      STATUS="FAIL"
      ISSUE=$(extract_error_from_log /tmp/playwright-out.log)
    fi
  else
    # Screenshot succeeded — check what's in it
    classify_screenshot "$OUTPUT"
    # Returns: PASS / BLANK / WARN
  fi
  
  RESULTS+="$STORY_ID|$STATUS|$ISSUE"$'\n'
done
```

### Screenshot classification

When the screenshot was captured successfully, check what
rendered:

```bash
classify_screenshot() {
  local img="$1"
  
  # Check pixel diversity — blank screenshots are mostly one color
  COLOR_COUNT=$(convert "$img" -unique-colors txt: 2>/dev/null | wc -l)
  
  if [ "$COLOR_COUNT" -lt 5 ]; then
    STATUS="BLANK"
    ISSUE="Screenshot has only ${COLOR_COUNT} unique colors; likely blank/empty render"
  else
    STATUS="PASS"
  fi
}
```

### Console error detection (when chrome-devtools MCP available)

For richer diagnostics on FAIL/LOADING/BLANK stories:

```bash
CHROME_DEVTOOLS_AVAILABLE=$(jq -r '.tools.chrome-devtools.interfaces.mcp.available // false' \
                                  product/.pencil-tools.json 2>/dev/null)

if [ "$CHROME_DEVTOOLS_AVAILABLE" = "true" ] && [ "$STATUS" != "PASS" ]; then
  # Use Chrome DevTools MCP to capture console errors
  CONSOLE_ERRORS=$(mcp_query_console_errors "${LOCAL_URL}/iframe.html?id=${STORY_ID}")
  if [ -n "$CONSOLE_ERRORS" ]; then
    ISSUE="${ISSUE}; Console: ${CONSOLE_ERRORS}"
  fi
fi
```

## Phase 3: classification rollup

Group results by status:

```bash
PASS_COUNT=$(echo "$RESULTS" | awk -F'|' '$2 == "PASS"' | wc -l)
WARN_COUNT=$(echo "$RESULTS" | awk -F'|' '$2 == "WARN"' | wc -l)
FAIL_COUNT=$(echo "$RESULTS" | awk -F'|' '$2 == "FAIL"' | wc -l)
LOADING_COUNT=$(echo "$RESULTS" | awk -F'|' '$2 == "LOADING"' | wc -l)
BLANK_COUNT=$(echo "$RESULTS" | awk -F'|' '$2 == "BLANK"' | wc -l)
```

## Phase 4: report

### Human-readable (default)

```
=== Storybook Health Report ===
Storybook URL: http://localhost:6006
Scope:         atoms
Stories:       37
Mode:          health (with screenshots)

Summary:
  PASS:    32  (86%)
  WARN:    2   (5%)
  FAIL:    3   (8%)
  LOADING: 0
  BLANK:   0

Verification time: 3m 47s
Screenshots saved: .screenshots/health/

=== FAIL (3) ===

core-atoms-button--with-icon
  Issue: React error during render
  Console: TypeError: Cannot read property 'icon' of undefined
           at Button (Button.tsx:42)
  Likely fix: Default args missing 'icon' prop; verify
              argTypes.icon has appropriate default.

core-atoms-link--external
  Issue: Component didn't render within 30000ms
  Console: ChunkLoadError: Loading chunk vendors-node_modules
           failed
  Likely fix: Restart Storybook; webpack chunk got stale.

core-atoms-rating--readonly
  Issue: Component rendered but with React error
  Console: Warning: Failed prop type: Invalid prop `value` of
           type `string` supplied to `Rating`, expected `number`
  Likely fix: Story args providing string for numeric prop;
              update Default story args.

=== WARN (2) ===

core-atoms-spinner--default
  Issue: Screenshot has 8 unique colors but spinner renders
  identically every frame; verify it's not stuck.
  Likely action: Manual review; spinner may be infinite-loop.

core-atoms-tag--with-icon
  Issue: Console warning detected.
  Console: Warning: validateDOMNesting: <a> cannot appear as
           a child of <a>
  Likely fix: Tag wraps a Link which contains an anchor;
              restructure to avoid nested anchors.

=== PASS (32) ===
[Names listed in compact form]
core-atoms-avatar--default, core-atoms-avatar--bordered, ...

Next steps:
  - Run /frameworks:storybook:verify:fix <story-id> for each
    FAIL to investigate and apply fixes
  - Run /frameworks:storybook:verify:fix WARN to address
    warning-level issues
  - Re-run /frameworks:storybook:verify:health after fixes
```

### JSON (`--json`)

```jsonc
{
  "version": 1,
  "runAt": "2026-05-03T17:14:32Z",
  "scope": "atoms",
  "totalStories": 37,
  "summary": {
    "PASS": 32,
    "WARN": 2,
    "FAIL": 3,
    "LOADING": 0,
    "BLANK": 0
  },
  "duration": "3m 47s",
  "screenshots": ".screenshots/health/",
  "results": [
    {
      "storyId": "core-atoms-button--with-icon",
      "status": "FAIL",
      "issue": "React error during render",
      "consoleErrors": ["TypeError: Cannot read property..."],
      "likelyFix": "Default args missing 'icon' prop..."
    }
    // ...
  ]
}
```

## Exit codes

- `0` — all stories PASS
- `1` — at least one WARN (and no FAIL/LOADING/BLANK)
- `2` — at least one FAIL/LOADING/BLANK

CI-friendly: exit code 0 means deploy-ready.

## What this command does NOT do

- **Modify code.** It surfaces broken stories; fixing happens
  via `/frameworks:storybook:verify:fix` (or manual edits).
- **Run accessibility checks.** That's
  `/frameworks:storybook:verify:a11y`.
- **Run interaction tests.** That's
  `/frameworks:storybook:verify:interactions`.
- **Verify deployed Storybook.** Default mode runs against
  local `localUrl`. The `--source deployed` mode for screenshot
  exists separately; health currently runs local.
- **Auto-restart Storybook.** When `ChunkLoadError` is
  detected, surfaces the suggestion; doesn't kill and
  restart the dev server.

## Examples

```bash
# Full health check
/frameworks:storybook:verify:health

# Just atoms
/frameworks:storybook:verify:health atoms

# Specific component
/frameworks:storybook:verify:health Button

# Specific story
/frameworks:storybook:verify:health core-atoms-button--with-icon

# Quick check without screenshots (faster)
/frameworks:storybook:verify:health --no-screenshots

# Limited batch (incremental work)
/frameworks:storybook:verify:health --limit 20

# CI integration
/frameworks:storybook:verify:health --json > health.json
```
