import chalk from 'chalk';
import type { ViewContext, NavigationAction } from './types.js';
import type { UserWeekRepoRecord } from '../types/schema.js';
import { renderBanner } from '../ui/banner.js';
import { renderGroupedHBarChart } from '../ui/grouped-hbar-chart.js';
import type { HBarGroup } from '../ui/grouped-hbar-chart.js';
import { renderLineChart } from '../ui/line-chart.js';
import { renderTable } from '../ui/table.js';
import { renderLegend } from '../ui/legend.js';
import { renderHotkeyBar } from '../ui/tab-bar.js';
import { readKey } from '../ui/keypress.js';
import { stackedBar } from '../ui/bar.js';
import { rollup } from '../aggregator/engine.js';
import { filterRecords, getLastNWeeks, computeDeltas } from '../aggregator/filters.js';
import { SEGMENT_DEFS, FILETYPE_COLORS, FILETYPE_CHARS } from '../ui/constants.js';
import { fmt, weekShort, delta } from '../ui/format.js';

/**
 * Build file-type-by-week grouped bar chart for a member (last 3 weeks).
 */
function buildWeeklyBars(
  records: UserWeekRepoRecord[],
  memberName: string,
  currentWeek: string,
): HBarGroup[] {
  const weeks = getLastNWeeks(3, currentWeek);
  const memberRecords = filterRecords(records, { member: memberName });

  const groups: HBarGroup[] = [];

  for (const week of weeks) {
    const weekRecords = memberRecords.filter((r) => r.week === week);
    const rolled = rollup(weekRecords, () => 'all');
    const agg = rolled.get('all');

    if (!agg) {
      groups.push({ groupLabel: weekShort(week), bars: [] });
      continue;
    }

    const totalLines = agg.insertions + agg.deletions;

    groups.push({
      groupLabel: weekShort(week),
      bars: [
        {
          label: '',
          segments: [
            { key: 'app', value: agg.filetype.app.insertions + agg.filetype.app.deletions },
            { key: 'test', value: agg.filetype.test.insertions + agg.filetype.test.deletions },
            { key: 'config', value: agg.filetype.config.insertions + agg.filetype.config.deletions },
            { key: 'storybook', value: agg.filetype.storybook.insertions + agg.filetype.storybook.deletions },
          ],
          total: totalLines,
        },
      ],
    });
  }

  return groups;
}

/**
 * Build activity line chart with 3 series: commits, +lines, net.
 */
function buildActivitySeries(
  records: UserWeekRepoRecord[],
  memberName: string,
  currentWeek: string,
) {
  const weeks = getLastNWeeks(12, currentWeek);
  const memberRecords = filterRecords(records, { member: memberName });

  const commitValues: number[] = [];
  const insertionValues: number[] = [];
  const netValues: number[] = [];

  for (const week of weeks) {
    const weekRecords = memberRecords.filter((r) => r.week === week);
    const rolled = rollup(weekRecords, () => 'all');
    const agg = rolled.get('all');

    commitValues.push(agg?.commits ?? 0);
    insertionValues.push(agg?.insertions ?? 0);
    netValues.push(agg?.netLines ?? 0);
  }

  return {
    series: [
      { label: 'commits', color: chalk.cyan, values: commitValues, style: 'solid' as const },
      { label: '+lines', color: chalk.green, values: insertionValues, style: 'solid' as const },
      { label: 'net', color: chalk.yellow, values: netValues, style: 'dotted' as const },
    ],
    xLabels: weeks.map(weekShort),
  };
}

/**
 * Build repos table for this member in the current week.
 */
function buildMemberReposTable(
  records: UserWeekRepoRecord[],
  memberName: string,
  currentWeek: string,
) {
  const currentRecords = filterRecords(records, { weeks: [currentWeek], member: memberName });
  const repoRolled = rollup(currentRecords, (r) => r.repo);

  // Get previous week for delta
  const prevWeeks = getLastNWeeks(2, currentWeek);
  const prevWeek = prevWeeks.length >= 2 ? prevWeeks[0] : null;
  let prevRolled: Map<string, ReturnType<typeof rollup> extends Map<string, infer V> ? V : never> | null = null;
  if (prevWeek) {
    const prevRecords = filterRecords(records, { weeks: [prevWeek], member: memberName });
    prevRolled = rollup(prevRecords, (r) => r.repo);
  }

  const rows: Record<string, any>[] = [];
  for (const [repo, agg] of repoRolled) {
    const totalLines = agg.insertions + agg.deletions;
    const prevAgg = prevRolled?.get(repo);
    const prevTotal = prevAgg ? prevAgg.insertions + prevAgg.deletions : 0;

    rows.push({
      repo,
      commits: agg.commits,
      insertions: agg.insertions,
      deletions: agg.deletions,
      breakdown: {
        app: agg.filetype.app.insertions + agg.filetype.app.deletions,
        test: agg.filetype.test.insertions + agg.filetype.test.deletions,
        config: agg.filetype.config.insertions + agg.filetype.config.deletions,
        storybook: agg.filetype.storybook.insertions + agg.filetype.storybook.deletions,
      },
      delta: prevTotal > 0 || totalLines > 0 ? delta(totalLines, prevTotal) : chalk.dim('\u2500 0%'),
    });
  }

  rows.sort((a, b) => b.commits - a.commits);
  return rows;
}

/**
 * Compute the 12-week summary line for a member.
 */
