import { loadCommitsData } from '../store/commits-by-filetype.js';
import { filterRecords, getLastNWeeks, getCurrentWeek, type Filters } from '../aggregator/filters.js';
import { rollup } from '../aggregator/engine.js';
import { fmt } from '../ui/format.js';
import type { UserWeekRepoRecord } from '../types/schema.js';

export interface ContributionsOptions {
  weeks?: number;
  groupBy?: 'member' | 'team' | 'org' | 'repo';
  filters?: Filters;
  json?: boolean;
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
    const name = row.name.length > 29 ? row.name.slice(0, 28) + '…' : row.name;
    console.log(
      `${name.padEnd(30)} ${String(row.commits).padStart(6)} ${String(row.activeDays).padStart(5)} ${('+' + fmt(row.insertions)).padStart(8)} ${('-' + fmt(row.deletions)).padStart(8)} ${(row.net >= 0 ? '+' : '') + fmt(row.net)}`.padEnd(76) +
      `${String(row.testPct) + '%'}`.padStart(5) +
      `${String(row.files).padStart(6)}`,
    );
  }

  console.log(`\n${rows.length} ${groupBy}s, ${records.length} records`);
}
