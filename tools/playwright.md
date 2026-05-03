---
description: Playwright browser automation. Captures screenshots, runs interaction tests, queries the DOM, evaluates JavaScript in browser contexts. Two interfaces — CLI (npx playwright) and MCP (when @anthropic/playwright-mcp or similar configured). Default preference is CLI. Heavily consumed by storybook verification, migration verification, and component-dedup visual regression.
argument-hint: <free-form-prompt> [--browser chromium|firefox|webkit] [--headless|--headed] [--viewport <w,h>]
allowed-tools: Read, Write, Edit, Bash, mcp__playwright__*
---

Direct invocation of Playwright for browser automation. The
fundamental capture and interaction primitive consumed by
storybook verify, migration verify, component-dedup, and any
command that needs to render or interact with web content.

## Phase 0: pre-flight

1. Read `product/.pencil-tools.json`. Verify `playwright` is
   active.

   ```bash
   ACTIVE=$(jq -r '.tools.playwright.active // false' \
                 product/.pencil-tools.json 2>/dev/null)
   if [ "$ACTIVE" != "true" ]; then
     echo "Playwright not active. Run /tools:setup playwright"
     exit 1
   fi
   ```

2. Determine preferred interface and verify availability:

   ```bash
   PREFERENCE=$(jq -r '.tools.playwright.preference // "cli"' \
                     product/.pencil-tools.json)
   
   case "$PREFERENCE" in
     cli)
       command -v npx >/dev/null 2>&1 || {
         echo "npx required. Install Node.js."
         exit 1
       }
       npx playwright --version >/dev/null 2>&1 || {
         echo "Playwright not installed. Run: npx playwright install"
         exit 1
       }
       ;;
     mcp)
       mcp_tool_available "mcp__playwright__navigate" || {
         echo "Playwright MCP not available in this session"
         exit 1
       }
       ;;
   esac
   ```

3. Verify browser binaries installed (CLI path):

   ```bash
   # Playwright stores browsers under ~/.cache/ms-playwright (Linux/macOS)
   # or %LOCALAPPDATA%\ms-playwright (Windows)
   if ! npx playwright list-browsers 2>/dev/null | grep -q chromium; then
     echo "Chromium browser not installed. Run: npx playwright install chromium"
     exit 1
   fi
   ```

## Phase 1: prompt interpretation

Classify operations into Playwright's primitives:

### Capture operations

- **Screenshot URL**: capture a page or element as PNG
- **Multiple screenshots**: batch capture across stories or
  pages
- **Full-page screenshot**: scrolling capture
- **Element screenshot**: bounded by selector

### Interaction operations

- **Click element**: locate and click
- **Fill form**: input text into fields
- **Wait for selector**: wait until element appears
- **Run play function**: Storybook interaction tests

### Query operations

- **Page content**: get HTML, text content
- **Element attributes**: query DOM properties
- **Console logs**: capture console output during page load
- **Network requests**: capture HAR or specific requests
- **Computed styles**: getComputedStyle for elements

### Diagnostic operations

- **Page errors**: capture JavaScript errors during render
- **Performance metrics**: capture Core Web Vitals
- **Accessibility tree**: capture A11y tree

## Phase 2: execution

### CLI path

The most common Playwright CLI invocations:

```bash
# Screenshot a URL
npx playwright screenshot \
  --browser chromium \
  --viewport-size 1280,800 \
  --wait-for-timeout 5000 \
  "$URL" "$OUTPUT.png"

# Element screenshot via inline script
cat > /tmp/playwright-script.js <<EOF
const { chromium } = require('@playwright/test');
(async () => {
  const browser = await chromium.launch({ headless: ${HEADLESS:-true} });
  const page = await browser.newPage({
    viewport: { width: ${WIDTH:-1280}, height: ${HEIGHT:-800} }
  });
  await page.goto('${URL}', { waitUntil: 'networkidle' });
  const element = await page.locator('${SELECTOR}');
  await element.screenshot({ path: '${OUTPUT}' });
  await browser.close();
})();
EOF
node /tmp/playwright-script.js

# Run interaction test
cat > /tmp/playwright-interaction.js <<EOF
const { chromium, expect } = require('@playwright/test');
(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  await page.goto('${URL}');
  await page.click('${BUTTON_SELECTOR}');
  await expect(page.locator('${EXPECTED_SELECTOR}')).toBeVisible();
  console.log('Interaction passed');
  await browser.close();
})();
EOF
```

### MCP path

When Playwright MCP available:

```
Operation: "screenshot localhost:6006/iframe.html?id=button--default"
  → mcp__playwright__navigate
    args: url: "http://localhost:6006/iframe.html?id=button--default"
  → mcp__playwright__screenshot
    args: path, viewport
```

MCP path is generally faster (no Node startup per invocation;
persistent browser session) but requires MCP server connected.

## Phase 3: browser process management

Playwright spawns browser processes; left running, they consume
memory and can interfere with subsequent invocations.

```bash
# Cleanup before invocation
pkill -f "Chromium\|Chrome.app\|chrome.exe" 2>/dev/null || true
sleep 1
```

For CI environments, headless mode with explicit cleanup:

```bash
# Trap to clean up browser process on exit
trap 'pkill -P $$ chromium 2>/dev/null' EXIT

npx playwright screenshot --browser chromium ... &
PLAYWRIGHT_PID=$!
wait $PLAYWRIGHT_PID
```

## Phase 4: result formatting

