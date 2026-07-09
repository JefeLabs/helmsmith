import { describe, expect, it } from 'vitest';
import { resolveBackfillSince } from './replay.js';

const TZ = 'America/New_York';
const TODAY = '2026-07-09';

describe('resolveBackfillSince', () => {
  it('replays today only when no heartbeat was ever written (first run)', () => {
    expect(resolveBackfillSince(null, TODAY, 7, TZ)).toBe('2026-07-09');
  });

  it('stays on today when the heartbeat is from earlier the same local day', () => {
    // 2026-07-09 09:00 EDT
    expect(resolveBackfillSince('2026-07-09T13:00:00Z', TODAY, 7, TZ)).toBe('2026-07-09');
  });

  it('reaches back to the day the bot went dark across midnight', () => {
    // Died 2026-07-08 20:15 EDT — that evening's #summary posts need recovery.
    expect(resolveBackfillSince('2026-07-09T00:15:00Z', TODAY, 7, TZ)).toBe('2026-07-08');
  });

  it('uses the LOCAL day of the heartbeat, not the UTC day', () => {
    // 2026-07-09T02:00Z is still 2026-07-08 22:00 in New York.
    expect(resolveBackfillSince('2026-07-09T02:00:00Z', TODAY, 7, TZ)).toBe('2026-07-08');
  });

  it('clamps a long outage to maxDays (today inclusive)', () => {
    // Dark since June 1st; maxDays 7 → floor is today-6.
    expect(resolveBackfillSince('2026-06-01T12:00:00Z', TODAY, 7, TZ)).toBe('2026-07-03');
  });

  it('never returns a future day on clock skew', () => {
    expect(resolveBackfillSince('2026-07-10T12:00:00Z', TODAY, 7, TZ)).toBe('2026-07-09');
  });
});
