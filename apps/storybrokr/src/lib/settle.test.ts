import { describe, expect, it } from 'vitest';
import {
  EVENTS_EXPRESSION,
  RECORDER_SCRIPT,
  reduceSettle,
  type SettleEvent,
  type SettlePage,
  settleStory,
} from './settle.js';

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
    expect(reduceSettle([phase('aborted')])).toMatchObject({
      kind: 'fail',
      reason: 'story render aborted',
    });
  });

  it('surfaces the exception message when Storybook emits the errored phase before the exception event (Storybook 10.6 order)', () => {
    const events: SettleEvent[] = [
      phase('playing'),
      phase('errored'),
      {
        kind: 'error',
        event: 'playFunctionThrewException',
        message: 'expected heading to have text',
        stack: 's',
      },
    ];
    expect(reduceSettle(events)).toEqual({
      kind: 'fail',
      reason: 'expected heading to have text',
      event: 'playFunctionThrewException',
      stack: 's',
    });
  });

  it('an exception event after completed still fails the story', () => {
    const events: SettleEvent[] = [
      phase('rendering'),
      phase('completed'),
      { kind: 'error', event: 'unhandledErrorsWhilePlaying', message: 'late boom' },
    ];
    expect(reduceSettle(events)).toEqual({
      kind: 'fail',
      reason: 'late boom',
      event: 'unhandledErrorsWhilePlaying',
    });
  });

  it('treats storyMissing as a failure', () => {
    expect(
      reduceSettle([
        { kind: 'error', event: 'storyMissing', message: 'story x is not in this preview' },
      ]),
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

/** A scripted page: each evaluate() call returns the next events snapshot. */
function fakePage(
  snapshots: SettleEvent[][],
  opts: {
    networkIdleRejects?: boolean;
    waitForFails?: boolean;
    gotoRejects?: Error;
    evaluateRejectsAt?: number;
  } = {},
) {
  const calls: string[] = [];
  let i = 0;
  const page: SettlePage = {
    goto: async (url) => {
      calls.push(`goto ${url}`);
      if (opts.gotoRejects) throw opts.gotoRejects;
    },
    evaluate: async () => {
      const at = i++;
      if (opts.evaluateRejectsAt !== undefined && at === opts.evaluateRejectsAt) {
        throw new Error('Execution context was destroyed');
      }
      return snapshots[Math.min(at, snapshots.length - 1)] ?? [];
    },
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
    const { page, calls } = fakePage([
      [],
      [phase('rendering')],
      [phase('rendering'), phase('completed')],
    ]);
    const out = await settleStory(page, {
      iframeUrl: 'http://x/iframe.html?id=a',
      timeoutMs: 5000,
      ...fast,
    });
    expect(out).toEqual({ kind: 'pass', played: false });
    expect(calls).toEqual(['goto http://x/iframe.html?id=a', 'load networkidle']);
  });

  it('honours waitFor text and selector after the render completes', async () => {
    const a = fakePage([[phase('completed')]]);
    await settleStory(a.page, {
      iframeUrl: 'u',
      timeoutMs: 5000,
      waitFor: { text: 'Go' },
      ...fast,
    });
    expect(a.calls).toContain('text Go');
    const b = fakePage([[phase('completed')]]);
    await settleStory(b.page, {
      iframeUrl: 'u',
      timeoutMs: 5000,
      waitFor: { selector: 'h2' },
      ...fast,
    });
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
      await settleStory(b.page, {
        iframeUrl: 'u',
        timeoutMs: 5000,
        waitFor: { text: 'never' },
        ...fast,
      }),
    ).toEqual({ kind: 'timeout', lastPhase: 'completed' });
  });

  it('reports a goto rejection as a driver failure instead of throwing', async () => {
    const { page } = fakePage([[]], { gotoRejects: new Error('net::ERR_CONNECTION_REFUSED') });
    const out = await settleStory(page, { iframeUrl: 'u', timeoutMs: 5000, ...fast });
    expect(out).toEqual({
      kind: 'fail',
      reason: 'driver error: net::ERR_CONNECTION_REFUSED',
      event: 'driver',
    });
  });

  it('reports an evaluate rejection mid-poll as a driver failure instead of throwing', async () => {
    const { page } = fakePage([[phase('loading')], [phase('rendering')]], { evaluateRejectsAt: 1 });
    const out = await settleStory(page, { iframeUrl: 'u', timeoutMs: 5000, ...fast });
    expect(out).toMatchObject({
      kind: 'fail',
      event: 'driver',
      reason: 'driver error: Execution context was destroyed',
    });
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
