import { loadCommitsData } from '../store/commits-by-filetype.js';
import { filterRecords, getLastNWeeks, getCurrentWeek, type Filters } from '../aggregator/filters.js';
import { computeLeaderboard } from '../aggregator/leaderboard.js';
import { rollup } from '../aggregator/engine.js';
import { calculateSegments, type Segment } from '../aggregator/segments.js';
import { fmt } from '../ui/format.js';
import type { UserWeekRepoRecord } from '../types/schema.js';

export interface LeaderboardOptions {
  weeks?: number;
  top?: number;
  filters?: Filters;
  json?: boolean;
  segment?: Segment;
  /** Pre-loaded records (skips disk read when provided — useful for testing). */
  records?: UserWeekRepoRecord[];
}

export async function leaderboard(options: LeaderboardOptions = {}): Promise<void> {
  let records = options.records ?? (await loadCommitsData()).records;

  if (options.filters) {
    records = filterRecords(records, options.filters);
  }

  // Filter by segment if requested
  if (options.segment) {
    const weeksForSeg = getLastNWeeks(options.weeks ?? 4, getCurrentWeek());
    const weekSet = new Set(weeksForSeg);
    const segRecords = records.filter((r) => weekSet.has(r.week));
    const rolled = rollup(segRecords, (r: UserWeekRepoRecord) => r.member);
    const memberTotals = new Map<string, number>();
    for (const [name, agg] of rolled) {
      memberTotals.set(name, agg.insertions + agg.deletions);
    }
    const segMap = calculateSegments(memberTotals);
    const allowedMembers = new Set<string>();
    for (const [name, seg] of segMap) {
      if (seg === options.segment) allowedMembers.add(name);
    }
    records = records.filter((r) => allowedMembers.has(r.member));
  }

  const weeksBack = options.weeks ?? 4;
  const currentWeek = getCurrentWeek();
  const weeks = getLastNWeeks(weeksBack, currentWeek);
  const topN = options.top ?? 10;

  const columns = computeLeaderboard(records, weeks, topN);

  if (columns.every((c) => c.entries.length === 0)) {
    console.log('No data for leaderboard. Run "gitradar scan" first.');
    return;
  }

  if (options.json) {
    console.log(JSON.stringify(columns, null, 2));
    return;
  }

  console.log(`\nTop Performers (last ${weeksBack} weeks)\n`);

  for (const col of columns) {
    if (col.entries.length === 0) continue;
    console.log(`  ${col.title}`);
    console.log(`  ${'#'.padStart(3)} ${'Name'.padEnd(25)} ${'Team'.padEnd(15)} ${'Lines'.padStart(8)}`);
    console.log(`  ${'-'.repeat(55)}`);
    for (const entry of col.entries) {
      const name = entry.member.length > 24 ? entry.member.slice(0, 23) + '…' : entry.member;
      const team = entry.team.length > 14 ? entry.team.slice(0, 13) + '…' : entry.team;
      console.log(`  ${String(entry.rank).padStart(3)} ${name.padEnd(25)} ${team.padEnd(15)} ${fmt(entry.value).padStart(8)}`);
    }
    console.log('');
  }
}
