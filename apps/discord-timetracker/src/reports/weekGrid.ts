/**
 * Per-user workweek grid (MON–FRI) — the shared shape behind the weekly report.
 * The CLI text table, the Discord summary, and the TUI table all fold a
 * UserWeekRow through this so every surface shows identical numbers.
 *
 * Weekend activity stays in the data (perDay / activeMinutes / --json) but is not
 * part of the workweek grid.
 */
import type { UserWeekRow } from './types.js';

export const WEEKDAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI'] as const;

/** UTC weekday index of an ISO date (1=Mon … 7=Sun); a date's weekday is TZ-stable. */
function isoWeekday(date: string): number {
  const dow = new Date(`${date}T12:00:00Z`).getUTCDay(); // 0=Sun..6=Sat
  return dow === 0 ? 7 : dow;
}

/** Compact duration for grid cells: 150 → "2h30", 30 → "30m", 0 → "0". */
export function durShort(minutes: number): string {
  if (minutes <= 0) return '0';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h${m}`;
}

export interface WeekGrid {
  /** Mon–Fri, each `active|idle` (or "—" when there was no activity that day). */
  cells: string[];
  /** Workweek (Mon–Fri) active total, in minutes. */
  wkActiveMinutes: number;
  /** Active minutes ÷ weekdays actually worked; 0 when none. */
  avgActiveMinutes: number;
}

/** Fold a UserWeekRow's dense per-day series into the Mon–Fri grid. */
export function weekGrid(u: UserWeekRow): WeekGrid {
  const byWeekday = new Map(u.perDay.map((d) => [isoWeekday(d.date), d]));
  let wkActiveMinutes = 0;
  let activeDays = 0;
  const cells = [1, 2, 3, 4, 5].map((wd) => {
    const d = byWeekday.get(wd);
    const active = d?.activeMinutes ?? 0;
    const idle = d?.idleMinutes ?? 0;
    if (active > 0) {
      wkActiveMinutes += active;
      activeDays += 1;
    }
    return active === 0 && idle === 0 ? '—' : `${durShort(active)}|${durShort(idle)}`;
  });
  return {
    cells,
    wkActiveMinutes,
    avgActiveMinutes: activeDays > 0 ? Math.round(wkActiveMinutes / activeDays) : 0,
  };
}
