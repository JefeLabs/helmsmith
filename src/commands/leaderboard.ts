import { queryRecords, queryRollup } from '../store/sqlite-store.js';
import { filterRecords, getLastNWeeks, getCurrentWeek, type Filters } from '../aggregator/filters.js';
import { computeLeaderboard } from '../aggregator/leaderboard.js';
import { rollup } from '../aggregator/engine.js';
import { calculateSegments, type Segment, type SegmentThresholds } from '../aggregator/segments.js';
import { fmt } from '../ui/format.js';
import { printTitle, printNoData, printJson, type Column } from '../ui/cli-renderer.js';
import { renderTable } from '../ui/table.js';
import type { UserWeekRepoRecord } from '../types/schema.js';

export interface LeaderboardOptions {
  weeks?: number;
  top?: number;
  filters?: Filters;
  json?: boolean;
  segment?: Segment;
  segmentThresholds?: SegmentThresholds;
  /** Pre-loaded records (skips disk read when provided — useful for testing). */
  records?: UserWeekRepoRecord[];
}

const sectionColumns: Column[] = [
  { key: 'rank', label: '#', align: 'right', minWidth: 3 },
  { key: 'member', label: 'Name', minWidth: 25, flex: 1 },
  { key: 'team', label: 'Team', minWidth: 15 },
  { key: 'value', label: 'Lines', align: 'right', minWidth: 8, format: (v: any) => fmt(v) },
];

export async function leaderboard(options: LeaderboardOptions = {}): Promise<void> {
  let records = options.records ?? queryRecords({});

  if (options.filters) {
    records = filterRecords(records, options.filters);
  }

  // Filter by segment if requested
  if (options.segment) {
    const weeksForSeg = getLastNWeeks(options.weeks ?? 4, getCurrentWeek());
    // Use SQL rollup when operating from DB, JS rollup when pre-loaded
    const rolled = options.records
      ? rollup(records.filter((r) => weeksForSeg.includes(r.week)), (r: UserWeekRepoRecord) => r.member)
      : queryRollup({ weeks: weeksForSeg, ...options.filters }, 'member');
    const memberTotals = new Map<string, number>();
    for (const [name, agg] of rolled) {
      memberTotals.set(name, agg.insertions + agg.deletions);
    }
    const segMap = calculateSegments(memberTotals, options.segmentThresholds);
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
    printNoData('No data for leaderboard. Run "gitradar scan" first.');
    return;
  }

  if (options.json) {
    printJson(columns);
    return;
  }

  printTitle(`Top Performers (last ${weeksBack} weeks)`);

  for (const col of columns) {
    if (col.entries.length === 0) continue;
    console.log(`  ${col.title}`);
    console.log('  ' + renderTable({
      columns: sectionColumns,
      rows: col.entries,
      borderStyle: 'minimal',
    }).split('\n').join('\n  '));
    console.log('');
  }
}
