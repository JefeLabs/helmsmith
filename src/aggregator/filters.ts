import type { UserWeekRepoRecord } from "../types/schema.js";
import type { RolledUp } from "./engine.js";

export interface Filters {
  weeks?: string[];
  org?: string;
  team?: string;
  tag?: string;
  group?: string;
  member?: string;
}

export interface Delta {
  value: number;
  prev: number;
  pctChange: number | null;
  direction: "up" | "down" | "flat";
}

/**
 * Apply all non-undefined filters with AND logic.
 */
export function filterRecords(
  records: UserWeekRepoRecord[],
  filters: Filters,
): UserWeekRepoRecord[] {
  return records.filter((r) => {
    if (filters.weeks && !filters.weeks.includes(r.week)) return false;
    if (filters.org !== undefined && r.org !== filters.org) return false;
    if (filters.team !== undefined && r.team !== filters.team) return false;
    if (filters.tag !== undefined && r.tag !== filters.tag) return false;
    if (filters.group !== undefined && r.group !== filters.group) return false;
    if (filters.member !== undefined && r.member !== filters.member) return false;
    return true;
  });
}

/**
 * Return the current ISO week in "YYYY-Www" format.
 */
export function getCurrentWeek(): string {
  return dateToISOWeek(new Date());
}

/**
 * Return the last N ISO weeks counting backwards from `fromWeek` (or current week).
 * The result is ordered oldest-first.
 */
export function getLastNWeeks(n: number, fromWeek?: string): string[] {
  let refDate: Date;

  if (fromWeek) {
    refDate = isoWeekToMonday(fromWeek);
  } else {
    refDate = isoWeekToMonday(getCurrentWeek());
  }

  const weeks: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(refDate);
    d.setDate(d.getDate() - i * 7);
    weeks.push(dateToISOWeek(d));
  }

  return weeks;
}

/**
 * Compute deltas between a current and previous RolledUp.
 * Returns a Record keyed by metric name.
 */
export function computeDeltas(
  current: RolledUp,
  previous: RolledUp,
): Record<string, Delta> {
  const metrics: Array<[string, number, number]> = [
    ["commits", current.commits, previous.commits],
    ["insertions", current.insertions, previous.insertions],
    ["deletions", current.deletions, previous.deletions],
    ["netLines", current.netLines, previous.netLines],
    ["filesChanged", current.filesChanged, previous.filesChanged],
    ["activeDays", current.activeDays, previous.activeDays],
    ["activeMembers", current.activeMembers, previous.activeMembers],
  ];

  const result: Record<string, Delta> = {};

  for (const [name, value, prev] of metrics) {
    let pctChange: number | null;
    let direction: "up" | "down" | "flat";

    if (prev === 0) {
      pctChange = null;
      direction = value > 0 ? "up" : value < 0 ? "down" : "flat";
    } else {
      pctChange = Math.round(((value - prev) / Math.abs(prev)) * 100);
      direction = pctChange > 0 ? "up" : pctChange < 0 ? "down" : "flat";
    }

    result[name] = { value, prev, pctChange, direction };
  }

  return result;
}

/**
 * Return the last N month strings (e.g., "2026-02") ending at the month
 * containing `fromWeek` (or current week). Oldest-first.
 */
export function getLastNMonths(n: number, fromWeek?: string): string[] {
  const refDate = fromWeek ? isoWeekToMonday(fromWeek) : new Date();
  const months: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(refDate.getFullYear(), refDate.getMonth() - i, 1));
    months.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return months;
}

/**
 * Return the month string ("YYYY-MM") for a given ISO week,
 * based on the Monday of that week.
 */
export function weekToMonth(isoWeek: string): string {
  const monday = isoWeekToMonday(isoWeek);
  return `${monday.getUTCFullYear()}-${String(monday.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Format a month string "YYYY-MM" into a short label like "Feb '26".
 */
export function monthShort(month: string): string {
  const [yearStr, monthStr] = month.split('-');
  const names = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const mi = parseInt(monthStr, 10) - 1;
  return `${names[mi]} '${yearStr.slice(2)}`;
}

/**
 * Return the last N quarter strings (e.g., "2026-Q1") ending at the quarter
 * containing `fromWeek` (or current week). Oldest-first.
 */
export function getLastNQuarters(n: number, fromWeek?: string): string[] {
  const refDate = fromWeek ? isoWeekToMonday(fromWeek) : new Date();
  const refQ = Math.floor(refDate.getMonth() / 3); // 0-based
  const refYear = refDate.getFullYear();
  const quarters: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    let q = refQ - i;
    let y = refYear;
    while (q < 0) { q += 4; y--; }
    quarters.push(`${y}-Q${q + 1}`);
  }
  return quarters;
}

/**
 * Return the last N year strings (e.g., "2026") ending at the year
 * containing `fromWeek` (or current week). Oldest-first.
 */
export function getLastNYears(n: number, fromWeek?: string): string[] {
  const refDate = fromWeek ? isoWeekToMonday(fromWeek) : new Date();
  const refYear = refDate.getFullYear();
  const years: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    years.push(String(refYear - i));
  }
  return years;
}

/**
 * Return the quarter string ("YYYY-Qn") for a given ISO week,
 * based on the Monday of that week.
 */
export function weekToQuarter(isoWeek: string): string {
  const monday = isoWeekToMonday(isoWeek);
  const q = Math.floor(monday.getUTCMonth() / 3) + 1;
  return `${monday.getUTCFullYear()}-Q${q}`;
}

/**
 * Return the year string ("YYYY") for a given ISO week,
 * based on the Monday of that week.
 */
export function weekToYear(isoWeek: string): string {
  const monday = isoWeekToMonday(isoWeek);
  return String(monday.getUTCFullYear());
}

/**
 * Convert an ISO week string "YYYY-Www" to a date range (Monday to Sunday)
 * suitable for API queries. Returns ISO date strings "YYYY-MM-DD".
 */
export function isoWeekToDateRange(isoWeek: string): { since: string; until: string } {
  const monday = isoWeekToMonday(isoWeek);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return {
    since: monday.toISOString().slice(0, 10),
    until: sunday.toISOString().slice(0, 10),
  };
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Convert a Date to an ISO week string "YYYY-Www".
 */
function dateToISOWeek(date: Date): string {
  // Copy date so we don't mutate the original
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));

  // Set to nearest Thursday: current date + 4 - current day number
  // Make Sunday (0) into 7
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);

  // Get first day of year
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));

  // Calculate full weeks to nearest Thursday
  const weekNo = Math.ceil(
    ((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7,
  );

  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

/**
 * Convert an ISO week string "YYYY-Www" to the Monday of that week.
 */
function isoWeekToMonday(isoWeek: string): Date {
  const match = isoWeek.match(/^(\d{4})-W(\d{2})$/);
  if (!match) {
    throw new Error(`Invalid ISO week format: ${isoWeek}`);
  }

  const year = parseInt(match[1], 10);
  const week = parseInt(match[2], 10);

  // Jan 4 is always in ISO week 1
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const dayOfWeek = jan4.getUTCDay() || 7; // Sunday=0 -> 7

  // Monday of ISO week 1
  const mondayW1 = new Date(jan4);
  mondayW1.setUTCDate(jan4.getUTCDate() - (dayOfWeek - 1));

  // Monday of the target week
  const monday = new Date(mondayW1);
  monday.setUTCDate(mondayW1.getUTCDate() + (week - 1) * 7);

  return monday;
}
