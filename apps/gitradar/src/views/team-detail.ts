import chalk from 'chalk';
import type { ViewContext, NavigationAction } from './types.js';
import type { UserWeekRepoRecord } from '../types/schema.js';
import { renderBanner } from '../ui/banner.js';
import { renderAvgOutputChart } from '../ui/avg-output-chart.js';
import type { AvgOutputBar } from '../ui/avg-output-chart.js';
import { renderLineChart } from '../ui/line-chart.js';
import { renderTable } from '../ui/table.js';
import { renderLegend } from '../ui/legend.js';
import { renderHotkeyBar } from '../ui/tab-bar.js';
import { readKey } from '../ui/keypress.js';
import { stackedBar } from '../ui/bar.js';
import { rollup } from '../aggregator/engine.js';
import { filterRecords, getLastNWeeks, computeDeltas } from '../aggregator/filters.js';
import { computeRunningAvg } from '../aggregator/trends.js';
import { SEGMENT_DEFS, FILETYPE_COLORS, FILETYPE_CHARS } from '../ui/constants.js';
import { fmt, weekShort, delta } from '../ui/format.js';
import { memberDetailView } from './member-detail.js';

/**
 * Build per-member avg output bars for a team.
 */
function buildMemberAvgBars(
  records: UserWeekRepoRecord[],
  teamName: string,
  currentWeek: string,
): AvgOutputBar[] {
  const weekRecords = filterRecords(records, { weeks: [currentWeek], team: teamName });
  const rolled = rollup(weekRecords, (r) => r.member);
  const bars: AvgOutputBar[] = [];

  for (const [member, agg] of rolled) {
    const totalLines = agg.insertions + agg.deletions;

    // For individual members, running avg is per-person (headcount=1),
    // so we compute it from all their records
    const memberRecords = filterRecords(records, { member, team: teamName });
    const allWeeks = getLastNWeeks(12, currentWeek);
    const windowRecords = memberRecords.filter((r) => allWeeks.includes(r.week));
    const activeWeeks = new Set(windowRecords.map((r) => r.week));
    let windowTotal = 0;
    for (const r of windowRecords) {
      const ft = r.filetype;
      windowTotal +=
        ft.app.insertions + ft.app.deletions +
        ft.test.insertions + ft.test.deletions +
        ft.config.insertions + ft.config.deletions +
        ft.storybook.insertions + ft.storybook.deletions;
    }
    const runningAvg = activeWeeks.size > 0 ? windowTotal / activeWeeks.size : 0;

    bars.push({
      label: member,
      headcount: 1,
      segments: [
        { key: 'app', value: agg.filetype.app.insertions + agg.filetype.app.deletions },
        { key: 'test', value: agg.filetype.test.insertions + agg.filetype.test.deletions },
        { key: 'config', value: agg.filetype.config.insertions + agg.filetype.config.deletions },
        { key: 'storybook', value: agg.filetype.storybook.insertions + agg.filetype.storybook.deletions },
        { key: 'doc', value: agg.filetype.doc.insertions + agg.filetype.doc.deletions },
      ],
      total: totalLines,
      runningAvg,
    });
  }

  // Sort by total descending
  bars.sort((a, b) => b.total - a.total);

  return bars;
}

/**
 * Build member activity line chart data (12 weeks).
 */
function buildMemberActivitySeries(
  records: UserWeekRepoRecord[],
  teamName: string,
  currentWeek: string,
) {
  const weeks = getLastNWeeks(12, currentWeek);
  const teamRecords = filterRecords(records, { team: teamName });
  const members = [...new Set(teamRecords.map((r) => r.member))];

  const colors = [chalk.green, chalk.blue, chalk.yellow, chalk.magenta, chalk.cyan, chalk.red];

  const series = members.map((member, i) => {
    const memberRecords = filterRecords(teamRecords, { member });
    const values = weeks.map((week) => {
      const weekMemberRecords = memberRecords.filter((r) => r.week === week);
      let total = 0;
      for (const r of weekMemberRecords) {
        total += r.filetype.app.insertions + r.filetype.app.deletions +
          r.filetype.test.insertions + r.filetype.test.deletions +
          r.filetype.config.insertions + r.filetype.config.deletions +
          r.filetype.storybook.insertions + r.filetype.storybook.deletions;
      }
      return total;
    });

    return {
      label: member,
      color: colors[i % colors.length],
      values,
      style: 'solid' as const,
    };
  });

  return { series, xLabels: weeks.map(weekShort) };
}

