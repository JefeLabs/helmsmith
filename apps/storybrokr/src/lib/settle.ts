/**
 * How storybrokr decides a story has "settled". The recorder runs inside the preview iframe and
 * copies Storybook channel events into `window.__STORYBROKR__.events`; the reducer, in Node,
 * folds that list into pass / fail / pending. Keeping the reducer pure means the decision logic
 * is unit-tested without a browser.
 */

import type { WaitFor } from '../types.js';

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
 * Driver failures (navigation or evaluation errors, e.g. the page navigating away or its frame
 * being detached mid-poll) are reported as `fail` with event `driver` rather than thrown, so a
 * single story's transient driver error surfaces as a result row, not a request-level exception.
 */
export async function settleStory(page: SettlePage, opts: SettleOptions): Promise<SettleOutcome> {
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? defaultSleep;
  const pollMs = opts.pollMs ?? 100;
  const deadline = now() + opts.timeoutMs;
  const remaining = () => Math.max(1, deadline - now());
  let lastPhase: string | undefined;

  try {
    await page.goto(opts.iframeUrl);
  } catch (err) {
    return { kind: 'fail', reason: `driver error: ${(err as Error).message}`, event: 'driver' };
  }
  let state: SettleState = { kind: 'pending' };
  for (;;) {
    let events: SettleEvent[];
    try {
      events = (await page.evaluate(EVENTS_EXPRESSION)) as SettleEvent[];
    } catch (err) {
      return { kind: 'fail', reason: `driver error: ${(err as Error).message}`, event: 'driver' };
    }
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
