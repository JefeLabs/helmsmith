import chalk from "chalk";
import { fmt, stripAnsi, padRight, padLeft } from "../ui/format.js";
import { sparkline } from "../ui/sparkline.js";

export interface HBar {
  label: string;
  orgType?: "core" | "consultant";
  segments: { key: string; value: number }[];
  total: number;
  insertions?: number;
  deletions?: number;
  avg?: number;
  avgInsertions?: number;
  avgDeletions?: number;
  avgNet?: number;
  avgCommits?: number;
  avgActiveDays?: number;
  avgHeadcount?: number;
  commits?: number;
  activeDays?: number;
  headcount?: number;
  perception?: string;
  testPct?: number;
  avgTestPct?: number;
  isAverage?: boolean;
  sparkData?: number[];
}

export interface HBarGroup {
  groupLabel: string;
  bars: HBar[];
  separatorAfter?: number[];
  isSummary?: boolean;
}

export interface SegmentDef {
  key: string;
  label: string;
  char: string;
  color: (s: string) => string;
}

export interface GroupedHBarChartOptions {
  groups: HBarGroup[];
  segmentDefs: SegmentDef[];
  labelWidth?: number;
  maxBarWidth?: number;
  showValues?: boolean;
  showXAxis?: boolean;
  showLegend?: boolean;
  maxWidth?: number;
  trendThreshold?: number;
}

/**
 * Render a grouped stacked horizontal bar chart.
 *
 * Each group (e.g. a week) has a group label with a `\u2524` axis char,
 * followed by bars indented below. Core teams are prefixed with \u2605,
 * consultant with \u25C6. Dashed separators appear after specified bar indices.
 */