/**
 * Build members table data for the current week.
 */
function buildMembersTableData(
  records: UserWeekRepoRecord[],
  teamName: string,
  currentWeek: string,
) {
  const currentRecords = filterRecords(records, { weeks: [currentWeek], team: teamName });
  const currentRolled = rollup(currentRecords, (r) => r.member);

  // Get previous week for delta
  const prevWeeks = getLastNWeeks(2, currentWeek);
  const prevWeek = prevWeeks.length >= 2 ? prevWeeks[0] : null;
  let prevRolled: Map<string, ReturnType<typeof rollup> extends Map<string, infer V> ? V : never> | null = null;
  if (prevWeek) {
    const prevRecords = filterRecords(records, { weeks: [prevWeek], team: teamName });
    prevRolled = rollup(prevRecords, (r) => r.member);
  }

  const rows: Record<string, any>[] = [];
  for (const [member, agg] of currentRolled) {
    const totalLines = agg.insertions + agg.deletions;
    const prevAgg = prevRolled?.get(member);
    const prevTotal = prevAgg ? prevAgg.insertions + prevAgg.deletions : 0;
    const deltas = prevAgg ? computeDeltas(agg, prevAgg) : null;

    rows.push({
      name: member,
      commits: agg.commits,
      insertions: agg.insertions,
      deletions: agg.deletions,
      net: agg.netLines,
      breakdown: {
        app: agg.filetype.app.insertions + agg.filetype.app.deletions,
        test: agg.filetype.test.insertions + agg.filetype.test.deletions,
        config: agg.filetype.config.insertions + agg.filetype.config.deletions,
        storybook: agg.filetype.storybook.insertions + agg.filetype.storybook.deletions,
        doc: agg.filetype.doc.insertions + agg.filetype.doc.deletions,
      },
      delta: prevTotal > 0 || totalLines > 0 ? delta(totalLines, prevTotal) : chalk.dim('\u2500 0%'),
    });
  }

  // Sort by total lines descending
  rows.sort((a, b) => (b.insertions + b.deletions) - (a.insertions + a.deletions));

  return rows;
}

/**
 * Build repos table data for the current week and team.
 */
function buildReposTableData(
  records: UserWeekRepoRecord[],
  teamName: string,
  currentWeek: string,
) {
  const weekRecords = filterRecords(records, { weeks: [currentWeek], team: teamName });
  const repoRolled = rollup(weekRecords, (r) => r.repo);

  const rows: Record<string, any>[] = [];
  for (const [repo, agg] of repoRolled) {
    // Find top contributor for this repo
    const repoRecords = filterRecords(weekRecords, { group: undefined });
    const repoMemberRecords = repoRecords.filter((r) => r.repo === repo);
    const memberTotals = new Map<string, number>();
    let repoGroup = '';
    for (const r of repoMemberRecords) {
      const total = r.filetype.app.insertions + r.filetype.app.deletions +
        r.filetype.test.insertions + r.filetype.test.deletions +
        r.filetype.config.insertions + r.filetype.config.deletions +
        r.filetype.storybook.insertions + r.filetype.storybook.deletions;
      memberTotals.set(r.member, (memberTotals.get(r.member) ?? 0) + total);
      repoGroup = r.group;
    }
    let topContributor = '';
    let topValue = 0;
    for (const [member, total] of memberTotals) {
      if (total > topValue) {
        topValue = total;
        topContributor = member;
      }
    }

    rows.push({
      repo,
      commits: agg.commits,
      insertions: agg.insertions,
      deletions: agg.deletions,
      topContributor,
      group: repoGroup,
    });
  }

  rows.sort((a, b) => b.commits - a.commits);
  return rows;
}

/**
 * Team detail view - drill-down for a specific team.
 *
 * Shows:
 * 1. Per-member avg output bars with running avg marker
 * 2. 12-week member activity line chart
 * 3. Members table (current week)
 * 4. Repos table (current week)
 */
