---
description: Run interaction tests (Storybook play functions) to verify component behavior under user actions. Click, type, focus, drag patterns. Requires @storybook/test in the manifest's addons. Distinct from verify:health (renders only, no interaction) and from unit/integration tests (those test code; this tests rendered components).
argument-hint: [scope] [--source local|deployed] [--json] [--debug]
allowed-tools: Read, Write, Edit, Bash
---

Run Storybook interaction tests (`play` functions) to verify
component behavior when users interact with rendered components.

Tests:
- Click handlers fire correctly
- Form submissions trigger expected callbacks
- Keyboard navigation works
- Focus management correct
- State changes propagate
- Async interactions complete

Distinct from:
- **`verify:health`** — renders without errors (no interaction)
- **Unit tests** — test code paths in isolation
- **Integration tests** — test cross-module interactions in
  application context

This command tests **rendered components** in the way users
will actually use them.

## Phase 0: pre-flight

Per `frameworks/storybook/verify/_context.md`:
1. Storybook framework binding active
2. `.pencil-storybook.json` exists
3. Storybook running (for `--source local`) or deployedUrl
   configured (for `--source deployed`)
4. Playwright tool available
5. `@storybook/test` in manifest's addons:
   ```bash
   TEST_ADDON=$(jq -r '.addons.test // empty' product/.pencil-storybook.json)
   if [ -z "$TEST_ADDON" ]; then
     echo "@storybook/test is required for interaction verification."
     echo "Install: npm install --save-dev @storybook/test"
     echo "Then run /core:frameworks:storybook:init --update-addons"
     exit 1
   fi
   ```

## Phase 1: scope resolution

Same pattern as `verify:health`. Filter to stories that have
play functions:

```bash
# Story has interaction test if it has a play function
HAS_PLAY=$(grep -l "play:" "$STORY_FILE" 2>/dev/null)
```

If no stories in scope have play functions, surface and stop:

```
=== Interaction Verification ===
Scope:            Button (3 stories)
Stories with play functions: 0

No interaction tests defined in this scope. To add:
  /core:frameworks:storybook:stories:gen Button --include-interaction-tests
```

## Phase 2: per-story interaction test

For each story with a play function:

```bash
LOCAL_URL=$(jq -r '.storybook.localUrl' product/.pencil-storybook.json)
TIMEOUT=$(jq -r '.screenshots.firstStoryTimeoutMs' product/.pencil-storybook.json)

cat > /tmp/run-interaction.js <<'EOF'
const { chromium } = require('@playwright/test');

const STORY_URL = process.env.STORY_URL;
const STORY_ID = process.env.STORY_ID;
const TIMEOUT = parseInt(process.env.TIMEOUT || '30000');
const DEBUG = process.env.DEBUG === 'true';

(async () => {
  const browser = await chromium.launch({ headless: !DEBUG });
  const page = await browser.newPage();
  
  // Capture console for debugging
  const messages = [];
  page.on('console', msg => messages.push({ type: msg.type(), text: msg.text() }));
  page.on('pageerror', err => messages.push({ type: 'pageerror', text: err.message }));
  
  // Use Storybook's test runner mode if available
  // Storybook 8+ supports running play functions via URL parameter
  await page.goto(`${STORY_URL}&__test=true`, { waitUntil: 'networkidle', timeout: TIMEOUT });
  
  // Wait for play function to complete
  // Storybook surfaces test results via window.__STORYBOOK_TEST_RESULTS__
  const result = await page.waitForFunction(
    () => window.__STORYBOOK_TEST_RESULTS__ !== undefined,
    null,
    { timeout: TIMEOUT }
  ).then(() => page.evaluate(() => window.__STORYBOOK_TEST_RESULTS__));
  
  console.log(JSON.stringify({ result, messages }, null, 2));
  
  if (DEBUG) {
    console.log('\nPress Enter to close...');
    await new Promise(resolve => process.stdin.once('data', resolve));
  }
  
  await browser.close();
})();
EOF

for STORY_ID in $STORY_IDS; do
  STORY_URL="${LOCAL_URL}/iframe.html?id=${STORY_ID}&viewMode=story"
  
  STORY_URL="$STORY_URL" STORY_ID="$STORY_ID" TIMEOUT="$TIMEOUT" DEBUG="${DEBUG:-false}" \
    node /tmp/run-interaction.js > "/tmp/interaction-${STORY_ID}.json" 2>/tmp/interaction-error.log
  
  EXIT=$?
  
  if [ "$EXIT" -ne 0 ]; then
    STATUS="ERROR"
    ISSUE="Test runner crashed: $(cat /tmp/interaction-error.log | tail -3 | tr '\n' ';')"
  else
    OUTCOME=$(jq -r '.result.status // "unknown"' "/tmp/interaction-${STORY_ID}.json")
    case "$OUTCOME" in
      passed) STATUS="PASS" ;;
      failed) STATUS="FAIL"; ISSUE=$(jq -r '.result.error.message' "/tmp/interaction-${STORY_ID}.json") ;;
      timeout) STATUS="TIMEOUT"; ISSUE="Play function timed out at ${TIMEOUT}ms" ;;
      *) STATUS="UNKNOWN"; ISSUE="Unexpected outcome: $OUTCOME" ;;
    esac
  fi
  
  RESULTS+="$STORY_ID|$STATUS|$ISSUE"$'\n'
done
```

