import chalk from 'chalk';
import type { ViewContext, NavigationAction } from './types.js';
import type { UserWeekRepoRecord } from '../types/schema.js';
import { renderBanner } from '../ui/banner.js';
import { renderGroupedHBarChart } from '../ui/grouped-hbar-chart.js';
import type { HBarGroup } from '../ui/grouped-hbar-chart.js';
import { renderLineChart } from '../ui/line-chart.js';
import { renderLegend } from '../ui/legend.js';
import { renderHotkeyBar } from '../ui/tab-bar.js';
import { readKey, readKeyWithTimeout } from '../ui/keypress.js';
import { sparkline } from '../ui/sparkline.js';
import { rollup } from '../aggregator/engine.js';
import { filterRecords, getLastNWeeks } from '../aggregator/filters.js';
import { computeTrend, computeRunningAvg } from '../aggregator/trends.js';
import { SEGMENT_DEFS } from '../ui/constants.js';
import { fmt, weekShort, padRight } from '../ui/format.js';

type TrendsExpandMode = 'org' | 'team' | 'tag';

/**
 * Build line chart series for commits/week, one series per group.
 */
function buildCommitsSeries(
  records: UserWeekRepoRecord[],
  currentWeek: string,
  mode: TrendsExpandMode,
  config: ViewContext['config'],
) {
  const weeks = getLastNWeeks(12, currentWeek);
  const colors = [chalk.green, chalk.blue, chalk.yellow, chalk.magenta, chalk.cyan, chalk.red];
  const series: Array<{
    label: string;
    color: (s: string) => string;
    values: number[];
    style: 'solid' | 'dotted';
  }> = [];

  if (mode === 'org') {
    config.orgs.forEach((org, i) => {
      const orgRecords = filterRecords(records, { org: org.name });
      const values = weeks.map((week) => {
        const weekRecords = orgRecords.filter((r) => r.week === week);
        return weekRecords.reduce((sum, r) => sum + r.commits, 0);
      });
      series.push({
        label: org.name,
        color: colors[i % colors.length],
        values,
        style: org.type === 'core' ? 'solid' : 'dotted',
      });
    });
  } else if (mode === 'team') {
    let colorIdx = 0;
    for (const org of config.orgs) {
      for (const team of org.teams) {
        const teamRecords = filterRecords(records, { team: team.name });
        const values = weeks.map((week) => {
          const weekRecords = teamRecords.filter((r) => r.week === week);
          return weekRecords.reduce((sum, r) => sum + r.commits, 0);
        });
        series.push({
          label: team.name,
          color: colors[colorIdx % colors.length],
          values,
          style: org.type === 'core' ? 'solid' : 'dotted',
        });
        colorIdx++;
      }
    }
  } else {
    // tag mode
    const tagSet = new Set<string>();
    for (const org of config.orgs) {
      for (const team of org.teams) {
        tagSet.add(team.tag);
      }
    }
    const tags = [...tagSet];
    tags.forEach((tag, i) => {
      const tagRecords = filterRecords(records, { tag });
      const values = weeks.map((week) => {
        const weekRecords = tagRecords.filter((r) => r.week === week);
        return weekRecords.reduce((sum, r) => sum + r.commits, 0);
      });
      series.push({
        label: config.tags?.[tag]?.label ?? tag,
        color: colors[i % colors.length],
        values,
        style: 'solid',
      });
    });
  }

  return { series, xLabels: weeks.map(weekShort) };
}

/**
 * Build 12-week file type breakdown bars.
 */