export function renderGroupedHBarChart(
  options: GroupedHBarChartOptions
): string {
  const {
    groups,
    segmentDefs,
    labelWidth: explicitLabelWidth,
    maxBarWidth = 50,
    showValues = true,
    showXAxis = false,
    maxWidth = 100,
    trendThreshold = 0.10,
  } = options;

  if (groups.length === 0) {
    return "";
  }

  // Auto-compute group label width from actual group labels (bucket timeframe column)
  let glw = 0;
  for (const g of groups) {
    if (g.groupLabel.length > glw) glw = g.groupLabel.length;
  }
  glw = Math.max(4, glw + 1);

  // Auto-compute bar label width from actual bar labels (with org-type prefix)
  let labelWidth = explicitLabelWidth ?? 14;
  if (explicitLabelWidth === undefined) {
    let maxLabel = 0;
    for (const g of groups) {
      for (const b of g.bars) {
        let len = b.label.length;
        if (b.orgType) len += 2; // "★ " or "◆ " prefix
        if (len > maxLabel) maxLabel = len;
      }
    }
    labelWidth = Math.max(10, maxLabel + 1);
  }

  // Compute globalMax across all bars for consistent scale
  const globalMax = Math.max(
    1,
    ...groups.flatMap((g) => g.bars.map((b) => b.total))
  );

  // Calculate available bar width
  // Layout: [groupLabel(glw) ┤] [space] [barLabel(labelWidth)] [space] [bar] [space] [value]
  const valueWidth = showValues ? 8 : 0;
  const gutterWidth = glw + 2 + 1 + labelWidth + 1; // prefix + space + label + space
  const availableBarWidth = Math.min(
    maxBarWidth,
    Math.max(10, maxWidth - gutterWidth - valueWidth - 2)
  );

  // Detect which optional columns exist on any bar (for consistent spacing)
  const hasPerception = groups.some((g) => g.bars.some((b) => b.perception !== undefined));
  const hasTestPct = groups.some((g) => g.bars.some((b) => b.testPct !== undefined));
  const hasCommits = groups.some((g) => g.bars.some((b) => b.commits !== undefined));
  const hasActiveDays = groups.some((g) => g.bars.some((b) => b.activeDays !== undefined));
  const hasHeadcount = groups.some((g) => g.bars.some((b) => b.headcount !== undefined));

  const lines: string[] = [];

  // Column header row (only when showValues and bars have extended data)
  if (showValues && groups.length > 0) {
    const firstBar = groups[0].bars[0];
    if (firstBar?.insertions !== undefined) {
      const headerIndent = " ".repeat(glw + 2) + " " + " ".repeat(labelWidth) + " " + " ".repeat(availableBarWidth);
      let header = headerIndent;
      const T = "  "; // trend spacer (2 chars)
      if (hasPerception) {
        header += " " + padLeft(chalk.dim("trend"), PERCEPTION_WIDTH);
      }
      header += " " + padLeft(chalk.dim("+ins"), 8) + T;
      header += " " + padLeft(chalk.dim("-del"), 8) + T;
      header += " " + padLeft(chalk.dim("net"), 8) + T;
      if (hasTestPct) {
        header += " " + padLeft(chalk.dim("tst%"), 5) + T;
      }
      if (hasCommits) {
        header += " " + padLeft(chalk.dim("cmts"), 6) + T;
      }
      if (hasActiveDays) {
        header += " " + padLeft(chalk.dim("days"), 6) + T;
      }
      if (hasHeadcount) {
        header += " " + padLeft(chalk.dim("hc"), 6);
        header += " " + padLeft(chalk.dim("+ins/u"), 7) + T;
        header += " " + padLeft(chalk.dim("-del/u"), 7) + T;
        header += " " + padLeft(chalk.dim("net/u"), 7) + T;
        if (hasCommits) {
          header += " " + padLeft(chalk.dim("cmt/u"), 6) + T;
        }
        if (hasActiveDays) {
          header += " " + padLeft(chalk.dim("day/u"), 6) + T;
        }
      }
      lines.push(header);
    }
  }

  for (let gi = 0; gi < groups.length; gi++) {
    const group = groups[gi];

    for (let bi = 0; bi < group.bars.length; bi++) {
      const bar = group.bars[bi];

      // Build prefix: group label with axis char on first bar, indent on rest
      let prefix: string;
      if (bi === 0) {
        prefix = padRight(group.groupLabel, glw) + " \u2524";
      } else {
        prefix = " ".repeat(glw) + " \u2502";
      }

      // Build bar label with org type prefix
      let barLabel = bar.label;
      if (bar.orgType === "core") {
        barLabel = "\u2605 " + barLabel;
      } else if (bar.orgType === "consultant") {
        barLabel = "\u25C6 " + barLabel;
      }

      // Render the stacked bar
      const barChars = renderBar(
        bar.segments,
        bar.total,
        globalMax,
        availableBarWidth,
        segmentDefs
      );

      // Pad bar area to fixed width so value columns align
      const barVisualWidth = stripAnsi(barChars).length;
      const barPad = Math.max(0, availableBarWidth - barVisualWidth);

      // Build the line
      let line =
        prefix + " " + padRight(barLabel, labelWidth) + " " +
        barChars + " ".repeat(barPad);

      if (showValues) {
        const isAvg = bar.isAverage === true;
        // For average rows: use chalk.dim for all values, skip trend indicators
        const trendFn = isAvg
          ? () => "  "
          : (v: number, a: number | undefined) => trend(v, a, trendThreshold);
        const valColor = isAvg ? chalk.dim : (s: string) => s;

        // Columns: +ins ▲/▼  -del  net ▲/▼  (hc)  +ins/u  -del/u  net/u
        if (bar.insertions !== undefined && bar.deletions !== undefined) {
          const net = bar.insertions - bar.deletions;

          // perception / sparkline (first after bar — headline summary)
          if (hasPerception) {
            if (isAvg && bar.sparkData && bar.sparkData.length > 0) {
              line += " " + padLeft(chalk.dim(sparkline(bar.sparkData)), PERCEPTION_WIDTH);
            } else if (bar.perception) {
              line += " " + formatPerception(bar.perception);
            } else {
              line += " " + " ".repeat(PERCEPTION_WIDTH);
            }
          }

          // +ins
          line += " " + padLeft(valColor(chalk.green("+" + fmt(bar.insertions))), 8);
          line += trendFn(bar.insertions, bar.avgInsertions);

          // -del
          line += " " + padLeft(valColor(chalk.red("-" + fmt(bar.deletions))), 8);
          line += trendFn(bar.deletions, bar.avgDeletions);

          // net
          const netStr = net >= 0 ? "+" + fmt(net) : "-" + fmt(Math.abs(net));
          const netColor = net >= 0 ? chalk.green : chalk.red;
          line += " " + padLeft(valColor(netColor(netStr)), 8);
          line += trendFn(net, bar.avgNet);

          // test%
          if (hasTestPct) {
            if (bar.testPct !== undefined) {
              line += " " + padLeft(chalk.dim(bar.testPct + "%"), 5);
              line += trendFn(bar.testPct, bar.avgTestPct);
            } else {
              line += " " + " ".repeat(5) + "  ";
            }
          }

          // commits
          if (hasCommits) {
            line += " " + padLeft(chalk.dim(fmt(bar.commits ?? 0)), 6);
            line += trendFn(bar.commits ?? 0, bar.avgCommits);
          }

          // active days
          if (hasActiveDays) {
            line += " " + padLeft(chalk.dim(fmt(bar.activeDays ?? 0)), 6);
            line += trendFn(bar.activeDays ?? 0, bar.avgActiveDays);
          }

          // headcount + per-user averages
          if (hasHeadcount && bar.headcount !== undefined && bar.headcount > 0) {
            const hc = bar.headcount;
            const avgHc = bar.avgHeadcount ?? hc;
            line += " " + padLeft(chalk.dim(`(${hc})`), 6);

            const insPerUser = Math.round(bar.insertions / hc);
            const delPerUser = Math.round(bar.deletions / hc);
            const netPerUser = Math.round(net / hc);
            const avgInsPerUser = avgHc > 0 ? (bar.avgInsertions ?? 0) / avgHc : undefined;
            const avgDelPerUser = avgHc > 0 ? (bar.avgDeletions ?? 0) / avgHc : undefined;
            const avgNetPerUser = avgHc > 0 ? (bar.avgNet ?? 0) / avgHc : undefined;

            line += " " + padLeft(chalk.dim("+" + fmt(insPerUser)), 7);
            line += trendFn(insPerUser, avgInsPerUser);
            line += " " + padLeft(chalk.dim("-" + fmt(delPerUser)), 7);
            line += trendFn(delPerUser, avgDelPerUser);
            const npuStr = netPerUser >= 0 ? "+" + fmt(netPerUser) : "-" + fmt(Math.abs(netPerUser));
            line += " " + padLeft(chalk.dim(npuStr), 7);
            line += trendFn(netPerUser, avgNetPerUser);

            if (hasCommits) {
              const cmtsPerUser = Math.round((bar.commits ?? 0) / hc);
              const avgCmtsPerUser = avgHc > 0 ? (bar.avgCommits ?? 0) / avgHc : undefined;
              line += " " + padLeft(chalk.dim(fmt(cmtsPerUser)), 6);
              line += trendFn(cmtsPerUser, avgCmtsPerUser);
            }
            if (hasActiveDays) {
              const daysPerUser = +((bar.activeDays ?? 0) / hc).toFixed(1);
              const avgDaysPerUser = avgHc > 0 ? (bar.avgActiveDays ?? 0) / avgHc : undefined;
              line += " " + padLeft(chalk.dim(String(daysPerUser)), 6);
              line += trendFn(daysPerUser, avgDaysPerUser);
            }
          }
        } else {
          line += " " + padLeft(chalk.dim(fmt(bar.total)), 8);
        }
      }

      lines.push(line);

      // Check for separator after this bar index
      if (group.separatorAfter?.includes(bi)) {
        const separatorIndent = " ".repeat(glw) + " \u2502";
        const dashes = "\u2500 ".repeat(
          Math.floor(availableBarWidth / 2)
        );
        lines.push(
          separatorIndent +
            " " +
            " ".repeat(labelWidth) +
            " " +
            chalk.dim(dashes)
        );
      }
    }

    // Separator between groups
    if (gi < groups.length - 1) {
      const nextGroup = groups[gi + 1];
      if (nextGroup.isSummary) {
        // Dashed separator before summary (Avg) row
        const sepPrefix = " ".repeat(glw) + " \u2502";
        const dashes = "\u2500\u2500".repeat(Math.floor((availableBarWidth + labelWidth) / 2));
        lines.push(sepPrefix + " " + chalk.dim(dashes));
      } else {
        const blankPrefix = " ".repeat(glw) + " \u2502";
        lines.push(blankPrefix);
      }
    }
  }

  // X-axis
  if (showXAxis) {
    const axisIndent = " ".repeat(glw) + " \u2514";
    const axisLine =
      "\u2500".repeat(availableBarWidth + labelWidth + 1) + "\u2524";
    lines.push(axisIndent + axisLine);

    // Scale labels
    const scaleIndent = " ".repeat(glw + 2 + 1 + labelWidth);
    const zeroLabel = "0";
    const midValue = globalMax / 2;
    const maxValue = globalMax;
    const midPos = Math.floor(availableBarWidth / 2);

    let scaleLine = scaleIndent + zeroLabel;
    const midLabel = fmt(midValue);
    const maxLabel = fmt(maxValue);
    scaleLine += " ".repeat(Math.max(1, midPos - zeroLabel.length));
    scaleLine += midLabel;
    scaleLine += " ".repeat(
      Math.max(1, availableBarWidth - midPos - midLabel.length)
    );
    scaleLine += maxLabel;
    lines.push(scaleLine);
  }

  return lines.join("\n");
}

