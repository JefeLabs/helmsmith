import { describe, expect, it } from 'vitest';
import { dailyColumns, pageDate, sparkline, weeklyColumns } from './model.js';

describe('pageDate', () => {
  it('pages ±1 day in daily mode', () => {
    expect(pageDate('2026-06-10', 1, 'daily')).toBe('2026-06-11');
    expect(pageDate('2026-06-10', -1, 'daily')).toBe('2026-06-09');
  });
  it('pages ±7 days in weekly mode', () => {
    expect(pageDate('2026-06-10', 1, 'weekly')).toBe('2026-06-17');
    expect(pageDate('2026-06-10', -1, 'weekly')).toBe('2026-06-03');
  });
});

describe('sparkline', () => {
  it('maps a series into block glyphs, scaled to the max', () => {
    const s = sparkline([0, 30, 60, 120]);
    expect(s).toHaveLength(4);
    expect(s[0]).toBe(' '); // zero → blank
    expect(s[3]).toBe('█'); // max → full block
  });
  it('handles an all-zero series without dividing by zero', () => {
    expect(sparkline([0, 0, 0])).toBe('   ');
  });
  it('returns empty for an empty series', () => {
    expect(sparkline([])).toBe('');
  });
});

describe('column definitions', () => {
  it('daily has the expected columns and renders durations/times', () => {
    const cols = dailyColumns('UTC');
    expect(cols.map((c) => c.key)).toEqual([
      'userId',
      'online',
      'voice',
      'ci',
      'msgs',
      'start',
      'end',
    ]);
    const online = cols.find((c) => c.key === 'online');
    expect(
      online?.render?.(
        {
          userId: 'u',
          onlineMinutes: 90,
          voiceMinutes: 0,
          ciSubmissions: 0,
          engagementMessages: 0,
        },
        0,
      ),
    ).toBe('1h 30m');
  });
  it('weekly has a trend sparkline column', () => {
    const cols = weeklyColumns();
    expect(cols.map((c) => c.key)).toContain('trend');
  });
});