function buildFileTypeBreakdownBars(
  records: UserWeekRepoRecord[],
  currentWeek: string,
  mode: TrendsExpandMode,
  config: ViewContext['config'],
): HBarGroup[] {
  const weeks = getLastNWeeks(12, currentWeek);
  const groups: HBarGroup[] = [];

  for (const week of weeks) {
    const weekRecords = filterRecords(records, { weeks: [week] });
    const bars: Array<{
      label: string;
      orgType?: 'core' | 'consultant';
      segments: Array<{ key: string; value: number }>;
      total: number;
    }> = [];

    if (mode === 'org') {
      const rolled = rollup(weekRecords, (r) => r.org);
      for (const org of config.orgs) {
        const agg = rolled.get(org.name);
        if (!agg) continue;
        bars.push({
          label: org.name,
          orgType: org.type,
          segments: [
            { key: 'app', value: agg.filetype.app.insertions + agg.filetype.app.deletions },
            { key: 'test', value: agg.filetype.test.insertions + agg.filetype.test.deletions },
            { key: 'config', value: agg.filetype.config.insertions + agg.filetype.config.deletions },
            { key: 'storybook', value: agg.filetype.storybook.insertions + agg.filetype.storybook.deletions },
            { key: 'doc', value: agg.filetype.doc.insertions + agg.filetype.doc.deletions },
          ],
          total: agg.insertions + agg.deletions,
        });
      }
    } else if (mode === 'team') {
      for (const org of config.orgs) {
        const orgRecords = filterRecords(weekRecords, { org: org.name });
        const rolled = rollup(orgRecords, (r) => r.team);
        for (const team of org.teams) {
          const agg = rolled.get(team.name);
          if (!agg) continue;
          bars.push({
            label: team.name,
            orgType: org.type,
            segments: [
              { key: 'app', value: agg.filetype.app.insertions + agg.filetype.app.deletions },
              { key: 'test', value: agg.filetype.test.insertions + agg.filetype.test.deletions },
              { key: 'config', value: agg.filetype.config.insertions + agg.filetype.config.deletions },
              { key: 'storybook', value: agg.filetype.storybook.insertions + agg.filetype.storybook.deletions },
            ],
            total: agg.insertions + agg.deletions,
          });
        }
      }
    } else {
      const rolled = rollup(weekRecords, (r) => r.tag);
      const tagSet = new Set<string>();
      for (const org of config.orgs) {
        for (const team of org.teams) tagSet.add(team.tag);
      }
      for (const tag of tagSet) {
        const agg = rolled.get(tag);
        if (!agg) continue;
        bars.push({
          label: config.tags?.[tag]?.label ?? tag,
          segments: [
            { key: 'app', value: agg.filetype.app.insertions + agg.filetype.app.deletions },
            { key: 'test', value: agg.filetype.test.insertions + agg.filetype.test.deletions },
            { key: 'config', value: agg.filetype.config.insertions + agg.filetype.config.deletions },
            { key: 'storybook', value: agg.filetype.storybook.insertions + agg.filetype.storybook.deletions },
            { key: 'doc', value: agg.filetype.doc.insertions + agg.filetype.doc.deletions },
          ],
          total: agg.insertions + agg.deletions,
        });
      }
    }

    groups.push({ groupLabel: weekShort(week), bars });
  }

  return groups;
}

/**
 * Build avg output sparklines per team.
 */
function buildAvgOutputSparklines(
  records: UserWeekRepoRecord[],
  currentWeek: string,
  config: ViewContext['config'],
): string {
  const weeks = getLastNWeeks(12, currentWeek);
  const lines: string[] = [];

  for (const org of config.orgs) {
    for (const team of org.teams) {
      const teamRecords = filterRecords(records, { team: team.name });

      // Per-week avg per person
      const weeklyAvgs: number[] = [];
      for (const week of weeks) {
        const weekRecords = teamRecords.filter((r) => r.week === week);
        const members = new Set(weekRecords.map((r) => r.member));
        let total = 0;
        for (const r of weekRecords) {
          total +=
            r.filetype.app.insertions + r.filetype.app.deletions +
            r.filetype.test.insertions + r.filetype.test.deletions +
            r.filetype.config.insertions + r.filetype.config.deletions +
            r.filetype.storybook.insertions + r.filetype.storybook.deletions +
            (r.filetype.doc?.insertions ?? 0) + (r.filetype.doc?.deletions ?? 0);
        }
        weeklyAvgs.push(members.size > 0 ? total / members.size : 0);
      }

      const avgOverall =
        weeklyAvgs.reduce((sum, v) => sum + v, 0) /
        Math.max(1, weeklyAvgs.filter((v) => v > 0).length);
      const runningAvg = computeRunningAvg(records, team.name, currentWeek, 12);

      const spark = sparkline(weeklyAvgs);
      const avgStr = fmt(Math.round(avgOverall));
      const runAvgStr = fmt(Math.round(runningAvg));

      lines.push(
        `  ${padRight(team.name, 14)} ${spark}  avg: ${avgStr}/person/wk  ${chalk.white.bold('\u25C8')} ${runAvgStr}`,
      );
    }
  }

  return lines.join('\n');
}

/**
 * Compute the overall test ratio and trend direction.
 */
function computeTestRatioTrend(
  records: UserWeekRepoRecord[],
  currentWeek: string,
): { ratio: number; sparkValues: number[]; direction: string } {
  const weeks = getLastNWeeks(12, currentWeek);
  const ratios: number[] = [];

  for (const week of weeks) {
    const weekRecords = records.filter((r) => r.week === week);
    let app = 0;
    let test = 0;
    for (const r of weekRecords) {
      app += r.filetype.app.insertions + r.filetype.app.deletions;
      test += r.filetype.test.insertions + r.filetype.test.deletions;
    }
    const denominator = app + test;
    ratios.push(denominator === 0 ? 0 : test / denominator);
  }

  const currentRatio = ratios.length > 0 ? ratios[ratios.length - 1] : 0;

  // Determine trend direction based on last few weeks
  let direction = '\u2192'; // flat arrow
  if (ratios.length >= 3) {
    const recent = ratios.slice(-3);
    const avg = recent.reduce((s, v) => s + v, 0) / recent.length;
    const earlier = ratios.slice(0, 3);
    const earlierAvg = earlier.reduce((s, v) => s + v, 0) / earlier.length;
    if (avg > earlierAvg + 0.02) {
      direction = chalk.green('\u25B2'); // up
    } else if (avg < earlierAvg - 0.02) {
      direction = chalk.red('\u25BC'); // down
    }
  }

  return {
    ratio: currentRatio,
    sparkValues: ratios,
    direction,
  };
}

