import { loadCommitsData } from '../store/commits-by-filetype.js';
import { filterRecords, getLastNWeeks, getCurrentWeek, type Filters } from '../aggregator/filters.js';
import { rollup } from '../aggregator/engine.js';
import { fmt } from '../ui/format.js';

export interface RepoActivityOptions {
  weeks?: number;
  filters?: Filters;
  json?: boolean;
  /** Pre-loaded records (skips disk read when provided — useful for testing). */
  records?: import('../types/schema.js').UserWeekRepoRecord[];
}

interface RepoRow {
  repo: string;
  group: string;
  commits: number;
  contributors: number;
  insertions: number;
  deletions: number;
  net: number;
  files: number;
  weeklyCommits: number[];
}

export async function repoActivity(options: RepoActivityOptions = {}): Promise<void> {
  let records = options.records ?? (await loadCommitsData()).records;

  if (options.filters) {
    records = filterRecords(records, options.filters);
  }

  const weeksBack = options.weeks ?? 8;
  const currentWeek = getCurrentWeek();
  const weeks = getLastNWeeks(weeksBack, currentWeek);
  const weekSet = new Set(weeks);
  records = records.filter((r) => weekSet.has(r.week));

  if (records.length === 0) {
    console.log('No records found. Run "gitradar scan" first.');
    return;
  }

  // Aggregate by repo
  const rolled = rollup(records, (r) => r.repo);
  const rows: RepoRow[] = [];

  for (const [repo, agg] of rolled) {
    const repoRecords = records.filter((r) => r.repo === repo);
    const contributors = new Set(repoRecords.map((r) => r.member)).size;
    const group = repoRecords[0]?.group ?? 'default';

    const ins = agg.filetype.app.insertions + agg.filetype.test.insertions +
      agg.filetype.config.insertions + agg.filetype.storybook.insertions +
      agg.filetype.doc.insertions;
    const del = agg.filetype.app.deletions + agg.filetype.test.deletions +
      agg.filetype.config.deletions + agg.filetype.storybook.deletions +
      agg.filetype.doc.deletions;
    const files = agg.filetype.app.files + agg.filetype.test.files +
      agg.filetype.config.files + agg.filetype.storybook.files +
      agg.filetype.doc.files;

    // Weekly commits breakdown
    const weeklyCommits = weeks.map((w) => {
      return repoRecords.filter((r) => r.week === w).reduce((s, r) => s + r.commits, 0);
    });

    rows.push({
      repo,
      group,
      commits: agg.commits,
      contributors,
      insertions: ins,
      deletions: del,
      net: ins - del,
      files,
      weeklyCommits,
    });
  }

  rows.sort((a, b) => b.commits - a.commits);

  if (options.json) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  console.log(`\nRepo Activity (last ${weeksBack} weeks)\n`);

  const header = `${'Repo'.padEnd(30)} ${'Group'.padEnd(10)} ${'cmts'.padStart(6)} ${'devs'.padStart(5)} ${'+ins'.padStart(8)} ${'-del'.padStart(8)} ${'net'.padStart(8)} ${'files'.padStart(6)}`;
  console.log(header);
  console.log('-'.repeat(header.length));

  for (const row of rows) {
    const name = row.repo.length > 29 ? row.repo.slice(0, 28) + '…' : row.repo;
    const group = row.group.length > 9 ? row.group.slice(0, 8) + '…' : row.group;
    console.log(
      `${name.padEnd(30)} ${group.padEnd(10)} ${String(row.commits).padStart(6)} ${String(row.contributors).padStart(5)} ${('+' + fmt(row.insertions)).padStart(8)} ${('-' + fmt(row.deletions)).padStart(8)} ${((row.net >= 0 ? '+' : '') + fmt(row.net)).padStart(8)} ${String(row.files).padStart(6)}`,
    );
  }

  console.log(`\n${rows.length} repos, ${records.length} records`);
}
