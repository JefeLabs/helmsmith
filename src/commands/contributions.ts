import { queryRecords, queryRollup, type RollupGroupBy } from '../store/sqlite-store.js';
import {
  filterRecords, getLastNWeeks, getLastNMonths, getLastNQuarters, getLastNYears,
  getCurrentWeek, weekToMonth, weekToQuarter, weekToYear, monthShort,
  type Filters,
} from '../aggregator/filters.js';
import { rollup } from '../aggregator/engine.js';
import type { RolledUp } from '../aggregator/engine.js';
import { testPct, totalLines } from '../aggregator/metrics.js';
import { fmt, weekLabel, quarterShort, yearShort } from '../ui/format.js';
import { calculateSegments, type Segment, type SegmentThresholds } from '../aggregator/segments.js';
import { printTable, printTitle, printNoData, printJson, printSummary, type Column } from '../ui/cli-renderer.js';
import type { UserWeekRepoRecord } from '../types/schema.js';

export type PivotGranularity = 'week' | 'month' | 'quarter' | 'year';

export interface ContributionsOptions {
  weeks?: number;
  groupBy?: 'member' | 'team' | 'org' | 'repo';
  filters?: Filters;
  json?: boolean;
  pivot?: PivotGranularity;
  segment?: Segment;
  segmentThresholds?: SegmentThresholds;
  /** Pre-loaded records (skips disk read when provided — useful for testing). */
  records?: UserWeekRepoRecord[];
}

interface ContributionRow {
  name: string;
  commits: number;
  activeDays: number;
  insertions: number;
  deletions: number;
  net: number;
  files: number;
  testPct: number;
  appLines: number;
  testLines: number;
  configLines: number;
}

function rolledUpToRows(rolled: Map<string, RolledUp>): ContributionRow[] {
  const rows: ContributionRow[] = [];

  for (const [name, agg] of rolled) {
    const appLines = totalLines(agg.filetype.app);
    const testLines = totalLines(agg.filetype.test);

    rows.push({
      name,
      commits: agg.commits,
      activeDays: agg.activeDays,
      insertions: agg.insertions,
      deletions: agg.deletions,
      net: agg.netLines,
      files: agg.filesChanged,
      testPct: testPct(agg.filetype),
      appLines,
      testLines,
      configLines: totalLines(agg.filetype.config),
    });
  }

  // Sort by total lines touched descending
  rows.sort((a, b) => (b.insertions + b.deletions) - (a.insertions + a.deletions));
  return rows;
}

function aggregateRows(
  records: UserWeekRepoRecord[],
  groupBy: string,
): ContributionRow[] {
  const keyFn = (r: UserWeekRepoRecord): string => {
    switch (groupBy) {
      case 'team': return r.team;
      case 'org': return r.org;
      case 'repo': return r.repo;
      default: return r.member;
    }
  };

  return rolledUpToRows(rollup(records, keyFn));
}

export { aggregateRows };

// ── Shared column definitions ────────────────────────────────────────────────

function contributionColumns(segMap?: Map<string, string>): Column[] {
  return [
    { key: 'name', label: 'Name', minWidth: 30, flex: 1 },
    ...(segMap ? [{
      key: 'name', label: 'seg', align: 'right' as const, minWidth: 3,
      format: (v: any) => ((segMap.get(v) ?? 'middle')[0]).toUpperCase(),
    }] : []),
    { key: 'commits', label: 'cmts', align: 'right', minWidth: 6 },
    { key: 'activeDays', label: 'days', align: 'right', minWidth: 5 },
    { key: 'insertions', label: '+ins', align: 'right', minWidth: 8, format: (v: any) => '+' + fmt(v) },
    { key: 'deletions', label: '-del', align: 'right', minWidth: 8, format: (v: any) => '-' + fmt(v) },
    { key: 'net', label: 'net', align: 'right', minWidth: 8, format: (v: any) => (v >= 0 ? '+' : '') + fmt(v) },
    { key: 'testPct', label: 'tst%', align: 'right', minWidth: 5, format: (v: any) => v + '%' },
    { key: 'files', label: 'files', align: 'right', minWidth: 6 },
  ];
}

// ── Pivot logic ──────────────────────────────────────────────────────────────

/** Map a record's week to the appropriate time bucket key. */
function weekToBucket(week: string, granularity: PivotGranularity): string {
  switch (granularity) {
    case 'month': return weekToMonth(week);
    case 'quarter': return weekToQuarter(week);
    case 'year': return weekToYear(week);
    default: return week;
  }
}

/** Human-readable label for a time bucket key. */
function bucketLabel(key: string, granularity: PivotGranularity): string {
  switch (granularity) {
    case 'month': return monthShort(key);
    case 'quarter': return quarterShort(key);
    case 'year': return yearShort(key);
    default: return weekLabel(key);
  }
}

