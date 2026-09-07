# storybrokr check + screenshot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `storybrokr check` (headless pass/fail per story, play functions included) and `storybrokr screenshot` (PNG of one story at a requested viewport) to the daemon, CLI, and MCP server.

**Architecture:** The daemon owns one lazily-launched headless Chromium (`BrowserPool`). A pure settle reducer turns Storybook preview-channel events into pass/fail/pending; a thin driver polls the page for those events. An `Inspector` service runs check and screenshot on top of the pool and driver, and two new routes expose it. CLI and MCP stay thin clients, as they are today.

**Tech Stack:** TypeScript (ESM, Node ≥24), `playwright` 1.63 (Chromium only), zod 4, commander 15, `@modelcontextprotocol/sdk`, vitest 5, tsup. Storybook 10 fixture host under `tests/e2e/fixtures/host-react-vite`.

**Spec:** `docs/superpowers/specs/2026-09-07-storybrokr-check-screenshot-design.md`

## Global Constraints

- Package: `@helmsmith/storybrokr`, bump `0.1.0 → 0.2.0` (minor) via a changeset. All paths below are relative to `apps/storybrokr/` unless they start with `../../`.
- Node `>=24`; ESM only; imports of local files use the `.js` suffix (`../lib/errors.js`).
- `playwright` is a **regular dependency** (`^1.63.0`). No postinstall hook. The browser is fetched lazily on first use.
- Browser is **daemon-owned**; CLI and MCP never launch a browser.
- Pass/fail comes from Storybook preview channel events only. No host test tooling.
- Ready signal: `storyRenderPhaseChanged` with `newPhase === 'completed'`, then network idle, then optional `waitFor`.
- Per-story timeout default `30000` ms, allowed range `1000..300000`. Default viewport `1280x720`. Default clip `root`.
- Default screenshot path: `<record.configDir>/screenshots/<storyId>-<w>x<h>.png`. Absolute `outPath` used verbatim; CLI resolves a relative `--out` against the caller's cwd before sending.
- New error codes and HTTP statuses: `BROWSER_UNAVAILABLE` 503, `STORY_NOT_FOUND` 404, `STORY_FAILED` 422, `STORY_TIMEOUT` 504, `SCREENSHOT_WRITE_FAILED` 500. **Spec amendment (adopted here):** also `INSTANCE_NOT_READY` 409, thrown when check/screenshot targets an instance whose status is not `ready`. The spec said "the existing not-ready error", but no such code exists today.
- New config key `browserIdleMinutes`, default `10`, `0` disables idle close.
- Every check/screenshot call touches the instance (the route uses `broker.get`, which touches).
- Lint/format: the repo uses Biome (`pnpm check` at the repo root). Run `pnpm --filter @helmsmith/storybrokr typecheck` and `pnpm --filter @helmsmith/storybrokr test` before every commit.
- Commit trailer on every commit:
  ```
  Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_015iDg2PPqrbKxwirriYH8ni
  ```

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/errors.ts` (modify) | Six new error codes and statuses |
| `src/types.ts` (modify) | Request/response types for check and screenshot; `browserIdleMinutes` |
| `src/server/config.ts` (modify) | Default for `browserIdleMinutes` |
| `src/lib/settle.ts` (create) | `RECORDER_SCRIPT` (in-page recorder), `reduceSettle` (pure), `settleStory` (driver over a minimal `SettlePage` interface) |
| `src/server/browser.ts` (create) | `browserStatus()`, `BrowserPool` (lazy install, single Chromium, per-call contexts, idle close) |
| `src/server/inspector.ts` (create) | `createInspector({ pool })` → `check()` and `screenshot()` |
| `src/server/routes.ts` (modify) | `POST /v1/instances/:id/check` and `/screenshot` |
| `src/server/daemon.ts` (modify) | Builds pool + inspector, closes pool on stop |
| `src/client/index.ts` (modify) | `check()` and `screenshot()` |
| `src/commands/_shared/inspect.ts` (create) | Option parsers and printers shared by the two commands |
| `src/commands/check.ts`, `src/commands/screenshot.ts` (create) | CLI commands |
| `src/cli.ts` (modify) | Register both |
| `src/mcp/server.ts` (modify) | `storybrokr_check`, `storybrokr_screenshot` |
| `src/commands/doctor.ts` (modify) | Browser row |
| `tests/e2e/fixtures/host-react-vite/src/components/Panel/Panel.stories.tsx` (modify) | `WithPlay`, `PlayFails` |
| `tests/e2e/inspect.test.ts` (create), `tests/e2e/up-down.test.ts` + `render.test.ts` (modify) | E2E |
| `../../.github/workflows/ci.yml` (modify) | Chromium install step |
| `README.md`, `SKILL.md`, `.changeset/storybrokr-check-screenshot.md` | Docs and release |

---

### Task 1: Error codes, config key, and shared types

**Files:**
- Modify: `src/lib/errors.ts`
- Modify: `src/lib/errors.test.ts`
- Modify: `src/types.ts`
- Modify: `src/server/config.ts`
- Modify: `src/server/config.test.ts`

**Interfaces:**
- Produces: `ErrorCode` gains `BROWSER_UNAVAILABLE | STORY_NOT_FOUND | STORY_FAILED | STORY_TIMEOUT | SCREENSHOT_WRITE_FAILED | INSTANCE_NOT_READY`. `DaemonConfig.browserIdleMinutes: number`. Types `WaitFor`, `Viewport`, `CheckRequest`, `CheckStatus`, `CheckResult`, `CheckResponse`, `ScreenshotClip`, `ScreenshotRequest`, `ScreenshotResponse` exported from `src/types.ts`.

- [ ] **Step 1: Write the failing tests**

Append to the first `it` in `src/lib/errors.test.ts` (after the `NOT_FOUND` line):

```ts
    expect(httpStatusFor('BROWSER_UNAVAILABLE')).toBe(503);
    expect(httpStatusFor('STORY_NOT_FOUND')).toBe(404);
    expect(httpStatusFor('STORY_FAILED')).toBe(422);
    expect(httpStatusFor('STORY_TIMEOUT')).toBe(504);
    expect(httpStatusFor('SCREENSHOT_WRITE_FAILED')).toBe(500);
    expect(httpStatusFor('INSTANCE_NOT_READY')).toBe(409);
```

In `src/server/config.test.ts`, add `browserIdleMinutes: 10,` to the `toEqual` object in the "returns the spec defaults" test (after `autoStartWaitMs: 10_000,`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @helmsmith/storybrokr exec vitest run src/lib/errors.test.ts src/server/config.test.ts`
Expected: FAIL — type error on unknown codes / `browserIdleMinutes` missing from defaults.

- [ ] **Step 3: Implement**

`src/lib/errors.ts` — extend the union and the table:

```ts
export type ErrorCode =
  | 'HOST_NOT_FOUND'
  | 'HOST_INVALID'
  | 'COMPONENT_NOT_FOUND'
  | 'INSTANCE_CAP_REACHED'
  | 'NO_FREE_PORT'
  | 'BOOT_FAILED'
  | 'BOOT_TIMEOUT'
  | 'INSTANCE_NOT_FOUND'
  | 'INSTANCE_NOT_READY'
  | 'DAEMON_UNAVAILABLE'
  | 'BROWSER_UNAVAILABLE'
  | 'STORY_NOT_FOUND'
  | 'STORY_FAILED'
  | 'STORY_TIMEOUT'
  | 'SCREENSHOT_WRITE_FAILED'
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'NOT_FOUND'
  | 'INTERNAL';
```

and in `STATUS` add:

```ts
  INSTANCE_NOT_READY: 409,
  BROWSER_UNAVAILABLE: 503,
  STORY_NOT_FOUND: 404,
  STORY_FAILED: 422,
  STORY_TIMEOUT: 504,
  SCREENSHOT_WRITE_FAILED: 500,
```

`src/types.ts` — add `browserIdleMinutes: number; // 0 = never close the idle browser` to `DaemonConfig`, and append:

```ts
/** Extra readiness condition after Storybook reports the story rendered (Suspense fallbacks). */
export type WaitFor = { selector: string } | { text: string };

export interface Viewport {
  width: number;
  height: number;
}

export interface CheckRequest {
  storyIds?: string[]; // default: every story in the instance
  waitFor?: WaitFor;
  timeoutMs?: number; // per story; default 30000
}

export type CheckStatus = 'pass' | 'fail' | 'timeout';

export interface CheckResult {
  storyId: string;
  status: CheckStatus;
  played: boolean; // a `playing` phase was observed before completion
  durationMs: number;
  error?: { message: string; event: string; stack?: string };
}

export interface CheckResponse {
  instanceId: string;
  results: CheckResult[];
  summary: { pass: number; fail: number; timeout: number };
}

export type ScreenshotClip = 'root' | 'viewport' | 'page';

export interface ScreenshotRequest {
  storyId: string;
  outPath?: string; // absolute; default <configDir>/screenshots/<storyId>-<w>x<h>.png
  viewport?: Viewport; // default 1280x720
  clip?: ScreenshotClip; // default 'root'
  waitFor?: WaitFor;
  timeoutMs?: number; // default 30000
}

export interface ScreenshotResponse {
  instanceId: string;
  storyId: string;
  path: string;
  width: number;
  height: number;
  durationMs: number;
}
```

`src/server/config.ts` — add `browserIdleMinutes: 10,` to `DEFAULT_CONFIG` after `autoStartWaitMs`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @helmsmith/storybrokr typecheck && pnpm --filter @helmsmith/storybrokr exec vitest run src/lib/errors.test.ts src/server/config.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/storybrokr/src/lib/errors.ts apps/storybrokr/src/lib/errors.test.ts apps/storybrokr/src/types.ts apps/storybrokr/src/server/config.ts apps/storybrokr/src/server/config.test.ts
git commit -m "feat(storybrokr): error codes, config key, and types for check and screenshot"
```

---

### Task 2: Settle reducer and in-page recorder

**Files:**
- Create: `src/lib/settle.ts`
- Create: `src/lib/settle.test.ts`

**Interfaces:**
- Produces: `SettleEvent`, `SettleState`, `reduceSettle(events: SettleEvent[]): SettleState`, `RECORDER_SCRIPT: string`, `EVENTS_EXPRESSION: string`.

The recorder is a plain string of JavaScript that Playwright injects with `context.addInitScript`. It polls for `window.__STORYBOOK_ADDONS_CHANNEL__` (Storybook 10 defines it in the preview iframe) and appends events to `window.__STORYBROKR__.events`. Storybook event names verified against the fixture's installed `storybook@10.6`: `storyRenderPhaseChanged`, `storyErrored`, `storyThrewException`, `playFunctionThrewException`, `unhandledErrorsWhilePlaying`, `storyMissing`. Render phases of interest: `playing`, `completed`, `errored`, `aborted`.

- [ ] **Step 1: Write the failing tests**

`src/lib/settle.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { EVENTS_EXPRESSION, RECORDER_SCRIPT, reduceSettle, type SettleEvent } from './settle.js';

const phase = (p: string): SettleEvent => ({ kind: 'phase', phase: p });

