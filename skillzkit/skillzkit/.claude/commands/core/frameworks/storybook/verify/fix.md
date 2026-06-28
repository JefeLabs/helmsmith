---
description: Investigate and fix broken Storybook stories. Diagnoses why a story is failing (component error, missing dependencies, prop mismatch, provider stack issue, story args invalid) and applies minimal fixes. Distinct from health (which surfaces) and from migration:fix-pattern (which handles framework-version-specific drift).
argument-hint: <story-id-or-component-or-category> [--no-apply] [--strict-investigation]
allowed-tools: Read, Write, Edit, Bash
---

Investigate and fix broken Storybook stories. Diagnoses
failures, classifies root cause, applies minimal targeted
fixes. The remediation companion to `verify:health`.

Handles five failure classes:

- **BROKEN** — React component throws during render
- **LOADING** — Component renders a loading state that never
  resolves
- **BLANK** — Component renders nothing (often error
  swallowed by error boundary)
- **MISSING** — Story file expected but absent
- **CONFIG** — Storybook config issue (missing addon, broken
  decorator, malformed args)

## Phase 0: pre-flight

Per `frameworks/storybook/verify/_context.md`:
1. Storybook framework binding active
2. `.pencil-storybook.json` exists
3. Storybook running
4. Playwright tool available
5. Chrome DevTools MCP available (preferred for diagnostic
   depth; CLI fallback works but loses some richness)
6. Kill stale browser processes

## Phase 1: scope resolution

Same pattern as `verify:health`. Resolves to a list of story
IDs. Each story is investigated and (unless `--no-apply`)
fixed sequentially.

## Phase 2: per-story investigation

For each broken story:

### Step 1: Reproduce the issue

```bash
# Capture screenshot for visual reference
SCREENSHOT_DIR=$(jq -r '.screenshots.directory' product/.pencil-storybook.json)
DEBUG_DIR="${SCREENSHOT_DIR}debug"
mkdir -p "$DEBUG_DIR"

OUTPUT="${DEBUG_DIR}/${STORY_ID}.png"
TIMEOUT=$(jq -r '.screenshots.firstStoryTimeoutMs' product/.pencil-storybook.json)

# Capture with longer timeout to differentiate slow vs broken
npx playwright screenshot \
  --browser chromium \
  --viewport-size 800,600 \
  --wait-for-timeout "$TIMEOUT" \
  "${LOCAL_URL}/iframe.html?id=${STORY_ID}&viewMode=story" \
  "$OUTPUT" 2>/tmp/screenshot.log

CAPTURE_EXIT=$?
```

### Step 2: Capture console errors

When Chrome DevTools MCP available, query console:

```bash
# Use mcp__chrome-devtools__* to load page and capture errors
CONSOLE=$(mcp_query_console "${LOCAL_URL}/iframe.html?id=${STORY_ID}&viewMode=story")
```

Without MCP, use Playwright in scripting mode:

```bash
# Spawn Playwright with capture script
cat > /tmp/capture-errors.js <<EOF
const { chromium } = require('@playwright/test');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      errors.push({ type: msg.type(), text: msg.text() });
    }
  });
  page.on('pageerror', err => {
    errors.push({ type: 'exception', text: err.message, stack: err.stack });
  });
  await page.goto('${LOCAL_URL}/iframe.html?id=${STORY_ID}&viewMode=story');
  await page.waitForTimeout(${TIMEOUT});
  console.log(JSON.stringify(errors, null, 2));
  await browser.close();
})();
EOF
CONSOLE=$(node /tmp/capture-errors.js)
```

### Step 3: Read story file and component file

