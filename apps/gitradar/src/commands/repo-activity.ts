import { queryRecords, queryRollup } from '../store/sqlite-store.js';
import { filterRecords, getLastNWeeks, getCurrentWeek, type Filters } from '../aggregator/filters.js';
import { rollup } from '../aggregator/engine.js';
import { fmt } from '../ui/format.js';
import { printTable, printNoData, printJson, type Column } from '../ui/cli-renderer.js';

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

const repoColumns: Column[] = [
  { key: 'repo', label: 'Repo', minWidth: 30, flex: 1 },
  { key: 'group', label: 'Group', minWidth: 10 },
  { key: 'commits', label: 'cmts', align: 'right', minWidth: 6 },
  { key: 'contributors', label: 'devs', align: 'right', minWidth: 5 },
  { key: 'insertions', label: '+ins', align: 'right', minWidth: 8, format: (v: any) => '+' + fmt(v) },
  { key: 'deletions', label: '-del', align: 'right', minWidth: 8, format: (v: any) => '-' + fmt(v) },
  { key: 'net', label: 'net', align: 'right', minWidth: 8, format: (v: any) => (v >= 0 ? '+' : '') + fmt(v) },
  { key: 'files', label: 'files', align: 'right', minWidth: 6 },
];

export async function repoActivity(options: RepoActivityOptions = {}): Promise<void> {
  const weeksBack = options.weeks ?? 8;
  const currentWeek = getCurrentWeek();
  const weeks = getLastNWeeks(weeksBack, currentWeek);

  // SQL-accelerated path when no pre-loaded records
  const useSQLPath = !options.records;

  let rows: RepoRow[];

  if (useSQLPath) {
    const sqlFilters = { weeks, ...options.filters };
    const rolled = queryRollup(sqlFilters, 'repo');

    if (rolled.size === 0) {
      printNoData();
      return;
    }

    // Get per-repo group name via a lightweight query
    const db = (await import('../store/sqlite-store.js')).getDB();
    const groupRows = db.prepare(
      "SELECT DISTINCT repo, grp FROM records WHERE week IN (SELECT value FROM json_each(?))",
    ).all(JSON.stringify(weeks)) as Array<{ repo: string; grp: string }>;
    const repoGroups = new Map(groupRows.map((r) => [r.repo, r.grp]));

    // Get weekly commits per repo via SQL
    const weeklyRows = db.prepare(`
      SELECT repo, week, SUM(commits) as commits
      FROM records
      WHERE week IN (SELECT value FROM json_each(?))
      GROUP BY repo, week
    `).all(JSON.stringify(weeks)) as Array<{ repo: string; week: string; commits: number }>;
    const weeklyMap = new Map<string, Map<string, number>>();
    for (const r of weeklyRows) {
      let repoMap = weeklyMap.get(r.repo);
      if (!repoMap) { repoMap = new Map(); weeklyMap.set(r.repo, repoMap); }
      repoMap.set(r.week, r.commits);
    }

    rows = [];
    for (const [repo, agg] of rolled) {
      rows.push({
        repo,
        group: repoGroups.get(repo) ?? 'default',
        commits: agg.commits,
        contributors: agg.activeMembers,
        insertions: agg.insertions,
        deletions: agg.deletions,
        net: agg.netLines,
        files: agg.filesChanged,
        weeklyCommits: weeks.map((w) => weeklyMap.get(repo)?.get(w) ?? 0),
      });
    }
  } else {
    // Fallback: pre-loaded records
    let records = options.records!;

    if (options.filters) {
      records = filterRecords(records, options.filters);
    }

    const weekSet = new Set(weeks);
    records = records.filter((r) => weekSet.has(r.week));

    if (records.length === 0) {
      printNoData();
      return;
    }

    const rolled = rollup(records, (r) => r.repo);
    rows = [];

    for (const [repo, agg] of rolled) {
      const repoRecords = records.filter((r) => r.repo === repo);
      rows.push({
        repo,
        group: repoRecords[0]?.group ?? 'default',
        commits: agg.commits,
        contributors: agg.activeMembers,
        insertions: agg.insertions,
        deletions: agg.deletions,
        net: agg.netLines,
        files: agg.filesChanged,
        weeklyCommits: weeks.map((w) =>
          repoRecords.filter((r) => r.week === w).reduce((s, r) => s + r.commits, 0),
        ),
      });
    }
  }

  rows.sort((a, b) => b.commits - a.commits);

  if (options.json) {
    printJson(rows);
    return;
  }

  printTable({
    title: `Repo Activity (last ${weeksBack} weeks)`,
    columns: repoColumns,
    rows,
    summary: `${rows.length} repos`,
  });
}
