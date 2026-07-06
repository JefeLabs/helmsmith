/**
 * Timezone-aware date bucketing. Everything that decides "which day did this
 * happen on" goes through here so the answer is consistent across the bot,
 * the presence poller, and the reports.
 */
import type { ISODate } from './types.js';

/**
 * The local calendar day (`YYYY-MM-DD`) for an instant, in the given IANA
 * timezone. Uses Intl rather than offset math so DST transitions are handled
 * by the platform, not by us.
 *
 * `en-CA` formats dates as `YYYY-MM-DD`, which is exactly our ISODate shape.
 */
export function dayKeyFor(instant: Date, timeZone: string): ISODate {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

/** Today's day key in the configured timezone. */
export function todayKey(timeZone: string): ISODate {
  return dayKeyFor(new Date(), timeZone);
}

/** True if `tz` is a timezone the runtime's Intl actually supports. */
export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Shift an `ISODate` by whole days (calendar arithmetic, tz-independent — a
 * day key is already a local date, so we add days in UTC to avoid any tz
 * drift). Negative `n` goes backwards. `addDays('2026-03-08', 1)` → '2026-03-09'.
 */
export function addDays(date: ISODate, n: number): ISODate {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Day of week for an `ISODate`: 0 = Sunday … 6 = Saturday. */
export function weekdayOf(date: ISODate): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

export type WeekStart = 'monday' | 'sunday';

/** Inclusive `[from, to]` range of `ISODate`s. */
export interface DateRange {
  from: ISODate;
  to: ISODate;
}

/**
 * The 7-day calendar week that contains `anchor`, honouring whether weeks
 * start Monday or Sunday. Returns the inclusive `{ from, to }` day-key range
 * the weekly report aggregates over.
 *
 * ── M1 design decision (your call) ──────────────────────────────────────
 * This is a genuine product choice, not boilerplate: teams disagree on
 * whether "this week" means the calendar week (Mon–Sun / Sun–Sat) or a
 * rolling last-7-days. The weekly TUI/report (M5/M6) renders whatever this
 * returns, so the shape of a "week" is decided right here.
 *
 * Helpers are ready: `weekdayOf(anchor)` gives 0=Sun..6=Sat, and
 * `addDays(date, n)` shifts a day key. Implement ~5–8 lines:
 *   1. Figure out how many days back the week's start is, given
 *      `weekStartsOn` (remember weekdayOf is Sun-based).
 *   2. `from = addDays(anchor, -daysBack)`.
 *   3. `to = addDays(from, 6)`.
 *
 * Examples to satisfy (see dayKey.test.ts) — 2026-06-10 is a Wednesday:
 *   weekWindow('2026-06-10', 'monday') -> { from:'2026-06-08', to:'2026-06-14' }
 *   weekWindow('2026-06-10', 'sunday') -> { from:'2026-06-07', to:'2026-06-13' }
 *
 * Tell me to fill it in if you'd rather not — it's the only deferred piece
 * of M1; nothing before M5 depends on it.
 */
export function weekWindow(anchor: ISODate, weekStartsOn: WeekStart): DateRange {
  const weekday = weekdayOf(anchor); // 0=Sun..6=Sat
  // Days from the week's start to the anchor. Monday-start shifts the Sun-based
  // index so Monday=0..Sunday=6; Sunday-start uses the index directly.
  const daysBack = weekStartsOn === 'monday' ? (weekday + 6) % 7 : weekday;
  const from = addDays(anchor, -daysBack);
  return { from, to: addDays(from, 6) };
}
