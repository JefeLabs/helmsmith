import { describe, expect, it } from 'vitest';
import { addDays, dayKeyFor, isValidTimeZone, weekdayOf, weekWindow } from './dayKey.js';

describe('dayKeyFor', () => {
  it('buckets a late-night instant into the correct LOCAL day', () => {
    // 2026-06-09T03:30:00Z = 2026-06-08 23:30 in New York (EDT, UTC-4)
    const instant = new Date('2026-06-09T03:30:00Z');
    expect(dayKeyFor(instant, 'America/New_York')).toBe('2026-06-08');
    expect(dayKeyFor(instant, 'UTC')).toBe('2026-06-09');
  });

  it('buckets a 2am-local instant into that local day', () => {
    // 2026-06-09T06:00:00Z = 2026-06-09 02:00 EDT
    expect(dayKeyFor(new Date('2026-06-09T06:00:00Z'), 'America/New_York')).toBe('2026-06-09');
  });

  it('respects DST: same wall-clock day either side of the spring-forward', () => {
    // US DST began 2026-03-08. 08:00Z = 03:00 EST-becoming-EDT day.
    expect(dayKeyFor(new Date('2026-03-08T08:00:00Z'), 'America/New_York')).toBe('2026-03-08');
  });
});

describe('isValidTimeZone', () => {
  it('accepts real zones and rejects junk', () => {
    expect(isValidTimeZone('America/New_York')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('Mars/Phobos')).toBe(false);
  });
});

describe('addDays / weekdayOf', () => {
  it('adds across a month boundary', () => {
    expect(addDays('2026-06-30', 1)).toBe('2026-07-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });
  it('reports weekday with 0=Sunday', () => {
    expect(weekdayOf('2026-06-07')).toBe(0); // Sunday
    expect(weekdayOf('2026-06-10')).toBe(3); // Wednesday
  });
});

describe('weekWindow', () => {
  it('Monday-start week containing a Wednesday', () => {
    expect(weekWindow('2026-06-10', 'monday')).toEqual({ from: '2026-06-08', to: '2026-06-14' });
  });
  it('Sunday-start week containing a Wednesday', () => {
    expect(weekWindow('2026-06-10', 'sunday')).toEqual({ from: '2026-06-07', to: '2026-06-13' });
  });
  it('anchor on the week-start day returns that day as `from`', () => {
    expect(weekWindow('2026-06-08', 'monday').from).toBe('2026-06-08'); // Mon
    expect(weekWindow('2026-06-07', 'sunday').from).toBe('2026-06-07'); // Sun
  });
  it('anchor on the last day of the week returns it as `to`', () => {
    expect(weekWindow('2026-06-14', 'monday').to).toBe('2026-06-14'); // Sun
    expect(weekWindow('2026-06-13', 'sunday').to).toBe('2026-06-13'); // Sat
  });
});