/**
 * Render a trend indicator comparing a value to its average.
 * Returns " ▲", " ▼", or " ○" (2 chars for alignment).
 */
function trend(value: number, avg: number | undefined, pct: number): string {
  if (avg === undefined) return "  ";
  const delta = value - avg;
  const threshold = Math.abs(avg) * pct;
  if (delta > threshold) return " " + chalk.green("\u25B2");
  if (delta < -threshold) return " " + chalk.red("\u25BC");
  return " " + chalk.dim("\u25CB");
}

const PERCEPTION_WIDTH = 14;

const PERCEPTION_STYLES: Record<string, (s: string) => string> = {
  accelerating: chalk.green,
  recovering: chalk.green,
  stable: chalk.dim,
  slowing: chalk.yellow,
  dipping: chalk.red,
  new: chalk.dim,
};

const PERCEPTION_ICONS: Record<string, string> = {
  accelerating: '\u2197',  // ↗
  recovering: '\u21AA',    // ↪
  stable: '\u2192',        // →
  slowing: '\u2198',       // ↘
  dipping: '\u2199',       // ↙
  new: '\u2022',           // •
};

function formatPerception(perception: string): string {
  const icon = PERCEPTION_ICONS[perception] ?? '';
  const colorFn = PERCEPTION_STYLES[perception] ?? chalk.dim;
  return padLeft(colorFn(`${icon} ${perception}`), PERCEPTION_WIDTH);
}