```bash
# Find the story file from story ID
STORY_TITLE=$(echo "$INDEX" | jq -r ".entries[\"$STORY_ID\"].title")
STORY_FILE=$(echo "$INDEX" | jq -r ".entries[\"$STORY_ID\"].importPath")
COMPONENT_FILE=$(grep -o "from \"\\./[^\"]*\"" "$STORY_FILE" | head -1 | sed 's/from "\.\///' | sed 's/"//' )

# Read both for analysis
STORY_SRC=$(cat "$STORY_FILE")
COMPONENT_SRC=$(cat "$STORY_FILE_DIR/$COMPONENT_FILE.tsx" 2>/dev/null || \
                cat "$STORY_FILE_DIR/$COMPONENT_FILE.jsx" 2>/dev/null)
```

### Step 4: Classify the failure

Based on console errors and screenshot:

```
| Pattern | Class | Likely Root Cause |
|---------|-------|-------------------|
| TypeError: Cannot read property X of undefined | BROKEN | Story args missing required prop X |
| Failed prop type: Invalid prop X of type Y, expected Z | BROKEN | Story args have wrong type |
| ChunkLoadError: Loading chunk vendors failed | BROKEN | Webpack chunk stale; restart Storybook |
| (No errors but blank screen) | BLANK | Error swallowed by boundary; check componentDidCatch |
| (No errors but spinner persists) | LOADING | Component awaits dependency that never resolves |
| Module not found: Can't resolve 'X' | BROKEN | Component imports module not in dependencies |
| useContext called outside Provider | BROKEN | Story missing required provider in decorators |
| Hydration failed because the initial UI does not match | BROKEN | SSR/client mismatch (Next.js specific) |
```

### Step 5: Determine fix strategy

Based on classification, propose minimal fix:

