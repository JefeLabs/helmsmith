---
description: Chrome DevTools Protocol (CDP) for rich DOM inspection, console capture, network monitoring, and performance profiling. MCP-preferred (Chrome DevTools MCP) with CLI fallback via Playwright wrapper. Used by storybook verify:fix and migration:verify when diagnostic depth matters more than capture speed.
argument-hint: <free-form-prompt> [--url <url>] [--use-cli|--use-mcp]
allowed-tools: Read, Write, Edit, Bash, mcp__chrome-devtools__*
---

Direct invocation of Chrome DevTools Protocol for richer
browser introspection than Playwright's standard API exposes.
Used when commands need detailed console errors, network
timing, performance metrics, or accessibility tree access.

## Phase 0: pre-flight

1. Verify chrome-devtools active in tools manifest:

   ```bash
   ACTIVE=$(jq -r '.tools."chrome-devtools".active // false' \
                 product/.pencil-tools.json 2>/dev/null)
   if [ "$ACTIVE" != "true" ]; then
     echo "Chrome DevTools not active. Run /core:tools:setup chrome-devtools"
     exit 1
   fi
   ```

2. Determine preferred interface:

   ```bash
   PREFERENCE=$(jq -r '.tools."chrome-devtools".preference // "mcp"' \
                     product/.pencil-tools.json)
   ```

   Note the preference default is **MCP** for this tool (vs
   most tools which default to CLI). The Chrome DevTools MCP
   exposes structured operations that are awkward to invoke
   via raw CDP.

3. Verify chosen interface available:

   ```bash
   case "$PREFERENCE" in
     mcp)
       mcp_tool_available "mcp__chrome-devtools__navigate" || {
         echo "Chrome DevTools MCP not connected"
         echo "Falling back to CLI? [y/N]"
         # ... interactive prompt
       }
       ;;
     cli)
       command -v google-chrome >/dev/null 2>&1 || \
         command -v "Google Chrome" >/dev/null 2>&1 || {
         echo "Chrome browser not found. Required for CDP."
         echo "macOS: brew install --cask google-chrome"
         echo "Linux: see https://www.google.com/chrome/"
         exit 1
       }
       ;;
   esac
   ```

## Phase 1: prompt interpretation

Operations Chrome DevTools handles best:

### Console capture

- **Console errors during page load** — full stack traces,
  source mapping
- **Console warnings** — useful for React deprecation warnings,
  prop type mismatches
- **Custom log filtering** — filter by source, severity,
  pattern

### Network capture

- **Request inventory** — all requests during page load
- **Specific request details** — headers, timing, response
- **Failed requests** — 4xx/5xx, connection failures
- **HAR export** — full network trace

### DOM inspection

- **Computed styles** — full CSS cascade for any selector
- **Layout boxes** — getBoundingClientRect data per element
- **Accessibility tree** — full ARIA tree (richer than axe-core
  output)
- **Event listeners** — what listeners attached to elements

### Performance profiling

- **Core Web Vitals** — LCP, FID, CLS, INP
- **Long tasks** — main-thread blocking work
- **Layout shift events** — what caused CLS

### Font and resource queries

- **Loaded fonts** — `document.fonts` with full resolution
- **Loaded stylesheets** — origin and content
- **Loaded images** — natural vs displayed size

## Phase 2: execution

### MCP path (preferred)

Chrome DevTools MCP exposes structured operations:

```
Operation: "capture all console errors during load of localhost:6006"
  → mcp__chrome-devtools__navigate {url}
  → mcp__chrome-devtools__get_console_messages {filter: error}

Operation: "show me computed styles for button.primary on this page"
  → mcp__chrome-devtools__evaluate
    args: expression: "getComputedStyle(document.querySelector('button.primary'))"

Operation: "capture network requests for the page"
  → mcp__chrome-devtools__navigate
  → mcp__chrome-devtools__get_network_requests
```

The MCP server handles the WebSocket connection to a Chrome
instance and exposes operations as tools. Faster than spawning
Chrome per invocation.

### CLI path (fallback)

When MCP unavailable, CDP via Playwright as a thin wrapper:

```bash
cat > /tmp/cdp-script.js <<EOF
const { chromium } = require('@playwright/test');

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  
  // Get CDP session
  const client = await context.newCDPSession(page);
  
  // Enable console capture
  const consoleMessages = [];
  page.on('console', msg => consoleMessages.push({
    type: msg.type(),
    text: msg.text(),
    location: msg.location()
  }));
  
  // Enable network capture via CDP
  await client.send('Network.enable');
  const networkRequests = [];
  client.on('Network.responseReceived', event => {
    networkRequests.push({
      url: event.response.url,
      status: event.response.status,
      timing: event.response.timing
    });
  });
  
  await page.goto('${URL}', { waitUntil: 'networkidle' });
  
  console.log(JSON.stringify({
    console: consoleMessages,
    network: networkRequests
  }, null, 2));
  
  await browser.close();
})();
EOF
node /tmp/cdp-script.js
```

This is slower than MCP but works without MCP server.

## Phase 3: result formatting

### Console capture

```
=== Console Capture: http://localhost:6006/iframe.html?id=button--broken ===
Page load: 2.3s

Errors (1):
  TypeError: Cannot read property 'icon' of undefined
    at Button (Button.tsx:42:18)
    at renderWithHooks (react-dom.js:14985:18)
    
Warnings (2):
  Failed prop type: Invalid prop `value` of type `string` supplied to `Rating`
    at Rating.tsx:12
  
  React does not recognize the `customProp` attribute on a DOM element
    at Avatar.tsx:8

Logs (3):
  [info] Storybook story rendered: button--broken
  [debug] Theme: light
  [debug] Locale: en-US
```