/**
 * Render a single stacked bar as colored characters.
 * Each segment gets proportional width. Non-zero segments get minimum 1 char.
 */
function renderBar(
  segments: { key: string; value: number }[],
  total: number,
  globalMax: number,
  maxWidth: number,
  segmentDefs: SegmentDef[]
): string {
  if (total === 0 || globalMax === 0) {
    return "";
  }

  // Total bar width proportional to globalMax
  const totalBarWidth = Math.max(1, Math.round((total / globalMax) * maxWidth));

  // Build segment char widths
  const activeSegments = segments.filter((s) => s.value > 0);

  if (activeSegments.length === 0) {
    return "";
  }

  // Calculate raw proportional widths within the bar
  const rawWidths = activeSegments.map(
    (s) => (s.value / total) * totalBarWidth
  );

  // Ensure minimum of 1 char per non-zero segment
  const charWidths = rawWidths.map((raw) => Math.max(1, Math.floor(raw)));

  // Adjust to fill exactly totalBarWidth characters
  let allocated = charWidths.reduce((sum, w) => sum + w, 0);

  if (allocated < totalBarWidth) {
    const remainders = rawWidths.map((raw, i) => ({
      index: i,
      remainder: raw - charWidths[i],
    }));
    remainders.sort((a, b) => b.remainder - a.remainder);

    let remaining = totalBarWidth - allocated;
    for (const entry of remainders) {
      if (remaining <= 0) break;
      charWidths[entry.index]++;
      remaining--;
    }
  } else if (allocated > totalBarWidth) {
    const remainders = rawWidths.map((raw, i) => ({
      index: i,
      remainder: raw - charWidths[i],
    }));
    remainders.sort((a, b) => a.remainder - b.remainder);

    let excess = allocated - totalBarWidth;
    for (const entry of remainders) {
      if (excess <= 0) break;
      if (charWidths[entry.index] > 1) {
        charWidths[entry.index]--;
        excess--;
      }
    }
  }

  // Build the colored bar string
  const defMap = new Map(segmentDefs.map((d) => [d.key, d]));
  const parts = activeSegments.map((seg, i) => {
    const def = defMap.get(seg.key);
    if (!def) {
      return " ".repeat(charWidths[i]);
    }
    return def.color(def.char.repeat(charWidths[i]));
  });

  return parts.join("");
}