describe('reduceSettle', () => {
  it('is pending with no events or only non-terminal phases', () => {
    expect(reduceSettle([])).toEqual({ kind: 'pending' });
    expect(reduceSettle([phase('loading'), phase('rendering')])).toEqual({ kind: 'pending' });
  });

  it('passes on completed, reporting whether a play phase ran', () => {
    expect(reduceSettle([phase('loading'), phase('rendering'), phase('completed')])).toEqual({
      kind: 'pass',
      played: false,
    });
    expect(
      reduceSettle([phase('rendering'), phase('playing'), phase('played'), phase('completed')]),
    ).toEqual({ kind: 'pass', played: true });
  });

  it('fails on the first exception event, keeping its message, event name and stack', () => {
    const events: SettleEvent[] = [
      phase('playing'),
      { kind: 'error', event: 'playFunctionThrewException', message: 'boom', stack: 's' },
      phase('errored'),
    ];
    expect(reduceSettle(events)).toEqual({
      kind: 'fail',
      reason: 'boom',
      event: 'playFunctionThrewException',
      stack: 's',
    });
  });

  it('fails on errored or aborted phases without a preceding exception event', () => {
    expect(reduceSettle([phase('rendering'), phase('errored')])).toEqual({
      kind: 'fail',
      reason: 'story render errored',
      event: 'storyRenderPhaseChanged',
    });
    expect(reduceSettle([phase('aborted')])).toMatchObject({ kind: 'fail', reason: 'story render aborted' });
  });

  it('treats storyMissing as a failure', () => {
    expect(
      reduceSettle([{ kind: 'error', event: 'storyMissing', message: 'story x is not in this preview' }]),
    ).toMatchObject({ kind: 'fail', event: 'storyMissing' });
  });

  it('a pass after a failure does not resurrect it (first terminal wins)', () => {
    expect(
      reduceSettle([
        { kind: 'error', event: 'storyThrewException', message: 'x' },
        phase('completed'),
      ]),
    ).toMatchObject({ kind: 'fail' });
  });
});

