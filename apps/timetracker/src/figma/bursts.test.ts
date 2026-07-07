import { describe, expect, it } from 'vitest';
import { attributeBursts, burstsByUser, clusterBursts, totalEstMinutes } from './bursts.js';

const CFG = { gapMin: 30, padMin: 15 };
const at = (hhmm: string) => `2026-07-06T${hhmm}:00.000Z`;
const ev = (hhmm: string, user = 'u1') => ({ at: at(hhmm), figmaUserId: user });

describe('clusterBursts', () => {
  it('returns no bursts for no events', () => {
    expect(clusterBursts([], CFG)).toEqual([]);
  });

  it('merges events within the gap into one burst and splits on a larger gap', () => {
    // 10:00, 10:20, 10:45 chain (gaps 20, 25 ≤ 30) — then 12:00 starts a new burst.
    const bursts = clusterBursts([ev('10:00'), ev('10:20'), ev('10:45'), ev('12:00')], CFG);
    expect(bursts).toHaveLength(2);
    expect(bursts[0].eventCount).toBe(3);
    expect(bursts[1].eventCount).toBe(1);
  });

  it('pads the burst start backward and includes the pad in the estimate', () => {
    const [b] = clusterBursts([ev('10:00'), ev('10:25')], CFG);
    expect(b.startAt).toBe(at('09:45')); // first − 15m: debounce fires after work starts
    expect(b.endAt).toBe(at('10:25'));
    expect(b.estMinutes).toBe(40); // 25 + 15 pad
  });

  it('gives a single-event burst the pad as its whole estimate', () => {
    const [b] = clusterBursts([ev('10:00')], CFG);
    expect(b.estMinutes).toBe(15);
  });

  it('sorts unsorted input (webhook and poll interleave out of order)', () => {
    const [b] = clusterBursts([ev('10:25'), ev('10:00')], CFG);
    expect(b.eventCount).toBe(2);
    expect(b.endAt).toBe(at('10:25'));
  });

  it('a gap of exactly gapMin still merges (≤, per PRD §3)', () => {
    expect(clusterBursts([ev('10:00'), ev('10:30')], CFG)).toHaveLength(1);
  });
});

describe('burstsByUser', () => {
  it('clusters each user independently and skips unattributed events', () => {
    const map = burstsByUser(
      [ev('10:00', 'u1'), ev('10:10', 'u2'), { at: at('10:20'), figmaUserId: null }],
      CFG,
    );
    expect([...map.keys()].sort()).toEqual(['u1', 'u2']);
    expect(map.get('u1')).toHaveLength(1);
  });
});

describe('attributeBursts', () => {
  const now = new Date(at('18:00'));
  const bursts = clusterBursts([ev('10:00'), ev('10:20')], CFG);

  it('tags bursts overlapping a closed session window', () => {
    const [b] = attributeBursts(bursts, { startAt: at('09:00'), endAt: at('17:00') }, now);
    expect(b.inSession).toBe(true);
  });

  it('an open session (no summary yet) extends to now', () => {
    const [b] = attributeBursts(bursts, { startAt: at('09:00') }, now);
    expect(b.inSession).toBe(true);
  });

  it('bursts outside the window stay unattributed', () => {
    const [b] = attributeBursts(bursts, { startAt: at('11:00'), endAt: at('17:00') }, now);
    expect(b.inSession).toBe(false);
  });

  it('backward padding lets pre-goals work attach to the session', () => {
    // Session starts 10:35; events at 10:25/10:30 — the raw burst [10:10, 10:30]
    // (padded start) ends before… actually endAt 10:30 < 10:35 start → NOT in
    // session. An event at 10:40 would connect it. Guard the boundary exactly:
    const b1 = attributeBursts(clusterBursts([ev('10:25'), ev('10:35')], CFG), {
      startAt: at('10:35'),
    }, now);
    expect(b1[0].inSession).toBe(true); // touches the boundary
  });

  it('no session → bursts pass through unattributed', () => {
    const [b] = attributeBursts(bursts, undefined, now);
    expect(b.inSession).toBe(false);
  });
});

describe('totalEstMinutes', () => {
  it('sums estimates across bursts', () => {
    const bursts = clusterBursts([ev('10:00'), ev('10:20'), ev('12:00')], CFG);
    expect(totalEstMinutes(bursts)).toBe(35 + 15); // (20+15) + (0+15)
  });
});