export async function teamDetailView(
  ctx: ViewContext,
  teamName: string,
): Promise<NavigationAction> {
  const termCols = process.stdout.columns || 100;

  // Find team metadata
  let orgName = '';
  let tag = '';
  for (const org of ctx.config.orgs) {
    for (const team of org.teams) {
      if (team.name === teamName) {
        orgName = org.name;
        tag = team.tag;
      }
    }
  }

  const weeks12 = getLastNWeeks(12, ctx.currentWeek);

  process.stdout.write('\x1B[2J\x1B[3J\x1B[H');

  // Banner
  const banner = renderBanner({
    title: `${teamName.toUpperCase()} \u00B7 ${orgName} \u00B7 ${tag}`,
    right: `${weekShort(weeks12[0])} \u2192 ${weekShort(weeks12[weeks12.length - 1])}`,
  });
  console.log(banner);
  console.log('');

  // Section 1: Per-member avg output bars
  const legend = renderLegend(
    SEGMENT_DEFS.map((d) => ({ label: d.label, color: d.color, char: d.char })),
    { inline: true },
  );
  console.log(
    chalk.bold(`File Type by Member (${weekShort(ctx.currentWeek)})`) + '  ' + legend,
  );
  console.log(chalk.dim('  \u25C8 = 3mo avg'));
  console.log('');

  const memberBars = buildMemberAvgBars(ctx.records, teamName, ctx.currentWeek);
  const avgChart = renderAvgOutputChart({
    bars: memberBars,
    segmentDefs: SEGMENT_DEFS,
    maxWidth: termCols,
    showValues: true,
  });
  console.log(avgChart);
  console.log('');

  // Section 2: Member activity line chart (12 weeks)
  const { series, xLabels } = buildMemberActivitySeries(
    ctx.records,
    teamName,
    ctx.currentWeek,
  );
  if (series.length > 0) {
    console.log(chalk.bold('Member Activity (12 weeks)'));
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
  }

  // Section 3: Members table
  const memberRows = buildMembersTableData(ctx.records, teamName, ctx.currentWeek);
  if (memberRows.length > 0) {
    console.log(chalk.bold(`Members (${weekShort(ctx.currentWeek)})`));
    const membersTable = renderTable({
      columns: [
        { key: 'name', label: 'Name', minWidth: 12 },
        { key: 'commits', label: 'Commits', align: 'right', minWidth: 7 },
        { key: 'insertions', label: '+Ins', align: 'right', minWidth: 6, format: (v) => chalk.green(fmt(v)) },
        { key: 'deletions', label: '-Del', align: 'right', minWidth: 6, format: (v) => chalk.red(fmt(v)) },
        { key: 'net', label: 'Net', align: 'right', minWidth: 6, format: (v) => fmt(v) },
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
      rows: memberRows,
      maxWidth: termCols,
    });
    console.log(membersTable);
    console.log('');
  }

  // Section 4: Repos table
  const repoRows = buildReposTableData(ctx.records, teamName, ctx.currentWeek);
  if (repoRows.length > 0) {
    console.log(chalk.bold(`Repos (${weekShort(ctx.currentWeek)})`));
    const reposTable = renderTable({
      columns: [
        { key: 'repo', label: 'Repo', minWidth: 14 },
        { key: 'commits', label: 'Commits', align: 'right', minWidth: 7 },
        { key: 'insertions', label: '+Ins', align: 'right', minWidth: 6, format: (v) => chalk.green(fmt(v)) },
        { key: 'deletions', label: '-Del', align: 'right', minWidth: 6, format: (v) => chalk.red(fmt(v)) },
        { key: 'topContributor', label: 'Top Contributor', minWidth: 15 },
        { key: 'group', label: 'Group', minWidth: 8 },
      ],
      rows: repoRows,
      maxWidth: termCols,
    });
    console.log(reposTable);
    console.log('');
  }

  // Hotkey bar — number members 1-9 for quick drill-down
  const numberedMembers = memberBars.slice(0, 9).map((b, i) => ({
    key: String(i + 1),
    label: b.label,
  }));
  const hotkeys: Array<{ key: string; label: string }> = [
    ...numberedMembers,
    { key: 'B', label: 'Back' },
    { key: 'Q', label: 'Quit' },
  ];
  console.log(renderHotkeyBar(hotkeys));

  // Wait for keypress
  try {
    const key = await readKey();

    if (key.name === 'b') return { type: 'pop' };
    if (key.name === 'q') return { type: 'quit' };

    // Check numbered member keys
    for (let i = 0; i < numberedMembers.length; i++) {
      if (key.name === String(i + 1)) {
        const memberName = memberBars[i].label;
        return {
          type: 'push',
          view: (c) => memberDetailView(c, memberName, teamName),
        };
      }
    }
  } catch {
    return { type: 'quit' };
  }

  return { type: 'pop' };
}
