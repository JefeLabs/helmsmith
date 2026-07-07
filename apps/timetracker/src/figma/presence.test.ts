import { describe, expect, it } from 'vitest';
import { FilePresenceTracker } from './presence.js';

const at = (hhmm: string) => `2026-07-06T${hhmm}:00.000Z`;

describe('FilePresenceTracker', () => {
  it('opens an interval the first time a user appears', () => {
    const t = new FilePresenceTracker();
    expect(t.apply(['ana'], at('10:00'))).toEqual({ open: ['ana'], close: [] });
    // Still present → no new open.
    expect(t.apply(['ana'], at('10:01'))).toEqual({ open: [], close: [] });
    expect(t.openUsers()).toEqual(['ana']);
  });

  it('tolerates a single missed snapshot (poll jitter)', () => {
    const t = new FilePresenceTracker();
    t.apply(['ana'], at('10:00'));
    expect(t.apply([], at('10:01'))).toEqual({ open: [], close: [] }); // 1st miss: hold
    expect(t.apply(['ana'], at('10:02'))).toEqual({ open: [], close: [] }); // came back
    expect(t.openUsers()).toEqual(['ana']);
  });

  it('closes after two consecutive misses, at the LAST-SEEN ts', () => {
    const t = new FilePresenceTracker();
    t.apply(['ana'], at('10:00'));
    t.apply(['ana'], at('10:01'));
    t.apply([], at('10:02')); // miss 1
    const d = t.apply([], at('10:03')); // miss 2 → close
    expect(d.close).toEqual([{ userId: 'ana', at: at('10:01') }]);
    expect(t.openUsers()).toEqual([]);
  });

  it('handles interleaved users independently', () => {
    const t = new FilePresenceTracker();
    t.apply(['ana', 'marco'], at('10:00'));
    t.apply(['ana'], at('10:01')); // marco miss 1
    const d = t.apply(['ana'], at('10:02')); // marco miss 2 → close
    expect(d.close).toEqual([{ userId: 'marco', at: at('10:00') }]);
    expect(t.openUsers()).toEqual(['ana']);
  });

  it('a user can rejoin after closing (new interval)', () => {
    const t = new FilePresenceTracker();
    t.apply(['ana'], at('10:00'));
    t.apply([], at('10:01'));
    t.apply([], at('10:02')); // closed
    expect(t.apply(['ana'], at('10:10'))).toEqual({ open: ['ana'], close: [] });
  });

  it('reset() reports open users at last-seen ts and clears state', () => {
    const t = new FilePresenceTracker();
    t.apply(['ana', 'marco'], at('10:00'));
    t.apply(['ana'], at('10:01'));
    expect(t.reset()).toEqual([
      { userId: 'ana', at: at('10:01') },
      { userId: 'marco', at: at('10:00') },
    ]);
    expect(t.openUsers()).toEqual([]);
  });
});