/** Get ordered time bucket keys for the requested span (newest first). */
function getTimeBuckets(
  granularity: PivotGranularity,
  weeksBack: number,
  currentWeek: string,
): string[] {
  let buckets: string[];
  switch (granularity) {
    case 'month': {
      const n = Math.max(1, Math.ceil(weeksBack / 4));
      buckets = getLastNMonths(n, currentWeek);
      break;
    }
    case 'quarter': {
      const n = Math.max(1, Math.ceil(weeksBack / 13));
      buckets = getLastNQuarters(n, currentWeek);
      break;
    }
    case 'year': {
      const n = Math.max(1, Math.ceil(weeksBack / 52));
      buckets = getLastNYears(n, currentWeek);
      break;
    }
    default:
      buckets = getLastNWeeks(weeksBack, currentWeek);
  }
  // Reverse so newest is first (sub-rows read top-down = most recent first)
  return buckets.reverse();
}

/** Entity with its time-period sub-rows, each carrying the full data columns. */
interface PivotEntity {
  name: string;
  total: ContributionRow;
  periods: Array<{ bucket: string; label: string; row: ContributionRow }>;
}

function aggregatePivot(
  records: UserWeekRepoRecord[],
  groupBy: string,
  granularity: PivotGranularity,
  buckets: string[],
): PivotEntity[] {
  const entityKey = (r: UserWeekRepoRecord): string => {
    switch (groupBy) {
      case 'team': return r.team;
      case 'org': return r.org;
      case 'repo': return r.repo;
      default: return r.member;
    }
  };

  const bucketSet = new Set(buckets);

  // Group records by entity + bucket
  const matrix = new Map<string, Map<string, UserWeekRepoRecord[]>>();
  const allByEntity = new Map<string, UserWeekRepoRecord[]>();

  for (const r of records) {
    const entity = entityKey(r);
    const bucket = weekToBucket(r.week, granularity);
    if (!bucketSet.has(bucket)) continue;

    // Per-bucket
    let entityMap = matrix.get(entity);
    if (!entityMap) {
      entityMap = new Map();
      matrix.set(entity, entityMap);
    }
    let arr = entityMap.get(bucket);
    if (!arr) { arr = []; entityMap.set(bucket, arr); }
    arr.push(r);

    // Total
    let all = allByEntity.get(entity);
    if (!all) { all = []; allByEntity.set(entity, all); }
    all.push(r);
  }

  // Build entities with sub-rows
  const entities: PivotEntity[] = [];
  for (const [name, entityMap] of matrix) {
    const totalRows = aggregateRows(allByEntity.get(name) ?? [], groupBy);
    const total = totalRows[0] ?? { name, commits: 0, activeDays: 0, insertions: 0, deletions: 0, net: 0, files: 0, testPct: 0, appLines: 0, testLines: 0, configLines: 0 };

    const periods: PivotEntity['periods'] = [];
    for (const bucket of buckets) {
      const cellRecords = entityMap.get(bucket) ?? [];
      const cellRows = aggregateRows(cellRecords, groupBy);
      const row = cellRows[0] ?? { name, commits: 0, activeDays: 0, insertions: 0, deletions: 0, net: 0, files: 0, testPct: 0, appLines: 0, testLines: 0, configLines: 0 };
      periods.push({ bucket, label: bucketLabel(bucket, granularity), row });
    }

    entities.push({ name, total, periods });
  }

  // Sort by total lines touched descending
  entities.sort((a, b) => (b.total.insertions + b.total.deletions) - (a.total.insertions + a.total.deletions));
  return entities;
}

export { aggregatePivot };

// ── Pivot rendering ──────────────────────────────────────────────────────────

