import { describe, expect, it } from 'vitest';
import { nextCronFire } from './cron.ts';

/** Local-time date builder (schedules run in server-local time). */
function at(y: number, mo: number, d: number, h = 0, mi = 0, s = 0): Date {
  return new Date(y, mo - 1, d, h, mi, s);
}

describe('nextCronFire (server-local, subset grammar)', () => {
  it('every minute fires at the next minute boundary', () => {
    const next = nextCronFire('* * * * *', at(2026, 8, 13, 10, 15, 30));
    expect(next.getTime()).toBe(at(2026, 8, 13, 10, 16).getTime());
  });

  it('step minutes (*/15) fire on the next multiple', () => {
    const next = nextCronFire('*/15 * * * *', at(2026, 8, 13, 10, 16));
    expect([0, 15, 30, 45]).toContain(next.getMinutes());
    expect(next.getTime()).toBe(at(2026, 8, 13, 10, 30).getTime());
  });

  it('daily at 09:00 rolls to the next day when already past', () => {
    const next = nextCronFire('0 9 * * *', at(2026, 8, 13, 10, 0));
    expect(next.getTime()).toBe(at(2026, 8, 14, 9, 0).getTime());
  });

  it('day-of-month restriction rolls to the next month', () => {
    const next = nextCronFire('0 9 1 * *', at(2026, 8, 13, 10, 0));
    expect(next.getTime()).toBe(at(2026, 9, 1, 9, 0).getTime());
  });

  it('day-of-week restriction finds the next matching weekday (7 ≡ Sunday)', () => {
    const next = nextCronFire('0 9 * * 1', at(2026, 8, 13, 10, 0));
    expect(next.getDay()).toBe(1); // Monday
    expect(next.getHours()).toBe(9);
    expect(next.getTime()).toBeGreaterThan(at(2026, 8, 13, 10, 0).getTime());
    const sunday = nextCronFire('0 9 * * 7', at(2026, 8, 13, 10, 0));
    expect(sunday.getDay()).toBe(0);
  });

  it('restricted dom AND dow use standard OR semantics', () => {
    // "the 25th OR any Friday" — from the 13th, the next Friday comes
    // before the 25th.
    const next = nextCronFire('0 9 25 * 5', at(2026, 8, 13, 10, 0));
    const isFriday = next.getDay() === 5;
    const is25th = next.getDate() === 25;
    expect(isFriday || is25th).toBe(true);
    expect(next.getDate()).toBeLessThan(25); // the Friday won
  });

  it('ranges and lists compose', () => {
    const next = nextCronFire('0 9-17 * * 1-5', at(2026, 8, 15, 20, 0)); // Sat evening
    expect([1, 2, 3, 4, 5]).toContain(next.getDay());
    expect(next.getHours()).toBe(9);
  });

  it('throws on schedules that can never fire', () => {
    expect(() => nextCronFire('0 9 30 2 *', at(2026, 8, 13))).toThrow(/never fires/);
  });
});
