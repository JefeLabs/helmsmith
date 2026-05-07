import chalk from 'chalk';
import type { ViewContext } from '../types.js';
import { renderGroupedHBarChart } from '../../ui/grouped-hbar-chart.js';
import { renderLegend } from '../../ui/legend.js';
import { getLastNWeeks } from '../../aggregator/filters.js';
import { SEGMENT_DEFS } from '../../ui/constants.js';
import { fmt, weekShort } from '../../ui/format.js';
import { buildRepoOrgGroups } from '../repo-activity.js';

type WindowSize = 4 | 8 | 12;

const WINDOW_LABELS: Record<WindowSize, string> = {
  4: '4 weeks',
  8: '8 weeks',
  12: '3 months',
};

const legend = renderLegend(
  SEGMENT_DEFS.map((d) => ({ label: d.label, color: d.color, char: d.char })),
  { inline: true },
);

export function renderRepoActivityTab(ctx: ViewContext, windowWeeks: WindowSize, termCols: number): void {
  const weeks = getLastNWeeks(windowWeeks, ctx.currentWeek);
  console.log(
    chalk.bold(`Contribution by Repo`) + '  ' +
    chalk.dim(`(${WINDOW_LABELS[windowWeeks]} \u00b7 ${weekShort(weeks[0])} \u2192 ${weekShort(weeks[weeks.length - 1])})`) +
    '  ' + legend,
  );
  console.log('');
  const groups = buildRepoOrgGroups(ctx.records, weeks, ctx.config);
  console.log(renderGroupedHBarChart({
    groups,
    segmentDefs: SEGMENT_DEFS,
    maxWidth: termCols,
    showValues: true,
    showXAxis: false,
  }));
  const totalRepos = groups.length;
  const totalLines = groups.reduce((sum, g) => sum + g.bars.reduce((s, b) => s + b.total, 0), 0);
  console.log('');
  console.log(chalk.dim(`  ${totalRepos} repos \u00b7 ${fmt(totalLines)} lines changed over ${WINDOW_LABELS[windowWeeks]}`));
}
