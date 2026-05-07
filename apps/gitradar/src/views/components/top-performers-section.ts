import chalk from 'chalk';
import type { ViewContext } from '../types.js';
import type { UserWeekRepoRecord } from '../../types/schema.js';
import { renderLegend } from '../../ui/legend.js';
import { stackedBar } from '../../ui/bar.js';
import { computeLeaderboard } from '../../aggregator/leaderboard.js';
import { getLastNWeeks } from '../../aggregator/filters.js';
import { SEGMENT_DEFS, FILETYPE_COLORS, FILETYPE_CHARS } from '../../ui/constants.js';
import { fmt, weekShort, padRight, padLeft } from '../../ui/format.js';

type WindowSize = 4 | 8 | 12;

const legend = renderLegend(
  SEGMENT_DEFS.map((d) => ({ label: d.label, color: d.color, char: d.char })),
  { inline: true },
);

export function renderLeaderboard(
  records: UserWeekRepoRecord[],
  currentWeek: string,
  windowWeeks: WindowSize,
): string {
  const weeks = getLastNWeeks(windowWeeks, currentWeek);
  const columns = computeLeaderboard(records, weeks, 5);
  if (columns.length === 0) return '';

  const lines: string[] = [];
  lines.push(
    chalk.bold(`Top Performers (${weekShort(weeks[0])} \u2192 ${weekShort(weeks[weeks.length - 1])})`) +
      '  ' + legend,
  );
  lines.push('');

  const colWidth = 24;
  const headers = columns.map((c) => padRight(chalk.bold(c.title), colWidth));
  lines.push(headers.join(chalk.dim(' | ')));
  const sep = columns.map(() => '\u2500'.repeat(colWidth)).join(chalk.dim('-+-'));
  lines.push(chalk.dim(sep));

  const maxEntries = Math.max(...columns.map((c) => c.entries.length));
  for (let i = 0; i < maxEntries; i++) {
    const nameParts = columns.map((col) => {
      const entry = col.entries[i];
      if (!entry) return padRight('', colWidth);
      const combined = `${entry.rank}. ` + entry.member;
      return padRight(combined, colWidth - 6) + padLeft(fmt(entry.value), 6);
    });
    lines.push(nameParts.join(chalk.dim(' | ')));

    const barParts = columns.map((col) => {
      const entry = col.entries[i];
      if (!entry) return padRight('', colWidth);
      const teamStr = '   ' + chalk.dim(entry.team) + ' ';
      const barWidth = 10;
      let bar: string;
      if (col.metric === 'all') {
        bar = stackedBar(
          [
            { value: entry.filetype.app, color: FILETYPE_COLORS.app, char: FILETYPE_CHARS.app },
            { value: entry.filetype.test, color: FILETYPE_COLORS.test, char: FILETYPE_CHARS.test },
            { value: entry.filetype.config, color: FILETYPE_COLORS.config, char: FILETYPE_CHARS.config },
            { value: entry.filetype.storybook, color: FILETYPE_COLORS.storybook, char: FILETYPE_CHARS.storybook },
            { value: entry.filetype.doc, color: FILETYPE_COLORS.doc, char: FILETYPE_CHARS.doc },
          ],
          barWidth,
        );
      } else {
        const colorFn = FILETYPE_COLORS[col.metric as keyof typeof FILETYPE_COLORS];
        const ch = FILETYPE_CHARS[col.metric as keyof typeof FILETYPE_CHARS];
        const maxVal = Math.max(...col.entries.map((e) => e.value), 1);
        const w = Math.max(1, Math.round((entry.value / maxVal) * barWidth));
        bar = colorFn(ch.repeat(w));
      }
      return teamStr + bar;
    });
    lines.push(barParts.join(chalk.dim(' | ')));
  }

  return lines.join('\n');
}

export function renderTopPerformersTab(ctx: ViewContext, windowWeeks: WindowSize): void {
  const output = renderLeaderboard(ctx.records, ctx.currentWeek, windowWeeks);
  if (output) {
    console.log(output);
  } else {
    console.log(chalk.dim('  No data for this time window.'));
  }
}