### Computed styles

```
=== Computed Styles ===
URL:      http://localhost:6006/iframe.html?id=button--default
Selector: button.primary

Layout:
  width:        128px (declared 8rem)
  height:       40px
  padding:      0px 16px
  margin:       0px

Visual:
  background-color: rgb(63, 81, 181)
  color:            rgb(255, 255, 255)
  border:           none
  border-radius:    8px

Typography:
  font-family:  "Inter", -apple-system, BlinkMacSystemFont, sans-serif
  font-size:    14px
  font-weight:  500
  line-height:  20px

Behavior:
  cursor:    pointer
  position:  relative
```

### Network requests

```
=== Network Requests ===
URL: http://localhost:6006/iframe.html?id=button--default
Total requests: 47
Total transfer: 1.2 MB
Page load: 2.3s

Errors (0):
  All requests succeeded

Slow requests (>1s):
  fonts.googleapis.com/css2?family=Inter (1.8s) — blocking

Largest:
  iframe.bundle.js (487 KB)
  vendors-node_modules.bundle.js (412 KB)
  
Cached (vs fresh):
  Cached: 12 (304 Not Modified)
  Fresh:  35
```

## Phase 4: error handling

| Error | Likely cause | Suite guidance |
|-------|--------------|----------------|
| MCP server not connected | Tool not configured in environment | Configure Chrome DevTools MCP server, or use --use-cli |
| Chrome not found | Browser missing | Install Chrome (system or Playwright bundled chromium works as fallback) |
| WebSocket connection failed | Chrome not in debug mode | Use the wrapper which handles this; raw CDP requires `--remote-debugging-port=9222` |
| Page didn't load | URL wrong or server down | Verify URL accessibility |

## Cross-namespace integration

Chrome DevTools is consumed by:

- **`frameworks/storybook/verify/fix`** — diagnostic depth
  for broken stories (richer console errors than Playwright's
  default capture)
- **`frameworks/storybook/verify/a11y`** — full accessibility
  tree (axe-core covers WCAG; CDP exposes raw a11y tree for
  custom checks)
- **`frameworks/storybook/migration/verify`** — Loop 2 (font
  query via document.fonts), Loop 3 (computed styles for
  spacing), Loop 5 (color extraction support)
- **`engineer/maintenance/remediation/component-dedup`** —
  computed styles comparison for near-duplicate detection
- **Performance debugging workflows** (when added)

## What this tool does NOT do

- **Replace Playwright.** Playwright handles screenshots and
  basic interactions; CDP is for deep inspection. Most
  workflows compose both.
- **Browser automation for tests.** Use Playwright for tests;
  CDP is for inspection during diagnosis.
- **Lighthouse audits.** Lighthouse is a separate tool; CDP
  exposes the underlying primitives but not Lighthouse's
  scoring.
- **Network mocking.** Playwright's route handlers do this;
  CDP could but the abstraction lives in Playwright.

## Examples

```bash
# Capture console during load
/core:tools:chrome-devtools "load localhost:6006/iframe.html?id=card--default and capture all console messages"

# Computed styles for an element
/core:tools:chrome-devtools "show me computed styles for button.primary on localhost:6006/iframe.html?id=button--default"

# Network inventory
/core:tools:chrome-devtools "capture all network requests during load of https://skoolscout.com"

# Font query
/core:tools:chrome-devtools "list all loaded fonts on localhost:6006/iframe.html?id=heading--default"

# Performance metrics
/core:tools:chrome-devtools "capture Core Web Vitals for https://skoolscout.com"
```

---

# Registry definition

## Tool metadata

```yaml
name: chrome-devtools
displayName: Chrome DevTools Protocol
provider: google-chromium
category: browser-inspection
optional: true   # storybook commands degrade gracefully without it
```

## Interfaces

### CLI

```yaml
executable: google-chrome (or playwright-bundled chromium)
detectionCommand: |
  command -v google-chrome || \
  command -v "Google Chrome" || \
  npx playwright list-browsers | grep chromium
installCommand: |
  Chrome:
    macOS: brew install --cask google-chrome
    Linux: see https://www.google.com/chrome/
    Windows: winget install Google.Chrome
  Or: rely on Playwright-bundled chromium (already installed
      with Playwright)
notes: |
  CLI path uses Playwright as a thin CDP wrapper. Direct CDP
  invocation requires Chrome with --remote-debugging-port=9222
  but the suite never invokes Chrome that way (security risk).
```

### MCP

```yaml
serverName: chrome-devtools
toolPrefix: mcp__chrome-devtools__
authMethod: none
notes: |
  Chrome DevTools MCP server (multiple implementations exist;
  community servers + potential official Anthropic server).
  Strongly preferred when available — much faster than CLI
  wrapper, and exposes operations more naturally.
```

## Required by skillz commands

Auto-populated. Currently:
- /core:frameworks:storybook:verify:fix (optional)
- /core:frameworks:storybook:verify:a11y (optional)
- /core:frameworks:storybook:migration:verify (Loops 2, 3, 5)
- /engineer:maintenance:remediation:component-dedup (optional)

Optional flag means commands fall back to Playwright when
Chrome DevTools unavailable, but with reduced diagnostic
richness.

## Cross-tool dependencies

- Chrome browser (system or Playwright-bundled)
- Playwright (when using CLI fallback wrapper)
- WebSocket connectivity to local Chrome (CLI path)

## System requirements

- Chrome browser ≥ 110 (CDP API stable from there)
- Network: localhost-only (no external)