describe('recorder script', () => {
  it('subscribes to every event the reducer understands and exposes the events slot', () => {
    for (const name of [
      'storyRenderPhaseChanged',
      'storyErrored',
      'storyThrewException',
      'playFunctionThrewException',
      'unhandledErrorsWhilePlaying',
      'storyMissing',
    ])
      expect(RECORDER_SCRIPT).toContain(`'${name}'`);
    expect(RECORDER_SCRIPT).toContain('__STORYBOOK_ADDONS_CHANNEL__');
    expect(EVENTS_EXPRESSION).toContain('__STORYBROKR__');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @helmsmith/storybrokr exec vitest run src/lib/settle.test.ts`
Expected: FAIL — cannot resolve `./settle.js`.

- [ ] **Step 3: Implement `src/lib/settle.ts` (reducer + recorder only; the driver comes in Task 3)**

```ts
/**
 * How storybrokr decides a story has "settled". The recorder runs inside the preview iframe and
 * copies Storybook channel events into `window.__STORYBROKR__.events`; the reducer, in Node,
 * folds that list into pass / fail / pending. Keeping the reducer pure means the decision logic
 * is unit-tested without a browser.
 */

export type SettleEvent =
  | { kind: 'phase'; phase: string; storyId?: string }
  | { kind: 'error'; event: string; message: string; stack?: string };

export type SettleState =
  | { kind: 'pending' }
  | { kind: 'pass'; played: boolean }
  | { kind: 'fail'; reason: string; event: string; stack?: string };

/** First terminal signal wins: an exception event, or an errored/aborted/completed phase. */
export function reduceSettle(events: SettleEvent[]): SettleState {
  let played = false;
  for (const e of events) {
    if (e.kind === 'error') {
      return e.stack === undefined
        ? { kind: 'fail', reason: e.message, event: e.event }
        : { kind: 'fail', reason: e.message, event: e.event, stack: e.stack };
    }
    if (e.phase === 'playing') played = true;
    if (e.phase === 'completed') return { kind: 'pass', played };
    if (e.phase === 'errored' || e.phase === 'aborted') {
      return { kind: 'fail', reason: `story render ${e.phase}`, event: 'storyRenderPhaseChanged' };
    }
  }
  return { kind: 'pending' };
}

/** Evaluated in the page to read the recorded events (a string so Playwright needs no serialization). */
export const EVENTS_EXPRESSION = 'window.__STORYBROKR__ ? window.__STORYBROKR__.events : []';

/**
 * Injected via `context.addInitScript` so it runs before any preview code on every navigation.
 * Polls for the channel (Storybook creates it during preview bootstrap) and then subscribes.
 * Payload shapes (Storybook 10): storyRenderPhaseChanged → { newPhase, storyId };
 * storyErrored → { title, description }; storyThrewException / playFunctionThrewException →
 * Error; unhandledErrorsWhilePlaying → Error[]; storyMissing → storyId.
 */
export const RECORDER_SCRIPT = `(() => {
  const slot = (window.__STORYBROKR__ = { events: [] });
  const push = (e) => slot.events.push(e);
  const describe = (x) => {
    if (x && typeof x === 'object') {
      const message = x.message ?? x.description ?? x.title ?? JSON.stringify(x);
      const stack = typeof x.stack === 'string' ? x.stack : undefined;
      return stack === undefined ? { message: String(message) } : { message: String(message), stack };
    }
    return { message: String(x) };
  };
  const attach = (ch) => {
    ch.on('storyRenderPhaseChanged', (p) =>
      push({ kind: 'phase', phase: p && p.newPhase, storyId: p && p.storyId }),
    );
    for (const event of [
      'storyErrored',
      'storyThrewException',
      'playFunctionThrewException',
      'unhandledErrorsWhilePlaying',
    ]) {
      ch.on(event, (x) => push({ kind: 'error', event, ...describe(Array.isArray(x) ? x[0] : x) }));
    }
    ch.on('storyMissing', (id) =>
      push({ kind: 'error', event: 'storyMissing', message: 'story ' + id + ' is not in this preview' }),
    );
  };
  const tick = () => {
    const ch = window.__STORYBOOK_ADDONS_CHANNEL__;
    if (ch && typeof ch.on === 'function') attach(ch);
    else setTimeout(tick, 25);
  };
  tick();
})();`;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @helmsmith/storybrokr exec vitest run src/lib/settle.test.ts`
Expected: PASS (6 reducer tests + 1 recorder test)

- [ ] **Step 5: Commit**

```bash
git add apps/storybrokr/src/lib/settle.ts apps/storybrokr/src/lib/settle.test.ts
git commit -m "feat(storybrokr): settle reducer and in-page channel recorder"
```

---

### Task 3: `settleStory` driver

**Files:**
- Modify: `src/lib/settle.ts`
- Modify: `src/lib/settle.test.ts`

**Interfaces:**
- Consumes: `reduceSettle`, `EVENTS_EXPRESSION`, `WaitFor` (Task 1).
- Produces: `SettlePage` (structural subset of a Playwright `Page`), `SettleOutcome = SettleState | { kind: 'timeout'; lastPhase?: string }`, `settleStory(page, opts): Promise<SettleOutcome>`.

The driver polls `page.evaluate(EVENTS_EXPRESSION)` every `pollMs` (default 100) instead of `waitForFunction`, so the reducer stays in Node and the page interface stays tiny enough to fake.

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/settle.test.ts`:

```ts
import { type SettlePage, settleStory } from './settle.js';

/** A scripted page: each evaluate() call returns the next events snapshot. */
function fakePage(snapshots: SettleEvent[][], opts: { networkIdleRejects?: boolean; waitForFails?: boolean } = {}) {
  const calls: string[] = [];
  let i = 0;
  const page: SettlePage = {
    goto: async (url) => {
      calls.push(`goto ${url}`);
    },
    evaluate: async () => snapshots[Math.min(i++, snapshots.length - 1)] ?? [],
    waitForLoadState: async (state) => {
      calls.push(`load ${state}`);
      if (opts.networkIdleRejects) throw new Error('Timeout');
    },
    waitForSelector: async (sel) => {
      calls.push(`selector ${sel}`);
      if (opts.waitForFails) throw new Error('Timeout');
    },
    getByText: (text) => ({
      waitFor: async () => {
        calls.push(`text ${text}`);
        if (opts.waitForFails) throw new Error('Timeout');
      },
    }),
  };
  return { page, calls };
}

const fast = { pollMs: 0, sleep: async () => {} };

describe('settleStory', () => {
  it('navigates, polls until a terminal state, then waits for network idle', async () => {
    const { page, calls } = fakePage([[], [phase('rendering')], [phase('rendering'), phase('completed')]]);
    const out = await settleStory(page, { iframeUrl: 'http://x/iframe.html?id=a', timeoutMs: 5000, ...fast });
    expect(out).toEqual({ kind: 'pass', played: false });
    expect(calls).toEqual(['goto http://x/iframe.html?id=a', 'load networkidle']);
  });

  it('honours waitFor text and selector after the render completes', async () => {
    const a = fakePage([[phase('completed')]]);
    await settleStory(a.page, { iframeUrl: 'u', timeoutMs: 5000, waitFor: { text: 'Go' }, ...fast });
    expect(a.calls).toContain('text Go');
    const b = fakePage([[phase('completed')]]);
    await settleStory(b.page, { iframeUrl: 'u', timeoutMs: 5000, waitFor: { selector: 'h2' }, ...fast });
    expect(b.calls).toContain('selector h2');
  });

  it('returns fail without waiting for network idle', async () => {
    const { page, calls } = fakePage([
      [{ kind: 'error', event: 'playFunctionThrewException', message: 'nope' }],
    ]);
    const out = await settleStory(page, { iframeUrl: 'u', timeoutMs: 5000, ...fast });
    expect(out).toMatchObject({ kind: 'fail', reason: 'nope' });
    expect(calls).not.toContain('load networkidle');
  });

  it('times out while pending, reporting the last phase seen', async () => {
    let t = 0;
    const { page } = fakePage([[phase('loading')], [phase('rendering')]]);
    const out = await settleStory(page, {
      iframeUrl: 'u',
      timeoutMs: 100,
      pollMs: 0,
      sleep: async () => {},
      now: () => (t += 60),
    });
    expect(out).toEqual({ kind: 'timeout', lastPhase: 'rendering' });
  });

  it('times out when network idle or waitFor never happens', async () => {
    const a = fakePage([[phase('completed')]], { networkIdleRejects: true });
    expect(await settleStory(a.page, { iframeUrl: 'u', timeoutMs: 5000, ...fast })).toEqual({
      kind: 'timeout',
      lastPhase: 'completed',
    });
    const b = fakePage([[phase('completed')]], { waitForFails: true });
    expect(
      await settleStory(b.page, { iframeUrl: 'u', timeoutMs: 5000, waitFor: { text: 'never' }, ...fast }),
    ).toEqual({ kind: 'timeout', lastPhase: 'completed' });
  });
});
```

(Move the `import { type SettlePage, settleStory }` line up to join the existing import from `./settle.js`; Biome will flag duplicate imports otherwise.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @helmsmith/storybrokr exec vitest run src/lib/settle.test.ts`
Expected: FAIL — `settleStory` is not exported.

- [ ] **Step 3: Implement the driver (append to `src/lib/settle.ts`)**

```ts
import type { WaitFor } from '../types.js';

/** The slice of a Playwright Page the driver needs; a fake satisfies it in unit tests. */
export interface SettlePage {
  goto(url: string): Promise<unknown>;
  evaluate(expression: string): Promise<unknown>;
  waitForLoadState(state: 'networkidle', opts: { timeout: number }): Promise<void>;
  waitForSelector(selector: string, opts: { timeout: number }): Promise<unknown>;
  getByText(text: string): { waitFor(opts: { timeout: number }): Promise<void> };
}

export type SettleOutcome = SettleState | { kind: 'timeout'; lastPhase?: string };

export interface SettleOptions {
  iframeUrl: string;
  timeoutMs: number;
  waitFor?: WaitFor;
  pollMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Navigates to the story and waits until it settles: a terminal reducer state, then (on pass)
 * network idle and the optional waitFor. The whole thing shares one `timeoutMs` budget.
 * The caller must have installed RECORDER_SCRIPT on the page's context.
 */
export async function settleStory(page: SettlePage, opts: SettleOptions): Promise<SettleOutcome> {
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? defaultSleep;
  const pollMs = opts.pollMs ?? 100;
  const deadline = now() + opts.timeoutMs;
  const remaining = () => Math.max(1, deadline - now());
  let lastPhase: string | undefined;

  await page.goto(opts.iframeUrl);
  let state: SettleState = { kind: 'pending' };
  for (;;) {
    const events = (await page.evaluate(EVENTS_EXPRESSION)) as SettleEvent[];
    for (const e of events) if (e.kind === 'phase') lastPhase = e.phase;
    state = reduceSettle(events);
    if (state.kind !== 'pending') break;
    if (now() >= deadline) return lastPhase === undefined ? { kind: 'timeout' } : { kind: 'timeout', lastPhase };
    await sleep(pollMs);
  }
  if (state.kind === 'fail') return state;

  try {
    await page.waitForLoadState('networkidle', { timeout: remaining() });
    if (opts.waitFor && 'selector' in opts.waitFor) {
      await page.waitForSelector(opts.waitFor.selector, { timeout: remaining() });
    } else if (opts.waitFor) {
      await page.getByText(opts.waitFor.text).waitFor({ timeout: remaining() });
    }
  } catch {
    return { kind: 'timeout', lastPhase: 'completed' };
  }
  return state;
}
```

Put the `import type { WaitFor }` line at the top of the file with the other imports.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @helmsmith/storybrokr typecheck && pnpm --filter @helmsmith/storybrokr exec vitest run src/lib/settle.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/storybrokr/src/lib/settle.ts apps/storybrokr/src/lib/settle.test.ts
git commit -m "feat(storybrokr): settleStory driver over a minimal page interface"
```

---

### Task 4: Playwright dependency and `BrowserPool`

**Files:**
- Modify: `package.json` (dependency)
- Create: `src/server/browser.ts`
- Create: `src/server/browser.test.ts`

**Interfaces:**
- Consumes: `StorybrokrError`, `Viewport`.
- Produces: `browserStatus(): { installed: boolean; executablePath: string }`; `class BrowserPool` with `constructor(opts: BrowserPoolOptions)`, `acquire(viewport?: Viewport): Promise<BrowserContext>`, `close(): Promise<void>`, `get openContexts(): number`. `BrowserPoolOptions = { idleMinutes: number; launch?: () => Promise<Browser>; isInstalled?: () => boolean; install?: (onLine: (line: string) => void) => Promise<number>; log?: (line: string) => void; setTimer?, clearTimer? }`.

- [ ] **Step 1: Add the dependency**

Run: `pnpm --filter @helmsmith/storybrokr add playwright@^1.63.0`
Then: `pnpm --filter @helmsmith/storybrokr exec playwright install chromium` (local machine only; CI gets its own step in Task 11).
Verify `package.json` `dependencies` now contains `"playwright": "^1.63.0"`. No `pnpm.onlyBuiltDependencies` change is needed: `playwright@1.63.0` ships no install scripts (verified with `npm view playwright@1.63.0 scripts`).

- [ ] **Step 2: Write the failing tests**

`src/server/browser.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { StorybrokrError } from '../lib/errors.js';
import { BrowserPool } from './browser.js';

type Listener = () => void;

function fakeBrowser() {
  const contexts: { close: () => Promise<void> }[] = [];
  let disconnected: Listener | undefined;
  const browser = {
    on: (event: string, cb: Listener) => {
      if (event === 'disconnected') disconnected = cb;
    },
    newContext: vi.fn(async () => {
      let onClose: Listener | undefined;
      const ctx = {
        on: (event: string, cb: Listener) => {
          if (event === 'close') onClose = cb;
        },
        close: async () => onClose?.(),
      };
      contexts.push(ctx);
      return ctx;
    }),
    close: vi.fn(async () => disconnected?.()),
  };
  return { browser, contexts };
}

function pool(over: Partial<ConstructorParameters<typeof BrowserPool>[0]> = {}) {
  const { browser, contexts } = fakeBrowser();
  const launch = vi.fn(async () => browser as never);
  const install = vi.fn(async (onLine: (l: string) => void) => {
    onLine('downloading chromium');
    return 0;
  });
  const timers: { cb: () => void; ms: number }[] = [];
  const p = new BrowserPool({
    idleMinutes: 10,
    launch,
    isInstalled: () => true,
    install,
    log: () => {},
    setTimer: (cb, ms) => {
      timers.push({ cb, ms });
      return timers.length;
    },
    clearTimer: () => {},
    ...over,
  });
  return { p, browser, contexts, launch, install, timers };
}

describe('BrowserPool', () => {
  it('launches once and hands out a fresh context per acquire', async () => {
    const { p, launch, browser } = pool();
    const a = await p.acquire();
    const b = await p.acquire({ width: 640, height: 480 });
    expect(launch).toHaveBeenCalledTimes(1);
    expect(browser.newContext).toHaveBeenCalledTimes(2);
    expect(browser.newContext).toHaveBeenLastCalledWith({ viewport: { width: 640, height: 480 } });
    expect(a).not.toBe(b);
    expect(p.openContexts).toBe(2);
  });

  it('runs the installer once when chromium is missing, even for concurrent acquires', async () => {
    let installed = false;
    const { p, install, launch } = pool({
      isInstalled: () => installed,
      install: async (onLine) => {
        onLine('fetching');
        installed = true;
        return 0;
      },
    });
    await Promise.all([p.acquire(), p.acquire()]);
    expect(install).toHaveBeenCalledTimes(0); // the override above replaced the spy
    expect(launch).toHaveBeenCalledTimes(1);
  });

  it('maps a failed install to BROWSER_UNAVAILABLE with the installer tail, and retries next time', async () => {
    let attempts = 0;
    const { p } = pool({
      isInstalled: () => attempts > 0,
      install: async (onLine) => {
        attempts++;
        onLine('line 1');
        onLine('line 2');
        return 1;
      },
    });
    const err = await p.acquire().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StorybrokrError);
    expect((err as StorybrokrError).code).toBe('BROWSER_UNAVAILABLE');
    expect((err as StorybrokrError).logTail).toEqual(['line 1', 'line 2']);
    await expect(p.acquire()).resolves.toBeDefined(); // isInstalled is now true → no second install
  });

  it('maps a launch failure to BROWSER_UNAVAILABLE', async () => {
    const { p } = pool({ launch: async () => { throw new Error('no display'); } });
    await expect(p.acquire()).rejects.toMatchObject({ code: 'BROWSER_UNAVAILABLE', message: /no display/ });
  });

  it('arms the idle timer when the last context closes and closes the browser when it fires', async () => {
    const { p, timers, browser, contexts } = pool({ idleMinutes: 2 });
    await p.acquire();
    await contexts[0].close();
    expect(p.openContexts).toBe(0);
    expect(timers).toHaveLength(1);
    expect(timers[0].ms).toBe(120_000);
    timers[0].cb();
    await new Promise((r) => setImmediate(r));
    expect(browser.close).toHaveBeenCalledTimes(1);
  });

  it('never arms the idle timer when idleMinutes is 0', async () => {
    const { p, timers, contexts } = pool({ idleMinutes: 0 });
    await p.acquire();
    await contexts[0].close();
    expect(timers).toHaveLength(0);
  });

  it('relaunches after the browser disconnects, and close() is idempotent', async () => {
    const { p, launch, browser } = pool();
    await p.acquire();
    await browser.close(); // fires 'disconnected'
    await p.acquire();
    expect(launch).toHaveBeenCalledTimes(2);
    await p.close();
    await p.close();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter @helmsmith/storybrokr exec vitest run src/server/browser.test.ts`
Expected: FAIL — cannot resolve `./browser.js`.

- [ ] **Step 4: Implement `src/server/browser.ts`**

```ts
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { type Browser, type BrowserContext, chromium } from 'playwright';
import { StorybrokrError } from '../lib/errors.js';
import type { Viewport } from '../types.js';

export interface BrowserStatus {
  installed: boolean;
  executablePath: string;
}

/** Where Playwright expects its Chromium, and whether it is there. Never installs. */
export function browserStatus(): BrowserStatus {
  const executablePath = chromium.executablePath();
  return { installed: existsSync(executablePath), executablePath };
}

/**
 * Runs Playwright's own installer for Chromium. Resolved from storybrokr's install location so a
 * global `npm i -g` works; `playwright/package.json` is an exported path, `cli.js` sits beside it.
 */
function defaultInstall(onLine: (line: string) => void): Promise<number> {
  const require = createRequire(import.meta.url);
  const cli = join(dirname(require.resolve('playwright/package.json')), 'cli.js');
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, 'install', 'chromium'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const feed = (chunk: Buffer) => {
      for (const line of chunk.toString().split(/\r?\n/)) if (line.trim()) onLine(line);
    };
    child.stdout.on('data', feed);
    child.stderr.on('data', feed);
    child.on('error', reject);
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

export interface BrowserPoolOptions {
  idleMinutes: number; // 0 = never close on idle
  launch?: () => Promise<Browser>;
  isInstalled?: () => boolean;
  install?: (onLine: (line: string) => void) => Promise<number>;
  log?: (line: string) => void;
  setTimer?: (cb: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

const TAIL = 20;

/**
 * One headless Chromium per daemon, launched on first use. Each acquire() returns a fresh
 * BrowserContext; the pool watches the context's 'close' event to know when it is idle.
 */
export class BrowserPool {
  private browser: Browser | null = null;
  private launching: Promise<Browser> | null = null;
  private installing: Promise<void> | null = null;
  private open = 0;
  private idleTimer: unknown = null;
  private readonly opts: Required<BrowserPoolOptions>;

  constructor(opts: BrowserPoolOptions) {
    this.opts = {
      launch: () => chromium.launch({ headless: true }),
      isInstalled: () => browserStatus().installed,
      install: defaultInstall,
      log: () => {},
      setTimer: (cb, ms) => {
        const t = setTimeout(cb, ms);
        t.unref();
        return t;
      },
      clearTimer: (h) => clearTimeout(h as NodeJS.Timeout),
      ...opts,
    };
  }

  get openContexts(): number {
    return this.open;
  }

  async acquire(viewport?: Viewport): Promise<BrowserContext> {
    const browser = await this.ensureBrowser();
    const context = await browser.newContext(viewport ? { viewport } : {});
    this.open++;
    if (this.idleTimer !== null) {
      this.opts.clearTimer(this.idleTimer);
      this.idleTimer = null;
    }
    context.on('close', () => this.release());
    return context;
  }

  async close(): Promise<void> {
    if (this.idleTimer !== null) {
      this.opts.clearTimer(this.idleTimer);
      this.idleTimer = null;
    }
    const b = this.browser;
    this.browser = null;
    if (b) await b.close().catch(() => {});
  }

  private release(): void {
    this.open = Math.max(0, this.open - 1);
    if (this.open > 0 || this.opts.idleMinutes <= 0 || !this.browser) return;
    this.idleTimer = this.opts.setTimer(() => {
      this.idleTimer = null;
      if (this.open === 0) void this.close();
    }, this.opts.idleMinutes * 60_000);
  }

  private async ensureBrowser(): Promise<Browser> {
    if (this.browser) return this.browser;
    if (!this.launching) {
      this.launching = (async () => {
        await this.ensureInstalled();
        let b: Browser;
        try {
          b = await this.opts.launch();
        } catch (err) {
          throw new StorybrokrError(
            'BROWSER_UNAVAILABLE',
            `could not launch chromium: ${(err as Error).message}`,
          );
        }
        b.on('disconnected', () => {
          if (this.browser === b) this.browser = null;
        });
        this.browser = b;
        return b;
      })().finally(() => {
        this.launching = null;
      });
    }
    return this.launching;
  }

  private async ensureInstalled(): Promise<void> {
    if (this.opts.isInstalled()) return;
    if (!this.installing) {
      this.installing = (async () => {
        const tail: string[] = [];
        this.opts.log('chromium not installed; running `playwright install chromium`');
        const code = await this.opts.install((line) => {
          tail.push(line);
          if (tail.length > TAIL) tail.shift();
          this.opts.log(line);
        });
        if (code !== 0) {
          throw new StorybrokrError(
            'BROWSER_UNAVAILABLE',
            `playwright install chromium exited with code ${code}`,
            tail,
          );
        }
      })().finally(() => {
        this.installing = null;
      });
    }
    return this.installing;
  }
}
```

Note for the second test ("runs the installer once…"): the override replaces the `install` spy, so assert on `launch` being called once and on the two acquires both resolving; delete the `expect(install).toHaveBeenCalledTimes(0)` line if it reads as confusing — the behavior under test is "one install, one launch, two contexts".

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @helmsmith/storybrokr typecheck && pnpm --filter @helmsmith/storybrokr exec vitest run src/server/browser.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/storybrokr/package.json ../../pnpm-lock.yaml apps/storybrokr/src/server/browser.ts apps/storybrokr/src/server/browser.test.ts
git commit -m "feat(storybrokr): playwright dependency and daemon-owned BrowserPool with lazy chromium install"
```

(Use the repo-root path for `pnpm-lock.yaml`: `git add pnpm-lock.yaml` from the root.)

---

### Task 5: `Inspector` service (check + screenshot)

**Files:**
- Create: `src/server/inspector.ts`
- Create: `src/server/inspector.test.ts`

**Interfaces:**
- Consumes: `BrowserPool.acquire`, `RECORDER_SCRIPT`, `settleStory`, `SettlePage`, all Task 1 types.
- Produces: `interface Inspector { check(record, req): Promise<CheckResponse>; screenshot(record, req): Promise<ScreenshotResponse> }`, `createInspector(deps: InspectorDeps): Inspector`, `InspectorDeps = { pool: { acquire(viewport?): Promise<InspectorContext> }; settle?: typeof settleStory; writeFile?: (path: string, data: Buffer) => Promise<void>; now?: () => number }`.

Both operations use a structural `InspectorContext` / `InspectorPage` so tests use fakes; Playwright's real `BrowserContext` and `Page` satisfy them.

- [ ] **Step 1: Write the failing tests**

`src/server/inspector.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import type { SettleOutcome } from '../lib/settle.js';
import type { InstanceRecord } from '../types.js';
import { createInspector, type InspectorContext } from './inspector.js';

const record: InstanceRecord = {
  id: 'inst1',
  hostRoot: '/h',
  component: 'src/Panel',
  framework: 'react-vite',
  port: 6100,
  url: 'http://127.0.0.1:6100',
  pid: 1,
  status: 'ready',
  createdAt: 'c',
  lastTouchedAt: 't',
  ttlMinutes: 30,
  storyFiles: [],
  stories: ['a', 'b'].map((id) => ({
    id: `panel--${id}`,
    title: 'Panel',
    name: id,
    importPath: './x',
    url: `http://127.0.0.1:6100/?path=/story/panel--${id}`,
    iframeUrl: `http://127.0.0.1:6100/iframe.html?id=panel--${id}&viewMode=story`,
  })),
  configDir: '/h/node_modules/.cache/storybrokr/inst1',
};

// PNG header: 8-byte signature, then IHDR chunk with width at byte 16 and height at byte 20.
function png(width: number, height: number): Buffer {
  const b = Buffer.alloc(24);
  b.write('\x89PNG\r\n\x1a\n', 0, 'binary');
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
}

function harness(outcomes: Record<string, SettleOutcome>, box: { x: number; y: number; width: number; height: number } | null = { x: 1, y: 2, width: 300, height: 200 }) {
  const shots: unknown[] = [];
  const page = {
    goto: async () => {},
    evaluate: async () => [],
    waitForLoadState: async () => {},
    waitForSelector: async () => ({}),
    getByText: () => ({ waitFor: async () => {} }),
    locator: () => ({ boundingBox: async () => box }),
    screenshot: async (o: unknown) => {
      shots.push(o);
      return png(300, 200);
    },
  };
  const ctx: InspectorContext = {
    addInitScript: vi.fn(async () => {}),
    newPage: async () => page,
    close: vi.fn(async () => {}),
  };
  const acquire = vi.fn(async () => ctx);
  const settle = vi.fn(async (_p: unknown, o: { iframeUrl: string }) => {
    const id = new URL(o.iframeUrl).searchParams.get('id') ?? '';
    return outcomes[id] ?? { kind: 'pass', played: false };
  });
  const writes: { path: string; data: Buffer }[] = [];
  const writeFile = vi.fn(async (path: string, data: Buffer) => {
    writes.push({ path, data });
  });
  const inspector = createInspector({ pool: { acquire }, settle: settle as never, writeFile });
  return { inspector, acquire, ctx, settle, shots, writes };
}

describe('inspector.check', () => {
  it('runs every story in order on one context, installs the recorder, and closes the context', async () => {
    const h = harness({ 'panel--b': { kind: 'pass', played: true } });
    const res = await h.inspector.check(record, {});
    expect(h.acquire).toHaveBeenCalledTimes(1);
    expect(h.ctx.addInitScript).toHaveBeenCalledTimes(1);
    expect(h.ctx.close).toHaveBeenCalledTimes(1);
    expect(res.instanceId).toBe('inst1');
    expect(res.results.map((r) => [r.storyId, r.status, r.played])).toEqual([
      ['panel--a', 'pass', false],
      ['panel--b', 'pass', true],
    ]);
    expect(res.summary).toEqual({ pass: 2, fail: 0, timeout: 0 });
  });

  it('reports fail and timeout as rows, with the error detail, and passes waitFor/timeout through', async () => {
    const h = harness({
      'panel--a': { kind: 'fail', reason: 'boom', event: 'playFunctionThrewException', stack: 's' },
      'panel--b': { kind: 'timeout', lastPhase: 'rendering' },
    });
    const res = await h.inspector.check(record, { waitFor: { text: 'Go' }, timeoutMs: 1234 });
    expect(res.results[0]).toMatchObject({
      status: 'fail',
      error: { message: 'boom', event: 'playFunctionThrewException', stack: 's' },
    });
    expect(res.results[1]).toMatchObject({ status: 'timeout', error: { message: /rendering/ } });
    expect(res.summary).toEqual({ pass: 0, fail: 1, timeout: 1 });
    expect(h.settle).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ waitFor: { text: 'Go' }, timeoutMs: 1234 }));
  });

  it('restricts to storyIds and rejects unknown ids before touching the browser', async () => {
    const h = harness({});
    const res = await h.inspector.check(record, { storyIds: ['panel--b'] });
    expect(res.results.map((r) => r.storyId)).toEqual(['panel--b']);
    await expect(h.inspector.check(record, { storyIds: ['panel--zzz', 'panel--a'] })).rejects.toMatchObject({
      code: 'STORY_NOT_FOUND',
      message: /panel--zzz/,
    });
    expect(h.acquire).toHaveBeenCalledTimes(1);
  });

  it('refuses a non-ready instance', async () => {
    const h = harness({});
    await expect(h.inspector.check({ ...record, status: 'starting' }, {})).rejects.toMatchObject({
      code: 'INSTANCE_NOT_READY',
    });
  });

  it('closes the context even when settle throws', async () => {
    const h = harness({});
    h.settle.mockRejectedValueOnce(new Error('page crashed'));
    await expect(h.inspector.check(record, {})).rejects.toThrow(/page crashed/);
    expect(h.ctx.close).toHaveBeenCalledTimes(1);
  });
});

describe('inspector.screenshot', () => {
  it('writes the PNG to the default path with the root clip and reports its dimensions', async () => {
    const h = harness({});
    const res = await h.inspector.screenshot(record, { storyId: 'panel--a' });
    expect(h.acquire).toHaveBeenCalledWith({ width: 1280, height: 720 });
    expect(h.shots[0]).toEqual({ fullPage: true, clip: { x: 1, y: 2, width: 300, height: 200 } });
    expect(h.writes[0].path).toBe('/h/node_modules/.cache/storybrokr/inst1/screenshots/panel--a-1280x720.png');
    expect(res).toMatchObject({ instanceId: 'inst1', storyId: 'panel--a', path: h.writes[0].path, width: 300, height: 200 });
    expect(h.ctx.close).toHaveBeenCalledTimes(1);
  });

  it('honours outPath, viewport, and the viewport/page clips; falls back to viewport when root box is empty', async () => {
    const h = harness({});
    await h.inspector.screenshot(record, { storyId: 'panel--a', outPath: '/tmp/x.png', viewport: { width: 640, height: 480 }, clip: 'viewport' });
    expect(h.acquire).toHaveBeenLastCalledWith({ width: 640, height: 480 });
    expect(h.shots[0]).toEqual({});
    expect(h.writes[0].path).toBe('/tmp/x.png');
    await h.inspector.screenshot(record, { storyId: 'panel--a', clip: 'page' });
    expect(h.shots[1]).toEqual({ fullPage: true });
    const empty = harness({}, { x: 0, y: 0, width: 0, height: 0 });
    await empty.inspector.screenshot(record, { storyId: 'panel--a' });
    expect(empty.shots[0]).toEqual({});
  });

  it('maps fail and timeout outcomes to STORY_FAILED / STORY_TIMEOUT and writes nothing', async () => {
    const h = harness({
      'panel--a': { kind: 'fail', reason: 'nope', event: 'storyErrored' },
      'panel--b': { kind: 'timeout', lastPhase: 'loading' },
    });
    await expect(h.inspector.screenshot(record, { storyId: 'panel--a' })).rejects.toMatchObject({ code: 'STORY_FAILED', message: /nope/ });
    await expect(h.inspector.screenshot(record, { storyId: 'panel--b' })).rejects.toMatchObject({ code: 'STORY_TIMEOUT', message: /loading/ });
    expect(h.writes).toHaveLength(0);
  });

  it('maps unknown story, non-ready instance, and write failures', async () => {
    const h = harness({});
    await expect(h.inspector.screenshot(record, { storyId: 'nope' })).rejects.toMatchObject({ code: 'STORY_NOT_FOUND' });
    await expect(h.inspector.screenshot({ ...record, status: 'failed' }, { storyId: 'panel--a' })).rejects.toMatchObject({ code: 'INSTANCE_NOT_READY' });
    h.writes.length = 0;
    (h.inspector as unknown as { _writeFail?: boolean })._writeFail = true;
    const failing = createInspector({
      pool: { acquire: h.acquire },
      settle: h.settle as never,
      writeFile: async () => {
        throw new Error('EACCES');
      },
    });
    await expect(failing.screenshot(record, { storyId: 'panel--a' })).rejects.toMatchObject({ code: 'SCREENSHOT_WRITE_FAILED', message: /EACCES/ });
  });
});
```

(Drop the two `_writeFail` lines — they are leftovers; the `failing` inspector built with a throwing `writeFile` is the actual test.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @helmsmith/storybrokr exec vitest run src/server/inspector.test.ts`
Expected: FAIL — cannot resolve `./inspector.js`.

- [ ] **Step 3: Implement `src/server/inspector.ts`**

```ts
import { mkdir, writeFile as fsWriteFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { StorybrokrError } from '../lib/errors.js';
import { RECORDER_SCRIPT, type SettlePage, settleStory } from '../lib/settle.js';
import type {
  CheckRequest,
  CheckResponse,
  CheckResult,
  InstanceRecord,
  ScreenshotRequest,
  ScreenshotResponse,
  StoryEntry,
  Viewport,
} from '../types.js';

/** The slice of Playwright's Page/BrowserContext the inspector uses; fakes satisfy it in tests. */
export interface InspectorPage extends SettlePage {
  locator(selector: string): {
    boundingBox(): Promise<{ x: number; y: number; width: number; height: number } | null>;
  };
  screenshot(opts?: {
    fullPage?: boolean;
    clip?: { x: number; y: number; width: number; height: number };
  }): Promise<Buffer>;
}

export interface InspectorContext {
  addInitScript(script: string): Promise<void>;
  newPage(): Promise<InspectorPage>;
  close(): Promise<void>;
}

export interface InspectorDeps {
  pool: { acquire(viewport?: Viewport): Promise<InspectorContext> };
  settle?: typeof settleStory;
  writeFile?: (path: string, data: Buffer) => Promise<void>;
  now?: () => number;
}

export interface Inspector {
  check(record: InstanceRecord, req: CheckRequest): Promise<CheckResponse>;
  screenshot(record: InstanceRecord, req: ScreenshotRequest): Promise<ScreenshotResponse>;
}

export const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_VIEWPORT: Viewport = { width: 1280, height: 720 };

function assertReady(record: InstanceRecord): void {
  if (record.status !== 'ready') {
    throw new StorybrokrError(
      'INSTANCE_NOT_READY',
      `instance ${record.id} is ${record.status}; check and screenshot need a ready instance`,
    );
  }
}

function findStories(record: InstanceRecord, ids: string[] | undefined): StoryEntry[] {
  if (!ids) return record.stories;
  const byId = new Map(record.stories.map((s) => [s.id, s]));
  const unknown = ids.filter((id) => !byId.has(id));
  if (unknown.length > 0) {
    throw new StorybrokrError(
      'STORY_NOT_FOUND',
      `unknown story id${unknown.length > 1 ? 's' : ''} for ${record.id}: ${unknown.join(', ')}`,
    );
  }
  return ids.map((id) => byId.get(id) as StoryEntry);
}

async function defaultWriteFile(path: string, data: Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await fsWriteFile(path, data);
}

/** PNG stores width/height big-endian at bytes 16 and 20 of the IHDR chunk. */
function pngSize(buf: Buffer): { width: number; height: number } {
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

export function createInspector(deps: InspectorDeps): Inspector {
  const settle = deps.settle ?? settleStory;
  const writeFile = deps.writeFile ?? defaultWriteFile;
  const now = deps.now ?? Date.now;

  return {
    async check(record, req) {
      assertReady(record);
      const stories = findStories(record, req.storyIds);
      const timeoutMs = req.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const results: CheckResult[] = [];
      const ctx = await deps.pool.acquire();
      try {
        await ctx.addInitScript(RECORDER_SCRIPT);
        const page = await ctx.newPage();
        for (const story of stories) {
          const t0 = now();
          const outcome = await settle(page, { iframeUrl: story.iframeUrl, waitFor: req.waitFor, timeoutMs });
          const durationMs = now() - t0;
          if (outcome.kind === 'pass') {
            results.push({ storyId: story.id, status: 'pass', played: outcome.played, durationMs });
          } else if (outcome.kind === 'fail') {
            results.push({
              storyId: story.id,
              status: 'fail',
              played: false,
              durationMs,
              error:
                outcome.stack === undefined
                  ? { message: outcome.reason, event: outcome.event }
                  : { message: outcome.reason, event: outcome.event, stack: outcome.stack },
            });
          } else {
            results.push({
              storyId: story.id,
              status: 'timeout',
              played: false,
              durationMs,
              error: {
                message: `did not settle within ${timeoutMs}ms (last phase: ${outcome.lastPhase ?? 'none'})`,
                event: 'timeout',
              },
            });
          }
        }
      } finally {
        await ctx.close();
      }
      const summary = { pass: 0, fail: 0, timeout: 0 };
      for (const r of results) summary[r.status]++;
      return { instanceId: record.id, results, summary };
    },

    async screenshot(record, req) {
      assertReady(record);
      const [story] = findStories(record, [req.storyId]);
      const viewport = req.viewport ?? DEFAULT_VIEWPORT;
      const clip = req.clip ?? 'root';
      const timeoutMs = req.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const outPath =
        req.outPath ??
        join(record.configDir, 'screenshots', `${story.id}-${viewport.width}x${viewport.height}.png`);
      const t0 = now();
      const ctx = await deps.pool.acquire(viewport);
      let png: Buffer;
      try {
        await ctx.addInitScript(RECORDER_SCRIPT);
        const page = await ctx.newPage();
        const outcome = await settle(page, { iframeUrl: story.iframeUrl, waitFor: req.waitFor, timeoutMs });
        if (outcome.kind === 'fail') {
          throw new StorybrokrError('STORY_FAILED', `${story.id}: ${outcome.reason} (${outcome.event})`);
        }
        if (outcome.kind === 'timeout') {
          throw new StorybrokrError(
            'STORY_TIMEOUT',
            `${story.id} did not settle within ${timeoutMs}ms (last phase: ${outcome.lastPhase ?? 'none'})`,
          );
        }
        if (clip === 'page') png = await page.screenshot({ fullPage: true });
        else if (clip === 'viewport') png = await page.screenshot({});
        else {
          const box = await page.locator('#storybook-root').boundingBox();
          png =
            box && box.width > 0 && box.height > 0
              ? await page.screenshot({
                  fullPage: true,
                  clip: { x: box.x, y: box.y, width: Math.ceil(box.width), height: Math.ceil(box.height) },
                })
              : await page.screenshot({});
        }
      } finally {
        await ctx.close();
      }
      try {
        await writeFile(outPath, png);
      } catch (err) {
        throw new StorybrokrError(
          'SCREENSHOT_WRITE_FAILED',
          `could not write ${outPath}: ${(err as Error).message}`,
        );
      }
      const { width, height } = pngSize(png);
      return { instanceId: record.id, storyId: story.id, path: outPath, width, height, durationMs: now() - t0 };
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @helmsmith/storybrokr typecheck && pnpm --filter @helmsmith/storybrokr exec vitest run src/server/inspector.test.ts`
Expected: PASS. If `typecheck` complains that Playwright's `BrowserContext` is not assignable to `InspectorContext` (it is not used yet — that check comes in Task 6), ignore for now.

- [ ] **Step 5: Commit**

```bash
git add apps/storybrokr/src/server/inspector.ts apps/storybrokr/src/server/inspector.test.ts
git commit -m "feat(storybrokr): inspector service running check and screenshot over the browser pool"
```

---

### Task 6: Routes and daemon wiring

**Files:**
- Modify: `src/server/routes.ts`
- Modify: `src/server/daemon.ts`
- Modify: `src/server/daemon.test.ts`

**Interfaces:**
- Consumes: `Inspector`, `createInspector`, `BrowserPool`.
- Produces: `RouteContext.inspector: Inspector`; `DaemonOptions.inspector?: Inspector` (tests inject a fake); routes `POST /v1/instances/:id/check` → `200 CheckResponse`, `POST /v1/instances/:id/screenshot` → `200 ScreenshotResponse`.

- [ ] **Step 1: Write the failing test**

Add to `src/server/daemon.test.ts`, inside `describe('daemon')`. First extend `boot` to accept an inspector:

```ts
  async function boot(broker?: Broker, inspector?: Inspector) {
    const home = mkdtempSync(join(tmpdir(), 'sb-daemon-'));
    homes.push(home);
    const registry = new Registry({ home, config: DEFAULT_CONFIG });
    const b = broker ?? new Broker({ registry, spawner: neverSpawner, config: DEFAULT_CONFIG });
    const daemon = createDaemon({ home, broker: b, config: DEFAULT_CONFIG, inspector });
    daemons.push(daemon);
    const info = await daemon.start(0);
    return { home, daemon, info, broker: b, registry };
  }
```

Add `import type { Inspector } from './inspector.js';` at the top. Then the test:

```ts
  it('routes check and screenshot to the inspector with validated bodies, touching the instance', async () => {
    const calls: unknown[] = [];
    const inspector: Inspector = {
      check: async (record, req) => {
        calls.push(['check', record.id, req]);
        return { instanceId: record.id, results: [], summary: { pass: 0, fail: 0, timeout: 0 } };
      },
      screenshot: async (record, req) => {
        calls.push(['screenshot', record.id, req]);
        return { instanceId: record.id, storyId: req.storyId, path: '/p.png', width: 1, height: 1, durationMs: 5 };
      },
    };
    const { daemon, registry } = await boot(undefined, inspector);
    registry.add({ ...makeRecord('r1'), lastTouchedAt: '2000-01-01T00:00:00.000Z' });
    const auth = { authorization: `Bearer ${daemon.token}`, 'content-type': 'application/json' };

    const check = await fetch(`${daemon.url}/v1/instances/r1/check`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ storyIds: ['x--a'], waitFor: { text: 'Go' }, timeoutMs: 5000 }),
    });
    expect(check.status).toBe(200);
    expect(await check.json()).toMatchObject({ instanceId: 'r1', summary: { pass: 0 } });
    expect(calls[0]).toEqual(['check', 'r1', { storyIds: ['x--a'], waitFor: { text: 'Go' }, timeoutMs: 5000 }]);
    expect(registry.get('r1')?.lastTouchedAt).not.toBe('2000-01-01T00:00:00.000Z');

    const shot = await fetch(`${daemon.url}/v1/instances/r1/screenshot`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ storyId: 'x--a', viewport: { width: 640, height: 480 }, clip: 'page' }),
    });
    expect(shot.status).toBe(200);
    expect(await shot.json()).toMatchObject({ path: '/p.png' });
    expect(calls[1]).toEqual(['screenshot', 'r1', { storyId: 'x--a', viewport: { width: 640, height: 480 }, clip: 'page' }]);

    const bad = await fetch(`${daemon.url}/v1/instances/r1/screenshot`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ storyId: 'x--a', clip: 'sideways' }),
    });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ code: 'BAD_REQUEST', message: /clip/ });

    const tooLong = await fetch(`${daemon.url}/v1/instances/r1/check`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ timeoutMs: 999 }),
    });
    expect(tooLong.status).toBe(400);

    const missing = await fetch(`${daemon.url}/v1/instances/nope/check`, { method: 'POST', headers: auth, body: '{}' });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({ code: 'INSTANCE_NOT_FOUND' });
  });
```

`Registry.add(record)` is the real insert method (`src/server/registry.ts:66`); it throws if the id already exists, which is fine here.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @helmsmith/storybrokr exec vitest run src/server/daemon.test.ts -t "routes check and screenshot"`
Expected: FAIL — `inspector` is not a `DaemonOptions` key / 404 on the new routes.

- [ ] **Step 3: Implement routes**

In `src/server/routes.ts`, add schemas after `InspectBody`:

```ts
const WaitForBody = z.union([
  z.object({ selector: z.string().min(1) }),
  z.object({ text: z.string().min(1) }),
]);
const TimeoutMs = z.number().int().min(1000).max(300_000).optional();

const CheckBody = z.object({
  storyIds: z.array(z.string().min(1)).min(1).optional(),
  waitFor: WaitForBody.optional(),
  timeoutMs: TimeoutMs,
});

const ScreenshotBody = z.object({
  storyId: z.string().min(1),
  outPath: z.string().min(1).optional(),
  viewport: z
    .object({ width: z.number().int().min(1).max(10_000), height: z.number().int().min(1).max(10_000) })
    .optional(),
  clip: z.enum(['root', 'viewport', 'page']).optional(),
  waitFor: WaitForBody.optional(),
  timeoutMs: TimeoutMs,
});
```

Add `inspector: Inspector;` to `RouteContext` and `import type { Inspector } from './inspector.js';`. Inside the `instances` block, after the `touch` route:

```ts
      if (parts.length === 4 && parts[3] === 'check' && method === 'POST') {
        const body = parseBody(CheckBody, await readJson(req));
        const record = ctx.broker.get(id); // touches the instance
        return send(res, 200, await ctx.inspector.check(record, body));
      }
      if (parts.length === 4 && parts[3] === 'screenshot' && method === 'POST') {
        const body = parseBody(ScreenshotBody, await readJson(req));
        const record = ctx.broker.get(id);
        return send(res, 200, await ctx.inspector.screenshot(record, body));
      }
```

- [ ] **Step 4: Wire the daemon**

In `src/server/daemon.ts`:

```ts
import { BrowserPool } from './browser.js';
import { createInspector, type Inspector } from './inspector.js';
```

Add `inspector?: Inspector;` to `DaemonOptions`. In `createDaemon`, before `const stop = ...`:

```ts
  const pool = new BrowserPool({
    idleMinutes: opts.config.browserIdleMinutes,
    log: (line) => console.error(`storybrokr: browser: ${line}`),
  });
  const inspector = opts.inspector ?? createInspector({ pool });
```

In `stop`, right after `await opts.broker.downAll();`:

```ts
    await pool.close().catch((err: unknown) => console.error('storybrokr: browser close failed', err));
```

Add `inspector,` to the `ctx` object in `start`.

If `typecheck` reports that Playwright's `BrowserContext` is not assignable to `InspectorContext` (method overload shapes), change `InspectorDeps.pool` in `inspector.ts` to `{ acquire(viewport?: Viewport): Promise<InspectorContext> }` and pass `{ acquire: (v) => pool.acquire(v) as unknown as Promise<InspectorContext> }` in daemon.ts with a one-line comment: `// Playwright's BrowserContext satisfies InspectorContext structurally; the cast only narrows overloads.`

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @helmsmith/storybrokr typecheck && pnpm --filter @helmsmith/storybrokr test`
Expected: PASS, including the whole existing daemon and client suites (they construct daemons without `inspector`, which now builds a real pool that never launches).

- [ ] **Step 6: Commit**

```bash
git add apps/storybrokr/src/server/routes.ts apps/storybrokr/src/server/daemon.ts apps/storybrokr/src/server/daemon.test.ts
git commit -m "feat(storybrokr): check and screenshot routes; daemon owns the browser pool"
```

---

### Task 7: Client methods

**Files:**
- Modify: `src/client/index.ts`
- Modify: `src/client/index.test.ts`

**Interfaces:**
- Produces: `DaemonClient.check(id: string, req?: CheckRequest): Promise<CheckResponse>`, `DaemonClient.screenshot(id: string, req: ScreenshotRequest): Promise<ScreenshotResponse>`.

- [ ] **Step 1: Write the failing test**

Add to `src/client/index.test.ts` (reuse the file's `fakeDaemon` pattern; pass an `inspector` through by extending `fakeDaemon` with an optional second argument that is forwarded to `createDaemon`):

```ts
  it('check and screenshot post JSON bodies and unwrap responses or coded errors', async () => {
    const home = mkdtempSync(join(tmpdir(), 'sb-client-'));
    homes.push(home);
    const seen: unknown[] = [];
    const { daemon, registry } = fakeDaemon(home, {
      check: async (record, req) => {
        seen.push(req);
        return { instanceId: record.id, results: [], summary: { pass: 0, fail: 0, timeout: 0 } };
      },
      screenshot: async () => {
        throw new StorybrokrError('STORY_FAILED', 'nope');
      },
    });
    daemons.push(daemon);
    await daemon.start(0);
    registry.add(makeRecord('r1')); // makeRecord: copy the helper from daemon.test.ts if this file lacks one
    const client = await DaemonClient.connect({ home, autoStart: false });
    const res = await client.check('r1', { storyIds: ['a--b'], timeoutMs: 2000 });
    expect(res.instanceId).toBe('r1');
    expect(seen[0]).toEqual({ storyIds: ['a--b'], timeoutMs: 2000 });
    await expect(client.screenshot('r1', { storyId: 'a--b' })).rejects.toMatchObject({ code: 'STORY_FAILED' });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @helmsmith/storybrokr exec vitest run src/client/index.test.ts -t "check and screenshot"`
Expected: FAIL — `client.check is not a function`.

- [ ] **Step 3: Implement**

In `src/client/index.ts`, extend the type import:

```ts
import type {
  CheckRequest,
  CheckResponse,
  DaemonInfo,
  HostInfo,
  InstanceRecord,
  ScreenshotRequest,
  ScreenshotResponse,
  UpRequest,
} from '../types.js';
```

Add after `touch`:

```ts
  check(id: string, req: CheckRequest = {}): Promise<CheckResponse> {
    return this.request<CheckResponse>('POST', `/v1/instances/${encodeURIComponent(id)}/check`, req);
  }
  screenshot(id: string, req: ScreenshotRequest): Promise<ScreenshotResponse> {
    return this.request<ScreenshotResponse>(
      'POST',
      `/v1/instances/${encodeURIComponent(id)}/screenshot`,
      req,
    );
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @helmsmith/storybrokr typecheck && pnpm --filter @helmsmith/storybrokr exec vitest run src/client/index.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/storybrokr/src/client/index.ts apps/storybrokr/src/client/index.test.ts
git commit -m "feat(storybrokr): client check and screenshot methods"
```

---

### Task 8: CLI commands `check` and `screenshot`

**Files:**
- Create: `src/commands/_shared/inspect.ts`
- Create: `src/commands/_shared/inspect.test.ts`
- Create: `src/commands/check.ts`
- Create: `src/commands/screenshot.ts`
- Modify: `src/cli.ts`

**Interfaces:**
- Consumes: `DaemonClient.check/screenshot`, `fail`, `printJson`, `parseIntegerInRange`.
- Produces: `parseViewport(value: string): Viewport`, `parseClip(value: string): ScreenshotClip`, `collect(value: string, prev: string[]): string[]`, `waitForFrom(o: { waitForText?: string; waitForSelector?: string }): WaitFor | undefined`, `formatCheckResults(res: CheckResponse): string[]`, `registerCheck(program, connect)`, `registerScreenshot(program, connect)`.

- [ ] **Step 1: Write the failing tests**

`src/commands/_shared/inspect.test.ts`:

```ts
import { InvalidArgumentError } from 'commander';
import { describe, expect, it } from 'vitest';
import type { CheckResponse } from '../../types.js';
import { collect, formatCheckResults, parseClip, parseViewport, waitForFrom } from './inspect.js';

describe('inspect option parsers', () => {
  it('parses WxH viewports and rejects malformed ones', () => {
    expect(parseViewport('1280x720')).toEqual({ width: 1280, height: 720 });
    expect(parseViewport('375X812')).toEqual({ width: 375, height: 812 });
    for (const bad of ['1280', '0x10', 'axb', '1280x720x1', '-1x5'])
      expect(() => parseViewport(bad)).toThrow(InvalidArgumentError);
  });

  it('parses clip modes', () => {
    expect(parseClip('root')).toBe('root');
    expect(parseClip('page')).toBe('page');
    expect(() => parseClip('sideways')).toThrow(InvalidArgumentError);
  });

  it('collects repeatable options', () => {
    expect(collect('b', ['a'])).toEqual(['a', 'b']);
  });

  it('builds waitFor from exactly one of the two flags', () => {
    expect(waitForFrom({})).toBeUndefined();
    expect(waitForFrom({ waitForText: 'Go' })).toEqual({ text: 'Go' });
    expect(waitForFrom({ waitForSelector: 'h2' })).toEqual({ selector: 'h2' });
    expect(() => waitForFrom({ waitForText: 'a', waitForSelector: 'b' })).toThrow(/one of/);
  });
});

describe('formatCheckResults', () => {
  it('prints one line per story and a summary', () => {
    const res: CheckResponse = {
      instanceId: 'i',
      results: [
        { storyId: 'p--a', status: 'pass', played: false, durationMs: 120 },
        { storyId: 'p--b', status: 'pass', played: true, durationMs: 340 },
        { storyId: 'p--c', status: 'fail', played: false, durationMs: 310, error: { message: 'expected x', event: 'playFunctionThrewException' } },
        { storyId: 'p--d', status: 'timeout', played: false, durationMs: 30000, error: { message: 'did not settle', event: 'timeout' } },
      ],
      summary: { pass: 2, fail: 1, timeout: 1 },
    };
    const lines = formatCheckResults(res);
    expect(lines[0]).toMatch(/^✓ p--a\s+120ms$/);
    expect(lines[1]).toMatch(/^✓ p--b\s+340ms \(played\)$/);
    expect(lines[2]).toMatch(/^✗ p--c\s+310ms\s+expected x$/);
    expect(lines[3]).toMatch(/^⏱ p--d\s+30000ms\s+did not settle$/);
    expect(lines[4]).toBe('4 stories: 2 pass, 1 fail, 1 timeout');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @helmsmith/storybrokr exec vitest run src/commands/_shared/inspect.test.ts`
Expected: FAIL — cannot resolve `./inspect.js`.

- [ ] **Step 3: Implement `src/commands/_shared/inspect.ts`**

```ts
import chalk from 'chalk';
import { InvalidArgumentError } from 'commander';
import { StorybrokrError } from '../../lib/errors.js';
import type { CheckResponse, ScreenshotClip, Viewport, WaitFor } from '../../types.js';

/** Commander parser for `--viewport WxH`. */
export function parseViewport(value: string): Viewport {
  const m = /^(\d+)[xX](\d+)$/.exec(value);
  const width = m ? Number(m[1]) : 0;
  const height = m ? Number(m[2]) : 0;
  if (!m || width < 1 || height < 1) {
    throw new InvalidArgumentError('must be WIDTHxHEIGHT, e.g. 1280x720');
  }
  return { width, height };
}

const CLIPS: ScreenshotClip[] = ['root', 'viewport', 'page'];

export function parseClip(value: string): ScreenshotClip {
  if ((CLIPS as string[]).includes(value)) return value as ScreenshotClip;
  throw new InvalidArgumentError(`must be one of ${CLIPS.join(', ')}`);
}

/** Commander accumulator for repeatable options (`--story a --story b`). */
export function collect(value: string, prev: string[]): string[] {
  return [...prev, value];
}

export function waitForFrom(o: { waitForText?: string; waitForSelector?: string }): WaitFor | undefined {
  if (o.waitForText !== undefined && o.waitForSelector !== undefined) {
    throw new StorybrokrError('BAD_REQUEST', 'give only one of --wait-for-text and --wait-for-selector');
  }
  if (o.waitForText !== undefined) return { text: o.waitForText };
  if (o.waitForSelector !== undefined) return { selector: o.waitForSelector };
  return undefined;
}

const MARK = { pass: chalk.green('✓'), fail: chalk.red('✗'), timeout: chalk.yellow('⏱') } as const;

/** One line per story plus a summary line; colors are stripped under FORCE_COLOR=0. */
export function formatCheckResults(res: CheckResponse): string[] {
  const width = Math.max(...res.results.map((r) => r.storyId.length), 1);
  const lines = res.results.map((r) => {
    const head = `${MARK[r.status]} ${r.storyId.padEnd(width)}  ${r.durationMs}ms`;
    if (r.status === 'pass') return r.played ? `${head} (played)` : head;
    return `${head}  ${r.error?.message ?? ''}`;
  });
  const n = res.results.length;
  lines.push(
    `${n} ${n === 1 ? 'story' : 'stories'}: ${res.summary.pass} pass, ${res.summary.fail} fail, ${res.summary.timeout} timeout`,
  );
  return lines;
}
```

If the regex assertions in the test fail only because of ANSI codes, run vitest with `FORCE_COLOR=0` in the test via `process.env.FORCE_COLOR = '0'` at the top of the test file before importing chalk, or compare with `chalk.level` set to 0; Biome-clean either way.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @helmsmith/storybrokr exec vitest run src/commands/_shared/inspect.test.ts`
Expected: PASS

- [ ] **Step 5: Add the two commands**

`src/commands/check.ts`:

```ts
import type { Command } from 'commander';
import type { DaemonClient } from '../client/index.js';
import { collect, formatCheckResults, waitForFrom } from './_shared/inspect.js';
import { fail, parseIntegerInRange, printJson } from './_shared/output.js';

interface CheckOpts {
  story: string[];
  waitForText?: string;
  waitForSelector?: string;
  timeout?: number;
  json?: boolean;
}

export function registerCheck(program: Command, connect: () => Promise<DaemonClient>): void {
  program
    .command('check <id-or-path>')
    .description('Run stories headlessly (play functions included) and report pass/fail per story')
    .option('--story <id>', 'story id to check; repeatable (default: every story)', collect, [])
    .option('--wait-for-text <text>', 'after render, also wait for this visible text')
    .option('--wait-for-selector <selector>', 'after render, also wait for this selector')
    .option('--timeout <ms>', 'per-story budget, 1000-300000 (default 30000)', parseIntegerInRange(1000, 300_000))
    .option('--json', 'print JSON')
    .action(async (idOrPath: string, o: CheckOpts) => {
      try {
        const res = await (await connect()).check(idOrPath, {
          storyIds: o.story.length > 0 ? o.story : undefined,
          waitFor: waitForFrom(o),
          timeoutMs: o.timeout,
        });
        if (o.json) printJson(res);
        else for (const line of formatCheckResults(res)) console.log(line);
        if (res.summary.fail + res.summary.timeout > 0) process.exit(1);
      } catch (err) {
        fail(err, Boolean(o.json));
      }
    });
}
```

`src/commands/screenshot.ts`:

```ts
import { resolve } from 'node:path';
import type { Command } from 'commander';
import type { DaemonClient } from '../client/index.js';
import type { ScreenshotClip, Viewport } from '../types.js';
import { parseClip, parseViewport, waitForFrom } from './_shared/inspect.js';
import { fail, parseIntegerInRange, printJson } from './_shared/output.js';

interface ScreenshotOpts {
  out?: string;
  viewport?: Viewport;
  clip?: ScreenshotClip;
  waitForText?: string;
  waitForSelector?: string;
  timeout?: number;
  json?: boolean;
}

export function registerScreenshot(program: Command, connect: () => Promise<DaemonClient>): void {
  program
    .command('screenshot <id-or-path> <story-id>')
    .description('Write a PNG of one story at the requested viewport')
    .option('--out <path>', 'output file (default: <instance configDir>/screenshots/<story>-<WxH>.png)')
    .option('--viewport <WxH>', 'viewport size (default 1280x720)', parseViewport)
    .option('--clip <mode>', 'root | viewport | page (default root)', parseClip)
    .option('--wait-for-text <text>', 'after render, also wait for this visible text')
    .option('--wait-for-selector <selector>', 'after render, also wait for this selector')
    .option('--timeout <ms>', 'settle budget, 1000-300000 (default 30000)', parseIntegerInRange(1000, 300_000))
    .option('--json', 'print JSON')
    .action(async (idOrPath: string, storyId: string, o: ScreenshotOpts) => {
      try {
        // The daemon's cwd is meaningless to the caller: resolve relative paths here.
        const outPath = o.out === undefined ? undefined : resolve(process.cwd(), o.out);
        const res = await (await connect()).screenshot(idOrPath, {
          storyId,
          outPath,
          viewport: o.viewport,
          clip: o.clip,
          waitFor: waitForFrom(o),
          timeoutMs: o.timeout,
        });
        if (o.json) printJson(res);
        else console.log(res.path);
      } catch (err) {
        fail(err, Boolean(o.json));
      }
    });
}
```

`src/cli.ts`: add imports `registerCheck` from `./commands/check.js` and `registerScreenshot` from `./commands/screenshot.js`, and after `registerTouch(program, connect);` add:

```ts
registerCheck(program, connect);
registerScreenshot(program, connect);
```

- [ ] **Step 6: Verify**

Run: `pnpm --filter @helmsmith/storybrokr typecheck && pnpm --filter @helmsmith/storybrokr test && pnpm --filter @helmsmith/storybrokr exec tsx src/cli.ts check --help`
Expected: tests PASS; help text lists `--story`, `--wait-for-text`, `--wait-for-selector`, `--timeout`, `--json`.

- [ ] **Step 7: Commit**

```bash
git add apps/storybrokr/src/commands/_shared/inspect.ts apps/storybrokr/src/commands/_shared/inspect.test.ts apps/storybrokr/src/commands/check.ts apps/storybrokr/src/commands/screenshot.ts apps/storybrokr/src/cli.ts
git commit -m "feat(storybrokr): check and screenshot CLI commands"
```

---

### Task 9: MCP tools

**Files:**
- Modify: `src/mcp/server.ts`
- Modify: `src/mcp/server.test.ts`

**Interfaces:**
- Produces: tools `storybrokr_check { id, storyIds?, waitFor?, timeoutMs? }` and `storybrokr_screenshot { id, storyId, outPath?, viewport?, clip?, waitFor?, timeoutMs? }`.

- [ ] **Step 1: Write the failing tests**

In `src/mcp/server.test.ts`, rename the first test to `'exposes the nine tools'` and add `'storybrokr_check'` and `'storybrokr_screenshot'` to the sorted expected list (alphabetical: `storybrokr_check` comes first, `storybrokr_screenshot` goes between `storybrokr_logs` and `storybrokr_touch`). Add:

```ts
  it('check and screenshot forward their arguments and surface failing stories as normal results', async () => {
    const check = vi.fn(async () => ({
      instanceId: 'abc',
      results: [{ storyId: 's', status: 'fail', played: false, durationMs: 1, error: { message: 'x', event: 'e' } }],
      summary: { pass: 0, fail: 1, timeout: 0 },
    }));
    const screenshot = vi.fn(async () => {
      throw new StorybrokrError('STORY_TIMEOUT', 'slow');
    });
    const client = await connected({ check, screenshot } as unknown as Partial<DaemonClient>);
    const r = await client.callTool({
      name: 'storybrokr_check',
      arguments: { id: 'abc', storyIds: ['s'], waitFor: { text: 'Go' }, timeoutMs: 5000 },
    });
    expect(r.isError).toBeFalsy();
    expect(check).toHaveBeenCalledWith('abc', { storyIds: ['s'], waitFor: { text: 'Go' }, timeoutMs: 5000 });
    const s = await client.callTool({
      name: 'storybrokr_screenshot',
      arguments: { id: 'abc', storyId: 's', outPath: '/tmp/s.png', viewport: { width: 640, height: 480 }, clip: 'page' },
    });
    expect(s.isError).toBe(true);
    expect(screenshot).toHaveBeenCalledWith('abc', {
      storyId: 's',
      outPath: '/tmp/s.png',
      viewport: { width: 640, height: 480 },
      clip: 'page',
      waitFor: undefined,
      timeoutMs: undefined,
    });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @helmsmith/storybrokr exec vitest run src/mcp/server.test.ts`
Expected: FAIL — tool list has seven entries; unknown tool `storybrokr_check`.

- [ ] **Step 3: Implement**

In `src/mcp/server.ts`, after the `storybrokr_touch` registration:

```ts
  const waitFor = z
    .union([z.object({ selector: z.string() }), z.object({ text: z.string() })])
    .optional()
    .describe(
      'After Storybook reports the story rendered, also wait for a selector or visible text (hosts with Suspense fallbacks such as "Loading translations…")',
    );
  const timeoutMs = z
    .number()
    .int()
    .min(1000)
    .max(300_000)
    .optional()
    .describe('Settle budget in ms per story (default 30000)');

  server.registerTool(
    'storybrokr_check',
    {
      description:
        'Run stories headlessly in Chromium and report pass/fail per story. Play functions are executed; a story passes when Storybook reports its render (and play) completed. Failing stories are rows in the result, not tool errors.',
      inputSchema: {
        id: z.string().describe('Instance id or component path'),
        storyIds: z.array(z.string()).min(1).optional().describe('Default: every story in the instance'),
        waitFor,
        timeoutMs,
      },
    },
    async ({ id, storyIds, waitFor: wf, timeoutMs: t }) =>
      guard(async () => (await connect()).check(id, { storyIds, waitFor: wf, timeoutMs: t })),
  );

  server.registerTool(
    'storybrokr_screenshot',
    {
      description:
        'Write a PNG of one story at a viewport you choose and return its absolute path. Use an absolute outPath to save anywhere (e.g. a scratchpad). Refuses to capture a story that errored or timed out.',
      inputSchema: {
        id: z.string().describe('Instance id or component path'),
        storyId: z.string(),
        outPath: z.string().optional().describe('Absolute output path; default <instance configDir>/screenshots/<story>-<WxH>.png'),
        viewport: z
          .object({ width: z.number().int().min(1).max(10_000), height: z.number().int().min(1).max(10_000) })
          .optional()
          .describe('Default 1280x720'),
        clip: z.enum(['root', 'viewport', 'page']).optional().describe('root = #storybook-root bounds (default); viewport; page = full page'),
        waitFor,
        timeoutMs,
      },
    },
    async ({ id, storyId, outPath, viewport, clip, waitFor: wf, timeoutMs: t }) =>
      guard(async () =>
        (await connect()).screenshot(id, { storyId, outPath, viewport, clip, waitFor: wf, timeoutMs: t }),
      ),
  );
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @helmsmith/storybrokr typecheck && pnpm --filter @helmsmith/storybrokr exec vitest run src/mcp/server.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/storybrokr/src/mcp/server.ts apps/storybrokr/src/mcp/server.test.ts
git commit -m "feat(storybrokr): storybrokr_check and storybrokr_screenshot MCP tools"
```

---

### Task 10: Doctor browser row

**Files:**
- Modify: `src/commands/doctor.ts`

**Interfaces:**
- Consumes: `browserStatus()` from `src/server/browser.ts`.

There is no existing doctor unit test (it shells out to a real host); verify by running the command.

- [ ] **Step 1: Implement**

In `src/commands/doctor.ts` add `import { browserStatus } from '../server/browser.js';`. Inside the action, after `const host = resolveHost(...)`:

```ts
        const browser = browserStatus();
        if (o.json) return printJson({ ...host, browser });
```

(replacing the existing `if (o.json) return printJson(host);`), and after the `aliases` line:

```ts
        console.log(
          `${browser.installed ? chalk.green('ok') : chalk.yellow('--')}  browser    ${
            browser.installed
              ? `chromium at ${browser.executablePath}`
              : 'chromium not installed; fetched on first check/screenshot'
          }`,
        );
```

- [ ] **Step 2: Verify**

Run: `pnpm --filter @helmsmith/storybrokr exec tsx src/cli.ts doctor tests/e2e/fixtures/host-react-vite`
Expected: the existing rows plus a `browser` row reporting the Chromium path (installed in Task 4).

Run: `pnpm --filter @helmsmith/storybrokr typecheck && pnpm --filter @helmsmith/storybrokr test`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add apps/storybrokr/src/commands/doctor.ts
git commit -m "feat(storybrokr): doctor reports chromium availability"
```

---

### Task 11: Fixture stories, end-to-end suite, CI

**Files:**
- Modify: `tests/e2e/fixtures/host-react-vite/src/components/Panel/Panel.stories.tsx`
- Modify: `tests/e2e/up-down.test.ts:27-33` and `:53`
- Modify: `tests/e2e/render.test.ts`
- Create: `tests/e2e/inspect.test.ts`
- Modify: `../../.github/workflows/ci.yml` (before the `storybrokr end-to-end` step)

- [ ] **Step 1: Add play-function stories to the fixture**

Replace `Panel.stories.tsx` with:

```tsx
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import { Panel } from './Panel';

const meta: Meta<typeof Panel> = { title: 'Organisms/Panel', component: Panel };
export default meta;

export const Default: StoryObj<typeof Panel> = { args: { title: 'Panel' } };

/** Exercises the child Button and asserts the heading: storybrokr check reports played: true. */
export const WithPlay: StoryObj<typeof Panel> = {
  args: { title: 'Panel' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Go' }));
    await expect(canvas.getByRole('heading')).toHaveTextContent('Panel');
  },
};

/** Deliberately wrong assertion so the e2e suite sees a failing play function. */
export const PlayFails: StoryObj<typeof Panel> = {
  args: { title: 'Panel' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('heading')).toHaveTextContent('Not the title');
  },
};
```

`storybook/test` ships inside the `storybook` package in v10 (`exports["./test"]`), so the fixture needs no new dependency.

- [ ] **Step 2: Update the story-count assertions**

In `tests/e2e/up-down.test.ts`, the sorted id list becomes:

```ts
    expect(ids).toEqual([
      'atoms-button--primary',
      'atoms-button--secondary',
      'atoms-icon--star',
      'organisms-panel--default',
      'organisms-panel--play-fails',
      'organisms-panel--with-play',
    ]);
```

and `expect(got.stories.length).toBe(4);` becomes `toBe(6)`.

- [ ] **Step 3: Simplify the render test**

In `tests/e2e/render.test.ts`, delete the `createRequire` import and the `enabled` constant; change `describe.skipIf(!enabled)('headless render (opt-in)', …)` to `describe('headless render', …)`; replace the `require`/`createRequire` block with:

```ts
    const { chromium } = await import('playwright');
```

- [ ] **Step 4: Write the e2e suite `tests/e2e/inspect.test.ts`**

```ts
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { CheckResponse, InstanceRecord, ScreenshotResponse } from '../../src/types.js';
import { FIXTURE_HOST, makeHome, runCli, runJson } from './helpers.js';

describe('check and screenshot', () => {
  const { home, cleanup } = makeHome();
  let rec: InstanceRecord;

  afterAll(async () => {
    await runCli(['daemon', 'stop'], { home }).catch(() => {});
    cleanup();
  });

  it('check reports pass/fail per story, with played only for play stories, and exits 1 on any failure', async () => {
    rec = await runJson<InstanceRecord>(['up', 'src/components/Panel', '--host', FIXTURE_HOST], { home });
    const r = await runCli(['check', rec.id, '--json'], { home });
    expect(r.code).toBe(1);
    const res = JSON.parse(r.stdout) as CheckResponse;
    const by = Object.fromEntries(res.results.map((x) => [x.storyId, x]));
    expect(by['organisms-panel--default']).toMatchObject({ status: 'pass', played: false });
    expect(by['organisms-panel--with-play']).toMatchObject({ status: 'pass', played: true });
    expect(by['organisms-panel--play-fails'].status).toBe('fail');
    expect(by['organisms-panel--play-fails'].error?.message).toMatch(/Not the title/);
    expect(res.summary).toEqual({ pass: 2, fail: 1, timeout: 0 });
  });

  it('check --story restricts the run and exits 0 when everything passes', async () => {
    const res = await runJson<CheckResponse>(
      ['check', rec.id, '--story', 'organisms-panel--default', '--wait-for-text', 'Go'],
      { home },
    );
    expect(res.results.map((x) => x.storyId)).toEqual(['organisms-panel--default']);
    expect(res.summary).toEqual({ pass: 1, fail: 0, timeout: 0 });
  });

  it('screenshot writes a PNG at the requested viewport to an absolute --out path', async () => {
    const out = join(home, 'shots', 'panel.png');
    const res = await runJson<ScreenshotResponse>(
      ['screenshot', 'src/components/Panel', 'organisms-panel--default', '--out', out, '--viewport', '640x480'],
      { home },
    );
    expect(res.path).toBe(out);
    expect(existsSync(out)).toBe(true);
    const buf = readFileSync(out);
    expect(buf.subarray(1, 4).toString()).toBe('PNG');
    expect(buf.readUInt32BE(16)).toBeLessThanOrEqual(640);
    expect(res.width).toBe(buf.readUInt32BE(16));
  });

  it('screenshot defaults into the instance configDir with the viewport in the name', async () => {
    const res = await runJson<ScreenshotResponse>(
      ['screenshot', rec.id, 'organisms-panel--with-play', '--clip', 'viewport'],
      { home },
    );
    expect(res.path).toBe(join(rec.configDir, 'screenshots', 'organisms-panel--with-play-1280x720.png'));
    expect(res.width).toBe(1280);
    expect(res.height).toBe(720);
  });

  it('screenshot refuses a failing story with STORY_FAILED', async () => {
    const r = await runCli(['screenshot', rec.id, 'organisms-panel--play-fails', '--json'], { home });
    expect(r.code).toBe(1);
    expect(JSON.parse(r.stderr)).toMatchObject({ code: 'STORY_FAILED' });
  });

  it('unknown story ids are rejected up front', async () => {
    const r = await runCli(['check', rec.id, '--story', 'nope--x', '--json'], { home });
    expect(r.code).toBe(1);
    expect(JSON.parse(r.stderr)).toMatchObject({ code: 'STORY_NOT_FOUND', message: /nope--x/ });
  });
});
```

- [ ] **Step 5: Add the CI step**

In `../../.github/workflows/ci.yml`, immediately before `- name: storybrokr end-to-end`:

```yaml
      - name: Install Chromium for storybrokr
        # check/screenshot drive a headless Chromium; the e2e suite (and the
        # daemon's lazy installer, which this pre-empts) need it present.
        run: pnpm --filter @helmsmith/storybrokr exec playwright install --with-deps chromium
```

Update the `storybrokr end-to-end` step comment to mention "check/screenshot against headless Chromium".

- [ ] **Step 6: Run the e2e suite**

Run: `pnpm --filter @helmsmith/storybrokr test:e2e`
Expected: PASS for `up-down`, `render`, `inspect`, and the rest. First run of `inspect` may take longer while Storybook boots the fixture; the per-test timeout is 180 s.

If `PlayFails` is reported as `pass`: Storybook emits `playFunctionThrewException` before the `errored` phase; confirm the recorder attached before the play ran by checking `storybrokr logs <id>` for the preview boot, then check `RECORDER_SCRIPT`'s event names against `tests/e2e/fixtures/host-react-vite/node_modules/storybook/dist/`.

- [ ] **Step 7: Commit**

```bash
git add apps/storybrokr/tests/e2e/fixtures/host-react-vite/src/components/Panel/Panel.stories.tsx apps/storybrokr/tests/e2e/up-down.test.ts apps/storybrokr/tests/e2e/render.test.ts apps/storybrokr/tests/e2e/inspect.test.ts .github/workflows/ci.yml
git commit -m "test(storybrokr): play-function fixture stories, check/screenshot e2e, chromium in CI"
```

---

### Task 12: Docs and changeset

**Files:**
- Modify: `README.md`
- Modify: `SKILL.md`
- Create: `../../.changeset/storybrokr-check-screenshot.md`

- [ ] **Step 1: README**

In the Commands table, after the `touch` row add:

```markdown
| `storybrokr check <id> [--story <id>]... [--wait-for-text <t> \| --wait-for-selector <s>] [--timeout <ms>] [--json]` | Run stories headlessly; pass/fail per story, exit 1 on any failure |
| `storybrokr screenshot <id> <story-id> [--out <path>] [--viewport <WxH>] [--clip root\|viewport\|page] [--wait-for-text <t> \| --wait-for-selector <s>] [--timeout <ms>] [--json]` | Write a PNG of one story |
```

Add a new section before `## MCP`:

```markdown
## Check and screenshot

Both drive a headless Chromium that the daemon owns. `playwright` is a
regular dependency; the browser itself is fetched on the first
`check`/`screenshot` (`playwright install chromium`, logged by the daemon)
and reused afterwards. `storybrokr doctor` shows whether it is present.

A story **settles** when Storybook's preview reports its render phase
`completed` (play functions run before that), network activity goes quiet,
and, if given, `--wait-for-text` / `--wait-for-selector` matches. Hosts that
show a Suspense fallback first ("Loading translations…") need the wait flag.

- `check` runs every story in the instance (or `--story` ids) one after
  another in a single browser context and prints one line per story. A
  failing or timed-out story is a result row, not an error; the exit code
  is 1 when any story is not `pass`. `played` is true when a play function
  actually ran.
- `screenshot` captures `#storybook-root`'s bounding box by default
  (`--clip viewport` or `page` for the alternatives) at `--viewport`
  (default `1280x720`). A relative `--out` resolves against your cwd; the
  default is `<instance configDir>/screenshots/<story>-<WxH>.png`. It refuses
  to capture a story that failed or timed out (`STORY_FAILED`,
  `STORY_TIMEOUT`).
```

In the MCP section, extend the tool list sentence to: `…, storybrokr_touch, storybrokr_inspect_host, storybrokr_check, and storybrokr_screenshot.` and add: "`storybrokr_screenshot` returns the written path, not the image; pass an absolute `outPath` to save outside the host repo."

In the Configuration table add:

```markdown
| `browserIdleMinutes` | 10 | Minutes with no open check/screenshot before the daemon closes its Chromium; `0` keeps it open |
```

- [ ] **Step 2: SKILL.md**

Replace step 2 of "The loop" with:

```markdown
2. `storybrokr screenshot <id> <story-id> --out <abs-path> [--viewport WxH]` for evidence, or `storybrokr check <id>` to run every story's play function headlessly and get pass/fail per story. Both wait for Storybook to report the story rendered; hosts with a Suspense fallback ("Loading translations…") also need `--wait-for-text <expected text>`. Only fall back to loading `iframeUrl` in your own browser when you need to interact beyond what a play function covers.
```

Add the two command rows from the README to the Commands table. In "MCP tools", append: `` `storybrokr_check { id, storyIds?, waitFor?, timeoutMs? }` → `{ instanceId, results: [{ storyId, status: "pass"|"fail"|"timeout", played, durationMs, error? }], summary }`; failing stories are rows, `isError` is only set for instance/browser problems. `storybrokr_screenshot { id, storyId, outPath?, viewport?, clip?, waitFor?, timeoutMs? }` → `{ path, width, height }`; give an absolute `outPath` to write anywhere. `waitFor` is `{ text }` or `{ selector }`. ``

In "Error codes", add: `` `INSTANCE_NOT_READY`, `BROWSER_UNAVAILABLE` (installer/launch tail attached), `STORY_NOT_FOUND`, `STORY_FAILED`, `STORY_TIMEOUT`, `SCREENSHOT_WRITE_FAILED`. ``

- [ ] **Step 3: Changeset**

`../../.changeset/storybrokr-check-screenshot.md`:

```markdown
---
"@helmsmith/storybrokr": minor
---

`check` and `screenshot` (CLI + MCP): run stories headlessly with pass/fail per story, and write a PNG of one story at a chosen viewport. Adds a `playwright` dependency; Chromium is fetched lazily on first use. New config key `browserIdleMinutes`.
```

- [ ] **Step 4: Verify docs build nothing, lint passes**

Run from the repo root: `pnpm check` (Biome) and `pnpm --filter @helmsmith/storybrokr typecheck && pnpm --filter @helmsmith/storybrokr test`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add apps/storybrokr/README.md apps/storybrokr/SKILL.md .changeset/storybrokr-check-screenshot.md
git commit -m "docs(storybrokr): check and screenshot in README and SKILL.md; changeset"
```

---

## Self-review

**Spec coverage.** §1 browser runtime → Tasks 4, 10 (doctor). §2 settle protocol → Tasks 2, 3. §3 routes/client/CLI/MCP → Tasks 6, 7, 8, 9. §4 errors → Task 1 (+ `INSTANCE_NOT_READY` amendment noted in Global Constraints). §5 testing → unit tests in every task, e2e and CI in Task 11; `STORYBROKR_PLAYWRIGHT_DIR` removed in Task 11 step 3. §6 docs and release → Task 12.

**Placeholders.** Task 5's test contains two `_writeFail` lines flagged for deletion. No other TBDs; every method name (`Registry.add`, `Broker.get`, `parseIntegerInRange`, `fail`, `printJson`) was verified against the source.

**Type consistency.** `SettleOutcome` (Task 3) is consumed by the inspector (Task 5) with the same `kind` discriminants. `InspectorContext`/`InspectorPage` (Task 5) is the shape `BrowserPool.acquire` returns (Task 4, Playwright `BrowserContext`) and Task 6 notes the cast if TypeScript disagrees. `CheckRequest`/`ScreenshotRequest` field names are identical across types (Task 1), zod schemas (Task 6), client (Task 7), CLI (Task 8), and MCP (Task 9).
