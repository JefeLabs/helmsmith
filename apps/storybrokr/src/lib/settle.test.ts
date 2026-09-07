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
