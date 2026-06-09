import { describe, expect, it } from 'vitest';
import { dueReports, type ScheduleConfig } from './scheduler.js';

const CFG: ScheduleConfig = { timezone: 'UTC', weekStartsOn: 'monday', dailyAt: '09:00' };
// 2026-06-08 is a Monday (week start). 2026-06-10 is a Wednesday.

describe('dueReports', () => {
  it('posts nothing before the daily time', () => {
    const r = dueReports(new Date('2026-06-10T08:59:00Z'), CFG, {});
    expect(r.daily).toBeUndefined();
    expect(r.weekly).toBeUndefined();
  });

  it('posts the previous day once the time is reached', () => {
    const r = dueReports(new Date('2026-06-10T09:00:00Z'), CFG, {});
    expect(r.daily).toBe('2026-06-09'); // yesterday
    expect(r.weekly).toBeUndefined(); // Wed is not the week start
    expect(r.state.lastDailyRunDay).toBe('2026-06-10');
  });

  it('does not repost the daily on a later tick the same day', () => {
    const state = { lastDailyRunDay: '2026-06-10' };
    const r = dueReports(new Date('2026-06-10T12:00:00Z'), CFG, state);
    expect(r.daily).toBeUndefined();
  });

  it('on the week-start day, also posts the previous week', () => {
    // Monday 2026-06-08 → weekly anchor is yesterday (Sun 06-07, last week)
    const r = dueReports(new Date('2026-06-08T09:30:00Z'), CFG, {});
    expect(r.daily).toBe('2026-06-07');
    expect(r.weekly).toBe('2026-06-07');
    expect(r.state.lastWeeklyRunWeek).toBe('2026-06-08');
  });

  it('does not repost the weekly later in the same week', () => {
    const state = { lastDailyRunDay: '2026-06-08', lastWeeklyRunWeek: '2026-06-08' };
    const r = dueReports(new Date('2026-06-08T18:00:00Z'), CFG, state);
    expect(r.daily).toBeUndefined();
    expect(r.weekly).toBeUndefined();
  });

  it('respects the configured timezone (same instant, different decision)', () => {
    const instant = new Date('2026-06-10T12:00:00Z'); // 12:00 UTC = 08:00 EDT
    const ny: ScheduleConfig = { ...CFG, timezone: 'America/New_York' };
    expect(dueReports(instant, ny, {}).daily).toBeUndefined(); // 08:00 NY < 09:00
    expect(dueReports(instant, CFG, {}).daily).toBe('2026-06-09'); // 12:00 UTC ≥ 09:00
  });
});
