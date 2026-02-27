import { loadCommitsData } from '../store/commits-by-filetype.js';
import {
  filterRecords, getLastNWeeks, getLastNMonths, getLastNQuarters, getLastNYears,
  getCurrentWeek, weekToMonth, weekToQuarter, weekToYear, monthShort,
  type Filters,
} from '../aggregator/filters.js';
import { rollup } from '../aggregator/engine.js';
import { fmt, weekLabel, quarterShort, yearShort } from '../ui/format.js';
import type { UserWeekRepoRecord } from '../types/schema.js';

export type PivotGranularity = 'week' | 'month' | 'quarter' | 'year';

export interface ContributionsOptions {
  weeks?: number;
  groupBy?: 'member' | 'team' | 'org' | 'repo';
  filters?: Filters;
  json?: boolean;
  pivot?: PivotGranularity;
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

  const rolled = rollup(records, keyFn);
  const rows: ContributionRow[] = [];

  for (const [name, agg] of rolled) {
    const ins = agg.filetype.app.insertions + agg.filetype.test.insertions +
      agg.filetype.config.insertions + agg.filetype.storybook.insertions;
    const del = agg.filetype.app.deletions + agg.filetype.test.deletions +
      agg.filetype.config.deletions + agg.filetype.storybook.deletions;
    const files = agg.filetype.app.files + agg.filetype.test.files +
      agg.filetype.config.files + agg.filetype.storybook.files;
    const appLines = agg.filetype.app.insertions + agg.filetype.app.deletions;
    const testLines = agg.filetype.test.insertions + agg.filetype.test.deletions;
    const denom = appLines + testLines;

    rows.push({
      name,
      commits: agg.commits,
      activeDays: agg.activeDays,
      insertions: ins,
      deletions: del,
      net: ins - del,
      files,
      testPct: denom > 0 ? Math.round((testLines / denom) * 100) : 0,
      appLines,
      testLines,
      configLines: agg.filetype.config.insertions + agg.filetype.config.deletions,
    });
  }

  // Sort by total lines touched descending
  rows.sort((a, b) => (b.insertions + b.deletions) - (a.insertions + a.deletions));
  return rows;
}

export { aggregateRows };

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

// ── Main entry point ─────────────────────────────────────────────────────────

export async function contributions(options: ContributionsOptions = {}): Promise<void> {
  let records = options.records ?? (await loadCommitsData()).records;

  if (options.filters) {
    records = filterRecords(records, options.filters);
  }

  const weeksBack = options.weeks ?? 12;
  const currentWeek = getCurrentWeek();
  const weeks = getLastNWeeks(weeksBack, currentWeek);
  const weekSet = new Set(weeks);
  records = records.filter((r) => weekSet.has(r.week));

  if (records.length === 0) {
    console.log('No records found. Run "gitradar scan" first.');
    return;
  }

  const groupBy = options.groupBy ?? 'member';

  // ── Pivot mode ──────────────────────────────────────────────────────────
  if (options.pivot) {
    const buckets = getTimeBuckets(options.pivot, weeksBack, currentWeek);
    const entities = aggregatePivot(records, groupBy, options.pivot, buckets);

    if (options.json) {
      console.log(JSON.stringify(entities.map((e) => ({
        name: e.name,
        total: e.total,
        periods: e.periods.map((p) => ({
          period: p.bucket,
          label: p.label,
          ...p.row,
        })),
      })), null, 2));
      return;
    }

    // Render grouped table: entity header → period sub-rows
    const nameWidth = 22;
    const periodWidth = 9;
    const header = `${'Name'.padEnd(nameWidth)} ${'period'.padEnd(periodWidth)} ${'cmts'.padStart(6)} ${'days'.padStart(5)} ${'+ins'.padStart(8)} ${'-del'.padStart(8)} ${'net'.padStart(8)} ${'tst%'.padStart(5)} ${'files'.padStart(6)}`;

    console.log(`\nContributions by ${groupBy} (pivot: ${options.pivot}, last ${weeksBack} weeks)\n`);
    console.log(header);
    console.log('-'.repeat(header.length));

    const formatRow = (label: string, isName: boolean, row: ContributionRow) => {
      const col1 = isName
        ? (label.length > nameWidth - 1 ? label.slice(0, nameWidth - 2) + '\u2026' : label).padEnd(nameWidth)
        : ' '.repeat(nameWidth);
      const col2 = isName ? 'TOTAL'.padEnd(periodWidth) : label.padEnd(periodWidth);
      return `${col1} ${col2} ${String(row.commits).padStart(6)} ${String(row.activeDays).padStart(5)} ${('+' + fmt(row.insertions)).padStart(8)} ${('-' + fmt(row.deletions)).padStart(8)} ${((row.net >= 0 ? '+' : '') + fmt(row.net)).padStart(8)} ${(String(row.testPct) + '%').padStart(5)} ${String(row.files).padStart(6)}`;
    };

    for (const entity of entities) {
      // Entity total row (with name)
      console.log(formatRow(entity.name, true, entity.total));
      // Period sub-rows
      for (const p of entity.periods) {
        if (p.row.commits === 0) continue;  // skip empty periods
        console.log(formatRow(p.label, false, p.row));
      }
      console.log('');  // blank line between entities
    }

    console.log(`${entities.length} ${groupBy}s, ${buckets.length} ${options.pivot}s, ${records.length} records`);
    return;
  }

  // ── Flat mode (original) ────────────────────────────────────────────────
  const rows = aggregateRows(records, groupBy);

  if (options.json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  // Table header
  const header = `${'Name'.padEnd(30)} ${'cmts'.padStart(6)} ${'days'.padStart(5)} ${'+ins'.padStart(8)} ${'-del'.padStart(8)} ${'net'.padStart(8)} ${'tst%'.padStart(5)} ${'files'.padStart(6)}`;
  console.log(`\nContributions by ${groupBy} (last ${weeksBack} weeks)\n`);
  console.log(header);
  console.log('-'.repeat(header.length));

  for (const row of rows) {
    const name = row.name.length > 29 ? row.name.slice(0, 28) + '\u2026' : row.name;
    console.log(
      `${name.padEnd(30)} ${String(row.commits).padStart(6)} ${String(row.activeDays).padStart(5)} ${('+' + fmt(row.insertions)).padStart(8)} ${('-' + fmt(row.deletions)).padStart(8)} ${(row.net >= 0 ? '+' : '') + fmt(row.net)}`.padEnd(76) +
      `${String(row.testPct) + '%'}`.padStart(5) +
      `${String(row.files).padStart(6)}`,
    );
  }

  console.log(`\n${rows.length} ${groupBy}s, ${records.length} records`);
}
