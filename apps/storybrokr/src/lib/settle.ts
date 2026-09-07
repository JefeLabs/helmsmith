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