### Debug mode

When `--debug` is provided, run Playwright in non-headless
mode so the user can watch the interaction unfold:

```bash
DEBUG=true node /tmp/run-interaction.js
```

Useful when an interaction test fails inexplicably and you
need to see what's happening visually.

## Phase 3: classification

Each result classified:

| Status | Meaning |
|--------|---------|
| `PASS` | Play function completed; assertions passed |
| `FAIL` | Play function ran; assertion failed |
| `TIMEOUT` | Play function didn't complete within timeout |
| `ERROR` | Test runner couldn't load the story |
| `UNKNOWN` | Unexpected result shape |

## Phase 4: report

```
=== Interaction Test Report ===
Storybook URL:    http://localhost:6006
Scope:            atoms (37 stories)
With play func:   8 stories
Audited:          8

Summary:
  PASS:    6
  FAIL:    1
  TIMEOUT: 1
  ERROR:   0

=== FAIL ===

core-atoms-button--click-handler
  Issue: Expected onClick to have been called once, called 0 times
  Stack:
    at expect (button.stories.tsx:15:7)
    play (button.stories.tsx:18)
  
  Likely cause: onClick handler not connected. Check Default
  story args:
    args: { onClick: action('clicked'), ... }
  Or: button is rendered as <a> in this variant; click event
  goes to anchor instead.

=== TIMEOUT ===

core-atoms-input--debounced
  Issue: Play function timed out at 30000ms
  Likely cause: Play function awaits setTimeout that exceeds
  timeout, or async work never resolves.
  
  Debug: re-run with --debug to watch the interaction unfold:
    /core:frameworks:storybook:verify:interactions core-atoms-input--debounced --debug

=== PASS (6) ===
[Names listed]
core-atoms-tag--clickable, core-atoms-rating--interactive, ...

Next steps:
  - Investigate failures with /core:frameworks:storybook:verify:fix
  - Re-run after fixes
```

## Exit codes

- `0` — all interactions PASS
- `1` — at least one TIMEOUT or UNKNOWN (and no FAIL/ERROR)
- `2` — at least one FAIL or ERROR

## What this command does NOT do

- **Generate play functions.** Story generation
  (`/core:frameworks:storybook:stories:gen`) creates play functions
  when applicable; this command runs them.
- **Modify component code.** Failures may indicate component
  bugs OR story bugs; investigation routes to `verify:fix`
  for stories or manual edit for components.
- **Replace unit/integration tests.** Play functions test
  rendered behavior in Storybook context. They complement,
  don't replace, test suites at other layers.
- **Run all stories.** Filters to stories with play functions
  only. Stories without interaction tests are skipped.

## Examples

```bash
# All stories with play functions
/core:frameworks:storybook:verify:interactions

# Specific component
/core:frameworks:storybook:verify:interactions Button

# Specific story
/core:frameworks:storybook:verify:interactions core-atoms-button--click-handler

# Debug mode (visible browser)
/core:frameworks:storybook:verify:interactions core-atoms-button--click-handler --debug

# Run against deployed storybook
/core:frameworks:storybook:verify:interactions atoms --source deployed

# CI integration
/core:frameworks:storybook:verify:interactions --json > interactions.json
```
