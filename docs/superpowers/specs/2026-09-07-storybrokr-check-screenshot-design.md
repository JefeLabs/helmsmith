# storybrokr: `check` and `screenshot` tools

**Date:** 2026-09-07
**Status:** approved design, pending implementation plan
**Package:** `@helmsmith/storybrokr` 0.1.0 → 0.2.0 (minor)
**Predecessor:** `2026-09-06-storybrokr-design.md`

## Problem

Agents using storybrokr against a real host (skoolscout `app-ui`, 2026-09-06
sweep) repeated two manual browser rituals on every story:

1. To confirm a reproduction they loaded the story in a browser and eyeballed
   whether its `play` function ran clean. Nothing reported pass/fail.
2. To capture evidence they opened DevTools, resized the viewport, reloaded,
   and screenshotted. Claude Code's screenshot tool also refuses paths outside
   the workspace, so evidence could not be saved to a scratchpad.

Both rituals are the same three steps (load iframe, wait for the story to
settle, observe) done by hand. storybrokr should do them.

## Goals

- `storybrokr_check`: run one or more stories headlessly and return pass/fail
  per story, with the error when it fails.
- `storybrokr_screenshot`: write a PNG for one story at a requested viewport
  to any path the caller names.
- Both available from the CLI and MCP with identical semantics.
- No dependency on the host's test tooling. Works on any Storybook 7+ host.

## Non-goals

- Visual diffing, baselines, or image comparison.
- Running the host's `@storybook/test-runner` or vitest addon. Out of scope;
  a future `engine` option could add it.
- Accessibility or coverage reporting.
- Parallel story execution. Sequential in one context is enough for the
  single-component instances storybrokr brokers.

## Decisions (with the alternatives rejected)

| Decision | Chosen | Rejected |
|---|---|---|
| Browser dependency | Hard dependency on `playwright`, browser fetched lazily on first use | Resolve from host repo (fragile); `playwright-core` + system Chrome (fails in CI containers); postinstall fetch (pnpm 10 and Bun block dependency lifecycle scripts by default, so it silently no-ops) |
| Pass/fail engine | Storybook preview channel events | Shell out to host test runner (heavy, host-dependent) |
| Ready signal | `storyRenderPhaseChanged: completed` + network idle + optional `waitFor` | `storyRendered` alone (captures Suspense fallbacks); fixed settle delay (flaky or slow) |
| Browser ownership | Daemon owns one Chromium, reused across calls | Per-call launch in the MCP/CLI process (2s+ per call, no sharing) |

## 1. Browser runtime

`playwright` is added to `dependencies`. `tsup` keeps it external (it already
externalizes every non-`@helmsmith` package).

**Daemon-owned browser.** `src/server/browser.ts` exports a `BrowserPool`
with `acquire(): Promise<BrowserContext>` and `release()`. The first
`acquire` launches headless Chromium; later calls reuse it. Each request gets
a fresh `BrowserContext` (isolated cookies and storage, per-request viewport)
and closes it when done. The browser itself closes on daemon shutdown and
after 10 minutes with no contexts open (`browserIdleMinutes` in
`~/.storybrokr/config.json`, default 10, `0` disables).