function renderPivot(
  entities: PivotEntity[],
  groupBy: string,
  pivot: PivotGranularity,
  weeksBack: number,
  bucketCount: number,
  recordCount: number,
): void {
  // Flatten entities + sub-rows into renderTable-compatible rows with groupSeparators
  const pivotColumns: Column[] = [
    { key: 'name', label: 'Name', minWidth: 22, flex: 1 },
    { key: 'period', label: 'period', minWidth: 9 },
    { key: 'commits', label: 'cmts', align: 'right', minWidth: 6 },
    { key: 'activeDays', label: 'days', align: 'right', minWidth: 5 },
    { key: 'insertions', label: '+ins', align: 'right', minWidth: 8, format: (v: any) => '+' + fmt(v) },
    { key: 'deletions', label: '-del', align: 'right', minWidth: 8, format: (v: any) => '-' + fmt(v) },
    { key: 'net', label: 'net', align: 'right', minWidth: 8, format: (v: any) => (v >= 0 ? '+' : '') + fmt(v) },
    { key: 'testPct', label: 'tst%', align: 'right', minWidth: 5, format: (v: any) => v + '%' },
    { key: 'files', label: 'files', align: 'right', minWidth: 6 },
  ];

  const flatRows: Record<string, any>[] = [];
  const groupSeps: number[] = [];

  for (const entity of entities) {
    // Total row (with entity name)
    flatRows.push({
      ...entity.total,
      name: entity.name,
      period: 'TOTAL',
    });
    // Period sub-rows
    for (const p of entity.periods) {
      if (p.row.commits === 0) continue;
      flatRows.push({
        ...p.row,
        name: '',
        period: p.label,
      });
    }
    // Mark end of this entity group for separator
    groupSeps.push(flatRows.length - 1);
  }

  printTable({
    title: `Contributions by ${groupBy} (pivot: ${pivot}, last ${weeksBack} weeks)`,
    columns: pivotColumns,
    rows: flatRows,
    groupSeparator: groupSeps,
    summary: `${entities.length} ${groupBy}s, ${bucketCount} ${pivot}s, ${recordCount} records`,
  });
}

// ── Main entry point ─────────────────────────────────────────────────────────

export async function contributions(options: ContributionsOptions = {}): Promise<void> {
  const weeksBack = options.weeks ?? 12;
  const currentWeek = getCurrentWeek();
  const weeks = getLastNWeeks(weeksBack, currentWeek);
  const groupBy = options.groupBy ?? 'member';

  // SQL-accelerated path: use queryRollup when no pre-loaded records
  const useSQLPath = !options.records && !options.pivot;

  let records: UserWeekRepoRecord[];
  if (useSQLPath) {
    // Build SQL filters combining user filters + week range
    const sqlFilters: import('../store/sqlite-store.js').RollupFilters = {
      weeks,
      ...options.filters,
    };
    const rolled = queryRollup(sqlFilters, groupBy as RollupGroupBy);
    if (rolled.size === 0) {
      printNoData();
      return;
    }

    // We have everything we need from SQL
    let rows = rolledUpToRows(rolled);
    if (options.json) {
      printJson(rows);
      return;
    }

    // Compute segments for display (from SQL-aggregated totals)
    const memberTotals = new Map<string, number>();
    for (const row of rows) {
      memberTotals.set(row.name, row.insertions + row.deletions);
    }
    const segMap = calculateSegments(memberTotals, options.segmentThresholds);

    // Filter by segment if requested
    if (options.segment) {
      rows = rows.filter((row) => segMap.get(row.name) === options.segment);
      if (rows.length === 0) {
        printNoData(`No ${options.segment}-segment contributors found.`);
        return;
      }
    }

    printTable({
      title: `Contributions by ${groupBy} (last ${weeksBack} weeks)`,
      columns: contributionColumns(segMap),
      rows,
      summary: `${rows.length} ${groupBy}s`,
    });
    return;
  }

  // Fallback path: pre-loaded records, pivot mode, or segment filtering
  records = options.records ?? queryRecords({});

  if (options.filters) {
    records = filterRecords(records, options.filters);
  }

  const weekSet = new Set(weeks);
  records = records.filter((r) => weekSet.has(r.week));

  if (records.length === 0) {
    printNoData();
    return;
  }

  // ── Pivot mode ──────────────────────────────────────────────────────────
  if (options.pivot) {
    const buckets = getTimeBuckets(options.pivot, weeksBack, currentWeek);
    const entities = aggregatePivot(records, groupBy, options.pivot, buckets);

    if (options.json) {
      printJson(entities.map((e) => ({
        name: e.name,
        total: e.total,
        periods: e.periods.map((p) => ({
          period: p.bucket,
          label: p.label,
          ...p.row,
        })),
      })));
      return;
    }

    renderPivot(entities, groupBy, options.pivot, weeksBack, buckets.length, records.length);
    return;
  }

  // ── Flat mode (original) ────────────────────────────────────────────────
  let rows = aggregateRows(records, groupBy);

  // Compute segments for flat output
  const memberTotals = new Map<string, number>();
  for (const row of rows) {
    memberTotals.set(row.name, row.insertions + row.deletions);
  }
  const segMap = calculateSegments(memberTotals, options.segmentThresholds);

  // Filter by segment if requested
  if (options.segment) {
    rows = rows.filter((row) => segMap.get(row.name) === options.segment);
  }

  if (options.json) {
    const jsonRows = rows.map((r) => ({ ...r, segment: segMap.get(r.name) ?? 'middle' }));
    printJson(jsonRows);
    return;
  }

  printTable({
    title: `Contributions by ${groupBy} (last ${weeksBack} weeks)`,
    columns: contributionColumns(segMap),
    rows,
    summary: `${rows.length} ${groupBy}s, ${records.length} records`,
  });
}
