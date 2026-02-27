import type { UserWeekRepoRecord } from "../types/schema.js";
import { weekLabel } from "../ui/format.js";
import { rollup } from "./engine.js";
import { filterRecords, type Filters } from "./filters.js";

export interface TrendPoint {
  week: string;
  weekLabel: string;
  commits: number;
  insertions: number;
  deletions: number;
  netLines: number;
  app: number;
  test: number;
  config: number;
  storybook: number;
  testRatio: number;
}

/**
 * Compute weekly trend data from records, optionally filtered.
 * Groups by week, sums metrics, and computes testRatio = test / (app + test).
 * Returns points sorted by week (oldest first).
 */
export function computeTrend(
  records: UserWeekRepoRecord[],
  filters?: Filters,
): TrendPoint[] {
  const filtered = filters ? filterRecords(records, filters) : records;

  const byWeek = rollup(filtered, (r) => r.week);

  const points: TrendPoint[] = [];

  for (const [week, agg] of byWeek) {
    const app =
      agg.filetype.app.insertions + agg.filetype.app.deletions;
    const test =
      agg.filetype.test.insertions + agg.filetype.test.deletions;
    const config =
      agg.filetype.config.insertions + agg.filetype.config.deletions;
    const storybook =
      agg.filetype.storybook.insertions + agg.filetype.storybook.deletions;

    const denominator = app + test;
    const testRatio = denominator === 0 ? 0 : test / denominator;

    points.push({
      week,
      weekLabel: weekLabel(week),
      commits: agg.commits,
      insertions: agg.insertions,
      deletions: agg.deletions,
      netLines: agg.netLines,
      app,
      test,
      config,
      storybook,
      testRatio,
    });
  }

  // Sort by week string (ISO week format sorts lexicographically)
  points.sort((a, b) => a.week.localeCompare(b.week));

  return points;
}

/**
 * Compute the running average lines changed per person per week for a given team.
 *
 * Formula: totalLines / headcount / weeksActive
 * where:
 *   - totalLines = sum of all insertions + deletions across the window
 *   - headcount = number of unique members active in the window
 *   - weeksActive = number of distinct weeks with activity in the window
 *
 * Returns 0 if there are no records or no active weeks/members.
 */
export function computeRunningAvg(
  records: UserWeekRepoRecord[],
  team: string,
  currentWeek: string,
  windowWeeks: number = 12,
): number {
  // Build the set of weeks in the window
  const windowWeekSet = buildWeekWindow(currentWeek, windowWeeks);

  // Filter to team + window
  const filtered = records.filter(
    (r) => r.team === team && windowWeekSet.has(r.week),
  );

  if (filtered.length === 0) {
    return 0;
  }

  // Calculate total lines (insertions + deletions)
  let totalLines = 0;
  const members = new Set<string>();
  const activeWeeks = new Set<string>();

  for (const r of filtered) {
    const ft = r.filetype;
    totalLines +=
      ft.app.insertions + ft.app.deletions +
      ft.test.insertions + ft.test.deletions +
      ft.config.insertions + ft.config.deletions +
      ft.storybook.insertions + ft.storybook.deletions;
    members.add(r.member);
    activeWeeks.add(r.week);
  }

  const headcount = members.size;
  const weeksActive = activeWeeks.size;

  if (headcount === 0 || weeksActive === 0) {
    return 0;
  }

  return totalLines / headcount / weeksActive;
}

/**
 * Compute the running average lines changed per person per week for a given org.
 *
 * Same formula as computeRunningAvg but filters by org instead of team.
 */
export function computeRunningAvgByOrg(
  records: UserWeekRepoRecord[],
  org: string,
  currentWeek: string,
  windowWeeks: number = 12,
): number {
  const windowWeekSet = buildWeekWindow(currentWeek, windowWeeks);

  const filtered = records.filter(
    (r) => r.org === org && windowWeekSet.has(r.week),
  );

  if (filtered.length === 0) {
    return 0;
  }

  let totalLines = 0;
  const members = new Set<string>();
  const activeWeeks = new Set<string>();

  for (const r of filtered) {
    const ft = r.filetype;
    totalLines +=
      ft.app.insertions + ft.app.deletions +
      ft.test.insertions + ft.test.deletions +
      ft.config.insertions + ft.config.deletions +
      ft.storybook.insertions + ft.storybook.deletions;
    members.add(r.member);
    activeWeeks.add(r.week);
  }

  const headcount = members.size;
  const weeksActive = activeWeeks.size;

  if (headcount === 0 || weeksActive === 0) {
    return 0;
  }

  return totalLines / headcount / weeksActive;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Build a Set of ISO week strings for the window ending at `currentWeek`
 * and going back `windowWeeks` weeks (inclusive of currentWeek).
 */
function buildWeekWindow(currentWeek: string, windowWeeks: number): Set<string> {
  const match = currentWeek.match(/^(\d{4})-W(\d{2})$/);
  if (!match) {
    throw new Error(`Invalid ISO week format: ${currentWeek}`);
  }

  const year = parseInt(match[1], 10);
  const week = parseInt(match[2], 10);

  // Jan 4 is always in ISO week 1
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const dayOfWeek = jan4.getUTCDay() || 7;
  const mondayW1 = new Date(jan4);
  mondayW1.setUTCDate(jan4.getUTCDate() - (dayOfWeek - 1));

  // Monday of the current week
  const currentMonday = new Date(mondayW1);
  currentMonday.setUTCDate(mondayW1.getUTCDate() + (week - 1) * 7);

  const weeks = new Set<string>();

  for (let i = 0; i < windowWeeks; i++) {
    const d = new Date(currentMonday);
    d.setUTCDate(currentMonday.getUTCDate() - i * 7);

    // Compute ISO week for this date
    const copy = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const dn = copy.getUTCDay() || 7;
    copy.setUTCDate(copy.getUTCDate() + 4 - dn);
    const ys = new Date(Date.UTC(copy.getUTCFullYear(), 0, 1));
    const wn = Math.ceil(((copy.getTime() - ys.getTime()) / 86400000 + 1) / 7);

    weeks.add(`${copy.getUTCFullYear()}-W${String(wn).padStart(2, "0")}`);
  }

  return weeks;
}