function computeSummary(
  records: UserWeekRepoRecord[],
  memberName: string,
  currentWeek: string,
): { avgCommits: number; avgInsertions: number; testRatio: number } {
  const weeks = getLastNWeeks(12, currentWeek);
  const memberRecords = filterRecords(records, { member: memberName, weeks });

  let totalCommits = 0;
  let totalInsertions = 0;
  let totalApp = 0;
  let totalTest = 0;
  const activeWeeks = new Set<string>();

  for (const r of memberRecords) {
    totalCommits += r.commits;
    totalInsertions += r.filetype.app.insertions + r.filetype.test.insertions +
      r.filetype.config.insertions + r.filetype.storybook.insertions;
    totalApp += r.filetype.app.insertions + r.filetype.app.deletions;
    totalTest += r.filetype.test.insertions + r.filetype.test.deletions;
    activeWeeks.add(r.week);
  }

  const numWeeks = Math.max(1, activeWeeks.size);
  const denominator = totalApp + totalTest;

  return {
    avgCommits: totalCommits / numWeeks,
    avgInsertions: totalInsertions / numWeeks,
    testRatio: denominator === 0 ? 0 : (totalTest / denominator) * 100,
  };
}

/**
 * Member detail view - drill-down for a specific person.
 *
 * Shows:
 * 1. File type by week (last 3 weeks, grouped-hbar)
 * 2. Activity line chart (commits, +lines, net)
 * 3. Repos table for this member
 * 4. 12w summary line
 */
export async function memberDetailView(
  ctx: ViewContext,
  memberName: string,
  teamName: string,
): Promise<NavigationAction> {
  const termCols = process.stdout.columns || 100;

  // Find org
  let orgName = '';
  for (const org of ctx.config.orgs) {
    for (const team of org.teams) {
      if (team.name === teamName) {
        orgName = org.name;
      }
    }
  }

  const weeks12 = getLastNWeeks(12, ctx.currentWeek);

  process.stdout.write('\x1B[2J\x1B[3J\x1B[H');

  // Banner
  const banner = renderBanner({
    title: `${memberName.toUpperCase()} \u00B7 ${teamName} \u00B7 ${orgName}`,
    right: `${weekShort(weeks12[0])} \u2192 ${weekShort(weeks12[weeks12.length - 1])}`,
  });
  console.log(banner);
  console.log('');

  // Section 1: File Type by Week
  const legend = renderLegend(
    SEGMENT_DEFS.map((d) => ({ label: d.label, color: d.color, char: d.char })),
    { inline: true },
  );
  console.log(chalk.bold('File Type by Week') + '  ' + legend);
  console.log('');

  const weeklyGroups = buildWeeklyBars(ctx.records, memberName, ctx.currentWeek);
  const barChart = renderGroupedHBarChart({
    groups: weeklyGroups,
    segmentDefs: SEGMENT_DEFS,
    maxWidth: termCols,
    showValues: true,
    labelWidth: 6,
  });
  console.log(barChart);
  console.log('');

  // Section 2: Activity line chart
  const { series, xLabels } = buildActivitySeries(ctx.records, memberName, ctx.currentWeek);
  console.log(chalk.bold('Activity (12 weeks)'));
  console.log('');
  const lineChart = renderLineChart({
    series,
    xLabels,
    height: 8,
    width: Math.min(termCols - 10, 60),
    showLegend: true,
  });
  console.log(lineChart);
  console.log('');

  // Section 3: Repos table
  const repoRows = buildMemberReposTable(ctx.records, memberName, ctx.currentWeek);
  if (repoRows.length > 0) {
    console.log(chalk.bold(`Repos (${weekShort(ctx.currentWeek)})`));
    const reposTable = renderTable({
      columns: [
        { key: 'repo', label: 'Repo', minWidth: 14 },
        { key: 'commits', label: 'Commits', align: 'right', minWidth: 7 },
        { key: 'insertions', label: '+Ins', align: 'right', minWidth: 6, format: (v) => chalk.green(fmt(v)) },
        { key: 'deletions', label: '-Del', align: 'right', minWidth: 6, format: (v) => chalk.red(fmt(v)) },
        {
          key: 'breakdown',
          label: 'Breakdown',
          minWidth: 15,
          format: (v) =>
            stackedBar(
              [
                { value: v.app, color: FILETYPE_COLORS.app, char: FILETYPE_CHARS.app },
                { value: v.test, color: FILETYPE_COLORS.test, char: FILETYPE_CHARS.test },
                { value: v.config, color: FILETYPE_COLORS.config, char: FILETYPE_CHARS.config },
                { value: v.storybook, color: FILETYPE_COLORS.storybook, char: FILETYPE_CHARS.storybook },
              ],
              15,
            ),
        },
        { key: 'delta', label: '\u0394 prev', align: 'right', minWidth: 8 },
      ],
      rows: repoRows,
      maxWidth: termCols,
    });
    console.log(reposTable);
    console.log('');
  }

  // Section 4: 12w summary
  const summary = computeSummary(ctx.records, memberName, ctx.currentWeek);
  console.log(
    chalk.dim(
      `12w Summary:  avg ${summary.avgCommits.toFixed(1)} commits/wk \u00B7 ` +
        `${fmt(Math.round(summary.avgInsertions))} +lines/wk \u00B7 ` +
        `${Math.round(summary.testRatio)}% test ratio`,
    ),
  );
  console.log('');

  // Hotkey bar
  console.log(renderHotkeyBar([
    { key: 'B', label: `Back to ${teamName}` },
    { key: 'Q', label: 'Quit' },
  ]));

  // Wait for keypress
  try {
    const key = await readKey();

    if (key.name === 'b') return { type: 'pop' };
    if (key.name === 'q') return { type: 'quit' };
  } catch {
    return { type: 'quit' };
  }

  return { type: 'pop' };
}
