import { describe, expect, it } from 'vitest';
import type { UserWeekRow } from './types.js';
import { weekGrid } from './weekGrid.js';

const day = (date: string, activeMinutes: number, idleMinutes: number) => ({
  date,
  onlineMinutes: activeMinutes + idleMinutes,
  activeMinutes,
  idleMinutes,
});

/** Mon 06-08 … Sun 06-14, with a Saturday entry to prove weekends are excluded. */
const row = (): UserWeekRow => ({
  userId: 'u',
  onlineMinutes: 0,
  activeMinutes: 0,
  voiceMinutes: 0,
  ciSubmissions: 0,
  engagementMessages: 0,
  daysActive: 4,
  perDay: [
    day('2026-06-08', 150, 0), // Mon → 2h30 active
    day('2026-06-09', 60, 30), // Tue → 1h active, 30m idle
    day('2026-06-10', 0, 0), // Wed → off
    day('2026-06-11', 120, 0), // Thu → 2h active
    day('2026-06-12', 0, 0), // Fri → off
    day('2026-06-13', 45, 0), // Sat → excluded from the workweek grid
    day('2026-06-14', 0, 0), // Sun
  ],
});

describe('weekGrid', () => {
  it('folds Mon–Fri into active|idle cells with workweek totals', () => {
    const g = weekGrid(row());
    expect(g.cells).toEqual(['2h30|0', '1h|30m', '—', '2h|0', '—']);
    expect(g.wkActiveMinutes).toBe(330); // 150 + 60 + 120; Sat 45 excluded
    expect(g.avgActiveMinutes).toBe(110); // 330 ÷ 3 active weekdays
  });

  it('memoizes per row identity (WeakMap)', () => {
    const r = row();
    expect(weekGrid(r)).toBe(weekGrid(r)); // same row object → cached result
    expect(weekGrid(row())).not.toBe(weekGrid(r)); // different row → recomputed
  });
});