| Class | Fix Strategy |
|-------|--------------|
| BROKEN: missing prop | Update Default story args to provide required prop |
| BROKEN: wrong type | Update Default story args with correct type |
| BROKEN: chunk error | Suggest user restart Storybook (don't auto-do) |
| BROKEN: missing module | Surface for manual review (might be import typo, might be missing dependency) |
| BROKEN: missing provider | Add decorator to story or to global preview decorators |
| LOADING: dependency never resolves | Add MSW handler stub or surface for review |
| BLANK: swallowed error | Surface componentDidCatch suspects for manual review |
| MISSING: story file absent | Suggest `/core:frameworks:storybook:stories:gen ComponentName` |
| CONFIG: addon missing | Surface install command for missing addon |

### Step 6: Apply fix (unless --no-apply)

Generate the targeted edit:

```bash
case "$CLASS" in
  BROKEN_MISSING_PROP)
    # Add missing prop to Default story args
    PROP_NAME="$DETECTED_PROP"
    SUGGESTED_VALUE=$(suggest_default_value_for_prop "$PROP_NAME" "$COMPONENT_SRC")
    
    # Use str_replace tool to update the story file
    apply_edit "$STORY_FILE" "args: {" "args: { ${PROP_NAME}: ${SUGGESTED_VALUE},"
    ;;
    
  BROKEN_WRONG_TYPE)
    # Update prop value to correct type
    apply_edit "$STORY_FILE" "$BAD_VALUE" "$CORRECT_VALUE"
    ;;
    
  BROKEN_MISSING_PROVIDER)
    # Add decorator that wraps in provider
    DECORATOR_CODE=$(generate_provider_decorator "$MISSING_PROVIDER")
    apply_edit "$STORY_FILE" "decorators: \[" "decorators: [\n  $DECORATOR_CODE,"
    ;;
    
  # ... etc.
esac
```

### Step 7: Verify the fix

After applying, re-render to confirm:

```bash
# Wait for HMR pickup
sleep 3

# Re-screenshot
npx playwright screenshot \
  --browser chromium \
  --viewport-size 800,600 \
  --wait-for-timeout "$SUBSEQUENT_TIMEOUT" \
  "${LOCAL_URL}/iframe.html?id=${STORY_ID}&viewMode=story" \
  "${DEBUG_DIR}/${STORY_ID}-fixed.png" 2>/dev/null

# Check whether story now renders
classify_screenshot "${DEBUG_DIR}/${STORY_ID}-fixed.png"

if [ "$STATUS" = "PASS" ]; then
  echo "✓ Fix verified for $STORY_ID"
else
  echo "⚠ Fix applied but story still failing; manual review needed"
fi
```

### Step 8: Lint after edit

```bash
LINT_CMD=$(jq -r '.lint.command' product/.pencil-storybook.json)
LINT_DIR=$(jq -r '.lint.workingDir' product/.pencil-storybook.json)

(cd "$LINT_DIR" && $LINT_CMD --files "$STORY_FILE")
```

## Phase 3: cross-story patterns

If multiple stories have the same failure root cause, surface
the pattern:

> Detected pattern: 5 stories in core-atoms-* fail with
> "Cannot read property 'icon' of undefined".
>
> Common cause likely: argTypes for icon prop have no default;
> stories don't provide icon in args.
>
> Fix once for all 5 stories? [Y/n]

Pattern detection looks for:
- Same error message across stories
- Same component family with same error
- Same line number / stack frame across stories

When patterns found and user confirms, apply same fix to all
matching stories in one batch.

## Phase 4: report

```
=== Story Fix Report ===
Investigated:    8 broken stories
Auto-fixed:      6
Manual review:   2

=== AUTO-FIXED ===

core-atoms-button--with-icon
  Class:   BROKEN — missing prop
  Issue:   Story args missing required 'icon' prop
  Fix applied: Added `icon: "star"` to Default story args
  Verification: PASS

core-atoms-button--loading
  Class:   BROKEN — wrong type
  Issue:   Story args provided `loading: "true"` (string)
  Fix applied: Changed to `loading: true` (boolean)
  Verification: PASS

[... 4 more]

=== MANUAL REVIEW ===

core-atoms-link--external
  Class:   BROKEN — missing module
  Issue:   Component imports `next/router` but project uses
           Next 15 (next/navigation)
  Suggested: Update component import to use new Next 15
             pattern. Not auto-fixed (component code change).

core-atoms-rating--readonly
  Class:   CONFIG — addon issue
  Issue:   Story uses @storybook/test play function but
           addon not in current addons list
  Suggested: Run /core:frameworks:storybook:init --update-addons
             to detect and add @storybook/test, OR remove
             play function from story.

Lint pass: ✓ All auto-fixed files lint clean.

Next steps:
  - Re-run /core:frameworks:storybook:verify:health to confirm
    all stories now PASS
  - Address manual-review items
```

## Pattern: cross-routine integration

`engineer:maintenance:remediation:storybook-drift` (when
built) invokes this command as part of its drift cleanup
sequence. After health check identifies broken stories, drift
routine dispatches them to `verify:fix` for batch remediation.

The `--strict-investigation` flag enables deeper diagnostics
useful in drift cycles where systematic root-cause analysis
matters more than speed.

## What this command does NOT do

- **Modify component source code.** Fix scope is limited to
  story files (`.stories.tsx`/`.stories.ts`). Component code
  changes route through manual edit or framework-binding
  rebuild.
- **Restart Storybook.** When chunk errors detected, suggests
  restart but doesn't kill the dev server.
- **Install missing addons.** Surfaces the gap; install is
  user's call (or `/core:frameworks:storybook:init --update-addons`).
- **Generate missing stories.** Routes to
  `/core:frameworks:storybook:stories:gen` when classification is
  MISSING.
- **Handle framework-version-migration drift.** That's
  `/core:frameworks:storybook:migration:fix-pattern`. This command
  handles general "story is broken" cases; migration-specific
  patterns are separate.

## Examples

```bash
# Fix specific broken story
/core:frameworks:storybook:verify:fix core-atoms-button--with-icon

# Fix all broken stories in a component
/core:frameworks:storybook:verify:fix Button

# Fix everything broken (use after verify:health)
/core:frameworks:storybook:verify:fix all

# Investigation only (no auto-fix)
/core:frameworks:storybook:verify:fix core-atoms-button--with-icon --no-apply

# Deeper investigation (used in drift cycles)
/core:frameworks:storybook:verify:fix all --strict-investigation
```
