import { describe, expect, it } from 'vitest';
import { type DailyActivity, emptyDay } from '../domain/types.js';
import { dueEndOfDay, dueReports, type EndOfDayConfig, type ScheduleConfig } from './scheduler.js';

const CFG: ScheduleConfig = {
  timezone: 'UTC',
  weekStartsOn: 'monday',
  dailyAt: '09:00',
  figmaSummary: false,
};
// 2026-06-08 is a Monday (week start). 2026-06-10 is a Wednesday. 2026-06-13 is a Saturday.

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

  describe('figma summary', () => {
    const FIG: ScheduleConfig = { ...CFG, figmaSummary: true };

    it('posts yesterday once, at/after dailyAt, when enabled', () => {
      const r = dueReports(new Date('2026-06-10T09:00:00Z'), FIG, {});
      expect(r.figma).toBe('2026-06-09');
      expect(r.state.lastFigmaRunDay).toBe('2026-06-10');
    });

    it('is absent before the daily time and when disabled', () => {
      expect(dueReports(new Date('2026-06-10T08:59:00Z'), FIG, {}).figma).toBeUndefined();
      expect(dueReports(new Date('2026-06-10T09:00:00Z'), CFG, {}).figma).toBeUndefined();
    });

    it('does not repost the same day, and tracks its own last-run', () => {
      const r = dueReports(new Date('2026-06-10T12:00:00Z'), FIG, { lastFigmaRunDay: '2026-06-10' });
      expect(r.figma).toBeUndefined();
    });

    it('is independent of the daily last-run (a figma-only failure recovers)', () => {
      // daily already went out today, but figma hasn't → figma still fires.
      const r = dueReports(new Date('2026-06-10T10:00:00Z'), FIG, { lastDailyRunDay: '2026-06-10' });
      expect(r.daily).toBeUndefined();
      expect(r.figma).toBe('2026-06-09');
    });
  });
});

const EOD: EndOfDayConfig = {
  enabled: true,
  mode: 'completion',
  at: '18:00',
  deadlineAt: '22:00',
  weekdaysOnly: true,
  timezone: 'UTC',
};
const TRACKED = ['U1', 'U2'];
const withEnd = (userId: string, date = '2026-06-10'): DailyActivity => {
  const a = emptyDay(userId, date, `${date}T00:00:00Z`);
  a.endOfDay = { at: `${date}T20:00:00Z`, messageId: 'm', summary: 's' };
  return a;
};
const noEnd = (userId: string, date = '2026-06-10') => emptyDay(userId, date, `${date}T00:00:00Z`);

describe('dueEndOfDay — completion mode', () => {
  it('publishes once every tracked user has end-of-day, before the deadline', () => {
    const r = dueEndOfDay(new Date('2026-06-10T18:30:00Z'), EOD, TRACKED, [withEnd('U1'), withEnd('U2')], {});
    expect(r.publish).toBe('2026-06-10');
    expect(r.state.lastEodPublishDay).toBe('2026-06-10');
  });

  it('waits while someone is still missing and the deadline has not passed', () => {
    const r = dueEndOfDay(new Date('2026-06-10T18:30:00Z'), EOD, TRACKED, [withEnd('U1'), noEnd('U2')], {});
    expect(r.publish).toBeUndefined();
  });

  it('publishes at the deadline even if not everyone is done', () => {
    const r = dueEndOfDay(new Date('2026-06-10T22:00:00Z'), EOD, TRACKED, [withEnd('U1'), noEnd('U2')], {});
    expect(r.publish).toBe('2026-06-10');
  });

  it('does not republish the same day', () => {
    const r = dueEndOfDay(new Date('2026-06-10T19:00:00Z'), EOD, TRACKED, [withEnd('U1'), withEnd('U2')], {
      lastEodPublishDay: '2026-06-10',
    });
    expect(r.publish).toBeUndefined();
  });

  it('skips weekends when weekdaysOnly', () => {
    const rows = [withEnd('U1', '2026-06-13'), withEnd('U2', '2026-06-13')]; // Saturday
    expect(dueEndOfDay(new Date('2026-06-13T19:00:00Z'), EOD, TRACKED, rows, {}).publish).toBeUndefined();
  });

  it('is a no-op when disabled', () => {
    expect(
      dueEndOfDay(new Date('2026-06-10T23:00:00Z'), { ...EOD, enabled: false }, TRACKED, [], {}).publish,
    ).toBeUndefined();
  });
});

describe('dueEndOfDay — fixed mode', () => {
  const FIXED: EndOfDayConfig = { ...EOD, mode: 'fixed', at: '18:00' };
  it('does not publish before the fixed time', () => {
    expect(dueEndOfDay(new Date('2026-06-10T17:59:00Z'), FIXED, TRACKED, [], {}).publish).toBeUndefined();
  });
  it('publishes at/after the fixed time, regardless of completion', () => {
    expect(dueEndOfDay(new Date('2026-06-10T18:00:00Z'), FIXED, TRACKED, [], {}).publish).toBe('2026-06-10');
  });
});