Screenshot operations report file paths:

```
=== Playwright Screenshot ===
URL:        http://localhost:6006/iframe.html?id=button--default
Browser:    chromium
Viewport:   1280x800
Output:     /tmp/screenshots/button-default.png
Size:       42 KB
Captured:   2026-05-04 09:15:22 UTC
```

Interaction tests report pass/fail:

```
=== Playwright Interaction ===
Test:       button-click-handler
Status:     PASS
Duration:   1.2s
```

Query operations return structured data (typically JSON):

```
=== Playwright Query ===
URL:        http://localhost:6006/iframe.html?id=button--default
Operation:  computed-styles
Selector:   button.primary
Properties:
  padding-left:  16px
  padding-right: 16px
  background:    rgb(63, 81, 181)
  border-radius: 8px
```

## Phase 5: error handling

| Error | Likely cause | Suite guidance |
|-------|--------------|----------------|
| `browserType.launch` failed | Browser binary missing | Run `npx playwright install` |
| Timeout 30000ms exceeded | Page didn't load in time | Increase timeout; check URL accessibility; check dev server running |
| Locator resolved to 0 elements | Selector wrong or content not rendered | Verify selector; add wait-for-selector |
| net::ERR_CONNECTION_REFUSED | Dev server not running | Start dev server; verify port |
| Browser closed unexpectedly | OOM or system issue | Reduce parallel browsers; check system memory |

## Cross-namespace integration

Playwright is heavily consumed by:

- **`frameworks/storybook/verify/health`** — screenshot all
  stories, classify rendering state
- **`frameworks/storybook/verify/screenshot`** — primary
  capture primitive
- **`frameworks/storybook/verify/fix`** — re-render after
  fixes; capture diagnostic context
- **`frameworks/storybook/verify/a11y`** — load story with
  axe-core injected
- **`frameworks/storybook/verify/interactions`** — run play
  functions
- **`frameworks/storybook/verify/deploy`** — render against
  built static output
- **`frameworks/storybook/migration/verify`** — Loop 1
  (functional), Loop 2 (font query), Loop 3 (spacing query)
- **`engineer/maintenance/remediation/component-dedup`** —
  visual regression baseline capture

Most invocations come from these commands programmatically;
direct user invocation of `/tools:playwright` is for ad-hoc
captures and testing.

## What this tool does NOT do

- **Replace Playwright Test runner.** For full Playwright Test
  suites, use `npx playwright test` directly. This integration
  is for ad-hoc invocations and as a building block.
- **Manage Playwright config files.** `playwright.config.ts`
  remains user-managed.
- **Install browsers automatically.** Surfaces missing browsers
  with install command; user runs install.
- **Run parallel captures.** Sequential only. The dev servers
  Playwright captures against (Storybook, Next.js dev) aren't
  parallel-safe.

## Examples

```bash
# Screenshot a URL
/tools:playwright "screenshot localhost:6006/iframe.html?id=button--default to /tmp/button.png"

# Element screenshot
/tools:playwright "screenshot the .hero-banner element on https://skoolscout.com to /tmp/hero.png at 1440x900"

# Capture page errors
/tools:playwright "load localhost:6006/iframe.html?id=card--broken and capture any console errors"

# Run an interaction
/tools:playwright "load localhost:6006/iframe.html?id=button--clickable, click the button, verify the count incremented"

# Performance metrics
/tools:playwright "load https://skoolscout.com and capture Core Web Vitals"
```

---

# Registry definition

## Tool metadata

```yaml
name: playwright
displayName: Playwright
provider: microsoft
category: browser-automation
optional: false   # required by storybook commands
```

## Interfaces

### CLI

```yaml
executable: npx playwright
detectionCommand: npx playwright --version
installCommand: |
  Install:
    npm install --save-dev @playwright/test
  Install browsers:
    npx playwright install
  Install specific browser:
    npx playwright install chromium
  System dependencies (Linux):
    npx playwright install-deps
notes: |
  Playwright bundles its own browser binaries via the install
  step. Don't rely on system Chrome/Firefox.
```

### MCP

```yaml
serverName: playwright
toolPrefix: mcp__playwright__
authMethod: none   # no auth required for local browser automation
notes: |
  Playwright MCP exposes structured browser operations.
  Faster than CLI for repeated invocations (persistent
  browser session). Detection: MCP tool prefix availability.
```

## Version constraint

Recommended: Playwright 1.40+ for stable browser pin pattern.
Detection script reads `package.json` engines field if present.

## Browser support

By default, supports:
- chromium (default; Chrome equivalent)
- firefox
- webkit (Safari equivalent)

Suite commands typically use chromium for consistency. Other
browsers used when cross-browser verification matters.

## Required by skillz commands

Auto-populated. Currently:
- /frameworks:storybook:verify:health
- /frameworks:storybook:verify:screenshot
- /frameworks:storybook:verify:fix
- /frameworks:storybook:verify:a11y
- /frameworks:storybook:verify:interactions
- /frameworks:storybook:verify:deploy
- /frameworks:storybook:migration:verify
- /engineer:maintenance:remediation:component-dedup

## Cross-tool dependencies

None. Playwright bundles its own browser binaries.

## System requirements

- Node.js 18+
- ~500 MB disk for browser binaries (per browser installed)
- Network access for initial browser install
- Linux: additional system libraries (libnss3, libatk-bridge,
  etc.) — installed via `npx playwright install-deps`