/**
 * Trends view - full trends deep dive.
 *
 * Shows:
 * 1. Commits/week line chart
 * 2. 12-week file type breakdown bars
 * 3. Avg output sparklines per team
 * 4. Test ratio sparkline with trend direction
 */
export async function trendsView(ctx: ViewContext): Promise<NavigationAction> {
  let expandMode: TrendsExpandMode = 'org';

  while (true) {
    const termCols = process.stdout.columns || 100;
    const weeks12 = getLastNWeeks(12, ctx.currentWeek);

    process.stdout.write('\x1B[2J\x1B[3J\x1B[H');

    // Banner
    const modeLabel =
      expandMode === 'org'
        ? 'All Orgs'
        : expandMode === 'team'
          ? 'By Team'
          : 'By Tag';
    const banner = renderBanner({
      title: `TRENDS \u2014 ${modeLabel}`,
      right: `${weekShort(weeks12[0])} \u2192 ${weekShort(weeks12[weeks12.length - 1])}`,
    });
    console.log(banner);
    console.log('');

    // Section 1: Commits/week line chart
    const { series, xLabels } = buildCommitsSeries(
      ctx.records,
      ctx.currentWeek,
      expandMode,
      ctx.config,
    );
    if (series.length > 0) {
      console.log(chalk.bold('Commits/week'));
      console.log('');
      const lineChart = renderLineChart({
        series,
        xLabels,
        height: 12,
        width: Math.min(termCols - 10, 60),
        showLegend: true,
      });
      console.log(lineChart);
      console.log('');
    }

    // Section 2: File Type Breakdown - 12 Weeks
    const legend = renderLegend(
      SEGMENT_DEFS.map((d) => ({ label: d.label, color: d.color, char: d.char })),
      { inline: true },
    );
    console.log(chalk.bold('File Type Breakdown \u2014 12 Weeks') + '  ' + legend);
    console.log('');

    const breakdownGroups = buildFileTypeBreakdownBars(
      ctx.records,
      ctx.currentWeek,
      expandMode,
      ctx.config,
    );
    const barChart = renderGroupedHBarChart({
      groups: breakdownGroups,
      segmentDefs: SEGMENT_DEFS,
      maxWidth: termCols,
      showValues: true,
    });
    console.log(barChart);
    console.log('');

    // Section 3: Avg Output per Person (12w sparklines)
    console.log(
      chalk.bold('Avg Output per Person (12w sparklines)') +
        '  ' +
        chalk.white.bold('\u25C8') +
        chalk.dim(' = 3-month running avg'),
    );
    console.log('');
    const sparkOutput = buildAvgOutputSparklines(
      ctx.records,
      ctx.currentWeek,
      ctx.config,
    );
    console.log(sparkOutput);
    console.log('');

    // Section 4: Test Ratio
    const testRatio = computeTestRatioTrend(ctx.records, ctx.currentWeek);
    const ratioSpark = sparkline(testRatio.sparkValues);
    console.log(
      `Test Ratio:    ${Math.round(testRatio.ratio * 100)}% ${ratioSpark}   trending ${testRatio.direction}`,
    );
    console.log('');

    // Hotkey bar
    const hotkeys: Array<{ key: string; label: string }> = [];
    if (expandMode !== 'team') hotkeys.push({ key: 'E', label: 'By team' });
    if (expandMode !== 'tag') hotkeys.push({ key: 'G', label: 'By tag' });
    if (expandMode !== 'org') hotkeys.push({ key: 'O', label: 'By org' });
    hotkeys.push({ key: 'B', label: 'Back' });
    hotkeys.push({ key: 'Q', label: 'Quit' });
    console.log(renderHotkeyBar(hotkeys));

    // Wait for keypress (with timeout to poll for external DB changes)
    try {
      const POLL_INTERVAL_MS = 5_000;
      const key = ctx.onRefreshData
        ? await readKeyWithTimeout(POLL_INTERVAL_MS)
        : await readKey();

      // Timeout — check for external DB changes, then re-render
      if (key === null) {
        ctx.onRefreshData?.();
        continue;
      }

      if (key.name === 'e' && expandMode !== 'team') { expandMode = 'team'; continue; }
      if (key.name === 'g' && expandMode !== 'tag') { expandMode = 'tag'; continue; }
      if (key.name === 'o' && expandMode !== 'org') { expandMode = 'org'; continue; }
      if (key.name === 'b') return { type: 'pop' };
      if (key.name === 'q') return { type: 'quit' };
    } catch {
      return { type: 'quit' };
    }
  }
}
