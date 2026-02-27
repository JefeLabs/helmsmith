import chalk from 'chalk';
import type { ViewContext, NavigationAction } from './types.js';
import type { UserWeekRepoRecord } from '../types/schema.js';
import { renderGroupedHBarChart } from '../ui/grouped-hbar-chart.js';
import type { HBarGroup, HBar } from '../ui/grouped-hbar-chart.js';
import { renderBanner } from '../ui/banner.js';
import { renderLegend } from '../ui/legend.js';
import { renderHotkeyBar } from '../ui/tab-bar.js';
import { readKey } from '../ui/keypress.js';
import { rollup } from '../aggregator/engine.js';
import { filterRecords, getLastNWeeks } from '../aggregator/filters.js';
import { SEGMENT_DEFS } from '../ui/constants.js';
import { fmt, weekShort } from '../ui/format.js';

type WindowSize = 4 | 8 | 12;

const WINDOW_LABELS: Record<WindowSize, string> = {
  4: '4 weeks',
  8: '8 weeks',
  12: '3 months',
};

/**
 * Build grouped HBar data: one group per repo, one bar per org.
 * Repos are sorted by total activity descending.
 * Within each group, orgs follow config order (core first).
 */
export function buildRepoOrgGroups(
  records: UserWeekRepoRecord[],
  weeks: string[],
  config: ViewContext['config'],
): HBarGroup[] {
  const windowRecords = filterRecords(records, { weeks });

  // Collect all repos with activity, sorted by total descending
  const repoTotals = rollup(windowRecords, (r) => r.repo);
  const sortedRepos = [...repoTotals.entries()]
    .sort((a, b) => (b[1].insertions + b[1].deletions) - (a[1].insertions + a[1].deletions));

  // Find repo group label from config
  const repoGroupMap = new Map<string, string>();
  for (const repo of config.repos) {
    if (repo.name) {
      repoGroupMap.set(repo.name, repo.group);
    }
  }

  const groups: HBarGroup[] = [];

  for (const [repoName] of sortedRepos) {
    const repoRecords = windowRecords.filter((r) => r.repo === repoName);

    const bars: HBar[] = [];
    const separatorAfter: number[] = [];
    let barIndex = 0;

    for (let oi = 0; oi < config.orgs.length; oi++) {
      const org = config.orgs[oi];
      const orgRepoRecords = repoRecords.filter((r) => r.org === org.name);
      const rolled = rollup(orgRepoRecords, () => org.name);
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
        ],
        total: agg.insertions + agg.deletions,
      });
      barIndex++;

      // Separator between core and consultant orgs
      if (oi < config.orgs.length - 1 && barIndex > 0) {
        separatorAfter.push(barIndex - 1);
      }
    }

    if (bars.length === 0) continue;

    const repoGroup = repoGroupMap.get(repoName);
    const groupLabel = repoGroup
      ? `${repoName} ${chalk.dim(`[${repoGroup}]`)}`
      : repoName;

    groups.push({
      groupLabel,
      bars,
      separatorAfter: separatorAfter.length > 0 ? separatorAfter : undefined,
    });
  }

  return groups;
}

/**
 * Repo Activity view — shows which orgs/teams are working on which repos.
 *
 * Grouped bar chart: one group per repo, one bar per org.
 * Time window is configurable via the menu (4w / 8w / 12w).
 */
export async function repoActivityView(ctx: ViewContext): Promise<NavigationAction> {
  let windowWeeks: WindowSize = 12;

  while (true) {
    const termCols = process.stdout.columns || 100;

    const weeks = getLastNWeeks(windowWeeks, ctx.currentWeek);

    process.stdout.write('\x1B[2J\x1B[3J\x1B[H');

    // Banner
    const banner = renderBanner({
      title: 'Repo Activity',
      subtitle: `Organization contributions by repo`,
      right: `${weekShort(weeks[0])} → ${weekShort(weeks[weeks.length - 1])} (${WINDOW_LABELS[windowWeeks]})`,
    });
    console.log(banner);
    console.log('');

    // Chart
    const legend = renderLegend(
      SEGMENT_DEFS.map((d) => ({ label: d.label, color: d.color, char: d.char })),
      { inline: true },
    );
    console.log(
      chalk.bold(`Contribution by Repo (${WINDOW_LABELS[windowWeeks]})`) + '  ' + legend,
    );
    console.log('');

    const groups = buildRepoOrgGroups(ctx.records, weeks, ctx.config);
    const chartOutput = renderGroupedHBarChart({
      groups,
      segmentDefs: SEGMENT_DEFS,
      maxWidth: termCols,
      showValues: true,
      showXAxis: false,
    });
    console.log(chartOutput);
    console.log('');

    // Summary line
    const totalRepos = groups.length;
    const totalLines = groups.reduce(
      (sum, g) => sum + g.bars.reduce((s, b) => s + b.total, 0),
      0,
    );
    console.log(
      chalk.dim(`  ${totalRepos} repos · ${fmt(totalLines)} lines changed over ${WINDOW_LABELS[windowWeeks]}`),
    );
    console.log('');

    // Hotkey bar
    const hotkeys: Array<{ key: string; label: string }> = [];
    if (windowWeeks !== 4) hotkeys.push({ key: '1', label: '4 weeks' });
    if (windowWeeks !== 8) hotkeys.push({ key: '2', label: '8 weeks' });
    if (windowWeeks !== 12) hotkeys.push({ key: '3', label: '3 months' });
    hotkeys.push({ key: 'B', label: 'Back' });
    hotkeys.push({ key: 'Q', label: 'Quit' });
    console.log(renderHotkeyBar(hotkeys));

    // Wait for keypress
    try {
      const key = await readKey();

      if (key.name === '1' && windowWeeks !== 4) { windowWeeks = 4; continue; }
      if (key.name === '2' && windowWeeks !== 8) { windowWeeks = 8; continue; }
      if (key.name === '3' && windowWeeks !== 12) { windowWeeks = 12; continue; }
      if (key.name === 'b') return { type: 'pop' };
      if (key.name === 'q') return { type: 'quit' };
    } catch {
      return { type: 'quit' };
    }
  }
}