**Lazy install.** Before launching, the pool checks
`chromium.executablePath()` exists. If not, it spawns the installer
(`node <playwright pkg>/cli.js install chromium`, resolved with
`createRequire` from storybrokr's own location so global installs work),
pipes its output into the daemon log, and awaits exit. Concurrent acquires
await the same install promise. On non-zero exit the pool throws
`BROWSER_UNAVAILABLE` with the installer's last 20 lines as `logTail`. The
install is a one-time cost per machine; Playwright caches the browser in its
default location.

**Doctor.** `storybrokr doctor` gains a `browser` row: `chromium <version>
at <path>` when present, `not installed; fetched on first check/screenshot`
when absent. Never triggers the install itself.

## 2. Story settle protocol

`src/lib/settle.ts` is shared by both tools and has two halves.

**In-page recorder (init script).** Injected with `context.addInitScript`
before navigation. It polls for `window.__STORYBOOK_ADDONS_CHANNEL__` (up to
the request timeout), then subscribes to:

- `storyRenderPhaseChanged` → records `{ phase, storyId }`
- `storyErrored`, `storyThrewException`, `playFunctionThrewException`,
  `unhandledErrorsWhilePlaying`, `storyMissing` → records
  `{ event, message, stack? }`

Events append to `window.__STORYBROKR__.events`. Nothing else is touched in
the page.

**Node-side reducer (pure).** `reduceSettle(events): SettleState` returns
one of:

- `{ kind: 'pending' }` — no terminal signal yet
- `{ kind: 'pass', phase: 'completed', played: boolean }` — `played` is true
  when a `playing` phase was observed before `completed`
- `{ kind: 'fail', reason: string, event: string, stack?: string }` — first
  exception event, or phase `errored` / `aborted`, or `storyMissing`

Being pure, it is unit-tested against recorded event lists with no browser.

**Driver.** `settleStory(page, { iframeUrl, waitFor?, timeoutMs })`:

1. `page.goto(iframeUrl)`
2. `page.waitForFunction` polling `reduceSettle(window.__STORYBROKR__.events)`
   until not `pending`, bounded by `timeoutMs`
3. On `pass`: `page.waitForLoadState('networkidle')`, then if `waitFor` is
   given, `page.waitForSelector(selector)` or `page.getByText(text)` with the
   remaining budget
4. Returns the `SettleState`, or `{ kind: 'timeout', lastPhase? }` if the
   budget elapses at any step

`waitFor` shape: `{ selector: string } | { text: string }`. The SKILL.md
guidance about Suspense fallbacks maps directly onto `waitFor.text`.

## 3. Routes, client, CLI, MCP

Every call touches the instance (resets the TTL clock) and requires
`status === 'ready'`; other statuses return the existing not-ready error.

### check

- **Route:** `POST /v1/instances/:id/check`
- **Body:** `{ storyIds?: string[], waitFor?, timeoutMs?: number }`.
  `timeoutMs` is per story, default 30000, max 300000. Omitted `storyIds`
  means every story in `record.stories`. Unknown ids → `STORY_NOT_FOUND`
  listing the unknown ids; nothing runs.
- **Response:** `{ instanceId, results: CheckResult[], summary: { pass, fail, timeout } }`
  with `CheckResult = { storyId, status: 'pass' | 'fail' | 'timeout', played: boolean, durationMs: number, error?: { message, event, stack? } }`
- **Behavior:** one browser context, stories sequential in `record.stories`
  order, one page reused with a `goto` per story. A failing or timed-out
  story is a result row, never an HTTP error; HTTP errors are reserved for
  instance and browser problems.
- **CLI:** `storybrokr check <id> [--story <storyId>]... [--wait-for-text <t> | --wait-for-selector <s>] [--timeout <ms>] [--json]`.
  Human output is one line per story (`✓ pass`, `✗ fail: <message>`,
  `⏱ timeout`) plus the summary. Exit code 1 when any story is not `pass`.
- **MCP:** `storybrokr_check { id, storyIds?, waitFor?, timeoutMs? }` → the
  response as JSON text. `isError` only for HTTP errors, so a failing story
  is still a normal tool result the agent can read.

### screenshot

- **Route:** `POST /v1/instances/:id/screenshot`
- **Body:** `{ storyId: string, outPath?: string, viewport?: { width, height }, clip?: 'root' | 'viewport' | 'page', waitFor?, timeoutMs?: number }`.
  Defaults: viewport `1280x720`, clip `root`, timeout 30000.
- **Response:** `{ instanceId, storyId, path, width, height, durationMs }`
- **Behavior:** new context at the requested viewport; `settleStory`; on
  `pass`, capture. `root` clips to the bounding box of `#storybook-root`
  (falls back to `viewport` when the box is empty); `viewport` captures the
  visible area; `page` is `fullPage: true`. On `fail` or `timeout` the route
  returns `STORY_TIMEOUT` or `STORY_FAILED` and writes nothing — a
  screenshot of a broken story is not evidence.
- **Paths:** `outPath` is used verbatim when absolute; relative paths resolve
  against the daemon's cwd, which is not meaningful, so the CLI resolves
  relative `--out` against the caller's cwd before sending. Default path is
  `<record.configDir>/screenshots/<storyId>-<w>x<h>.png`. Parent directories
  are created. Write failures → `SCREENSHOT_WRITE_FAILED`.
- **CLI:** `storybrokr screenshot <id> <storyId> [--out <path>] [--viewport <WxH>] [--clip root|viewport|page] [--wait-for-text <t> | --wait-for-selector <s>] [--timeout <ms>] [--json]`.
  Human output prints the written path.
- **MCP:** `storybrokr_screenshot { id, storyId, outPath?, viewport?, clip?, waitFor?, timeoutMs? }`
  → the response as JSON text. The image is not returned inline; agents read
  the file.

### Client

`DaemonClient` gains `check(id, req)` and `screenshot(id, req)`. Both are
plain JSON POSTs with the bearer token, same as `touch`.

## 4. Errors

New `ErrorCode` members and HTTP mappings:

| Code | HTTP | When |
|---|---|---|
| `BROWSER_UNAVAILABLE` | 503 | Chromium launch or lazy install failed; `logTail` carries installer output |
| `STORY_NOT_FOUND` | 404 | A requested story id is not in the instance |
| `STORY_FAILED` | 422 | Screenshot only: story errored before capture; `message` is the reducer's reason |
| `STORY_TIMEOUT` | 504 | Screenshot only: settle budget elapsed |
| `SCREENSHOT_WRITE_FAILED` | 500 | PNG could not be written to `outPath` |

## 5. Testing

**Unit (no browser):**

- `settle.test.ts`: `reduceSettle` over recorded event sequences — plain
  render, render with play, play throwing, `storyMissing`, `aborted`,
  unhandled error during play, empty list.
- `routes.test.ts`: check and screenshot handlers against a fake
  `BrowserPool` and fake `settleStory`, covering unknown story ids,
  not-ready instances, per-row failure reporting, default and absolute
  `outPath`, write failure.
- `browser.test.ts`: pool lazy-install path with a fake installer — single
  install for concurrent acquires, failure → `BROWSER_UNAVAILABLE` with
  `logTail`, idle close.
- CLI parsing for `--viewport`, `--wait-for-*` exclusivity, exit codes.

**E2E (fixture host):** the fixture gains `Panel.stories.tsx` entries
`WithPlay` (clicks the button, asserts the label) and `PlayFails` (asserts a
false condition). Tests:

- `check` on the instance returns pass for `Default` and `WithPlay` with
  `played` true only for the latter, and fail for `PlayFails` with the
  assertion message.
- `screenshot` at `640x480` writes a PNG whose header decodes to a width ≤
  640 and the response path exists.
- The existing render e2e switches from `STORYBROKR_PLAYWRIGHT_DIR` to a
  direct `import('playwright')`; the env hook is removed.

**CI:** the e2e job adds `pnpm exec playwright install --with-deps chromium`
before `test:e2e`.

## 6. Docs and release

- README: command table rows, MCP tool list, a "Check and screenshot"
  section with the `waitFor` guidance, config key `browserIdleMinutes`.
- SKILL.md: step 2 of the loop becomes "call `storybrokr_screenshot` or
  `storybrokr_check`"; the manual-browser advice moves to a fallback note.
  Tool schemas and the new error codes are added.
- Changeset: `@helmsmith/storybrokr` minor — "check and screenshot tools;
  playwright dependency with lazy Chromium install".

## Open questions

None blocking. Two things to revisit after first real use:

- Whether `check` should expose `concurrency` once multi-component
  instances exist.
- Whether the MCP screenshot tool should also return the image as an
  `image` content block for hosts that render it inline.
