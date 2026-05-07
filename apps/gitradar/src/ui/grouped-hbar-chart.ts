import chalk from "chalk";
import { fmt, stripAnsi, padRight, padLeft } from "../ui/format.js";
import { sparkline } from "../ui/sparkline.js";
import { SEGMENT_INDICATORS } from "../ui/constants.js";
import type { Segment } from "../aggregator/segments.js";

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
  /** Team-level averages (set on user-level bars in by-time mode). */
  teamAvgInsertions?: number;
  teamAvgDeletions?: number;
  teamAvgNet?: number;
  teamAvgCommits?: number;
  teamAvgActiveDays?: number;
  teamAvgTestPct?: number;
  commits?: number;
  activeDays?: number;
  headcount?: number;
  perception?: string;
  testPct?: number;
  avgTestPct?: number;
  /** Enrichment fields */
  churnRatePct?: number;
  prsOpened?: number;
  prsMerged?: number;
  avgCycleHrs?: number;
  reviewsGiven?: number;
  avgChurnRatePct?: number;
  avgPrsOpened?: number;
  avgPrsMerged?: number;
  avgAvgCycleHrs?: number;
  avgReviewsGiven?: number;
  teamAvgChurnRatePct?: number;
  teamAvgPrsOpened?: number;
  teamAvgPrsMerged?: number;
  teamAvgAvgCycleHrs?: number;
  teamAvgReviewsGiven?: number;
  isAverage?: boolean;
  sparkData?: number[];
  segment?: Segment;
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

export type DetailLayer = 'lines';
export type ColumnMode = 'compact' | 'lines' | 'commits' | 'prs';

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
  columnMode?: ColumnMode;
  detailLayers?: Set<DetailLayer>;
  perUserMode?: boolean;
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
    columnMode = 'compact',
    detailLayers,
    perUserMode = false,
  } = options;

  // When detailLayers is provided, it takes precedence over columnMode.
  // Compact columns (net, cmts, days) + PRs are always shown when data exists.
  // Lines detail layer adds +ins, -del, tst%, churn.
  const hasLineLayer = detailLayers ? detailLayers.has('lines') : columnMode === 'lines';

  if (groups.length === 0) {
    return "";
  }

  // Auto-compute group label width from actual group labels (bucket timeframe column)
  let glw = 0;
  for (const g of groups) {
    if (g.groupLabel.length > glw) glw = g.groupLabel.length;
  }
  glw = Math.max(4, glw + 1);

  // Auto-compute bar label width from actual bar labels (with org-type + segment prefixes)
  const hasSegments = groups.some((g) => g.bars.some((b) => b.segment !== undefined));
  let labelWidth = explicitLabelWidth ?? 14;
  if (explicitLabelWidth === undefined) {
    let maxLabel = 0;
    for (const g of groups) {
      for (const b of g.bars) {
        let len = b.label.length;
        if (b.segment) len += 2; // "▲ " / "● " / "▼ " prefix
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

  // Detect which optional columns exist on any bar (for consistent spacing)
  const hasPerception = groups.some((g) => g.bars.some((b) => b.perception !== undefined));
  const hasTestPct = groups.some((g) => g.bars.some((b) => b.testPct !== undefined));
  const hasCommits = groups.some((g) => g.bars.some((b) => b.commits !== undefined));
  const hasActiveDays = groups.some((g) => g.bars.some((b) => b.activeDays !== undefined));
  const hasHeadcount = groups.some((g) => g.bars.some((b) => b.headcount !== undefined));
  const hasMultiHeadcount = groups.some((g) => g.bars.some((b) => (b.headcount ?? 0) > 1));
  const hasChurnPct = groups.some((g) => g.bars.some((b) => b.churnRatePct !== undefined));
  const hasPrs = groups.some((g) => g.bars.some((b) => b.prsOpened !== undefined));

  // Derive column visibility from active layers.
  // Compact columns (net, cmts, days) are always shown.
  // Detail layers add extra columns on top.
  const showInsertions = hasLineLayer;
  const showDeletions = hasLineLayer;
  const showNet = true; // always visible (compact base)
  const showTestPct = hasTestPct && hasLineLayer;
  const showChurnPct = hasChurnPct && hasLineLayer;
  const showCommits = hasCommits; // always visible (compact base)
  const showActiveDays = hasActiveDays; // always visible (compact base)
  const showPerception = hasPerception;
  const showHeadcount = hasMultiHeadcount;
  const showPrs = hasPrs; // always visible when enrichment PR data exists

  // Calculate available bar width
  // Layout: [groupLabel(glw) ┤] [space] [barLabel(labelWidth)] [space] [bar] [space] [value]
  const hasExtendedData = groups.some(g => g.bars.some(b => b.insertions !== undefined || b.prsOpened !== undefined));
  let valueWidth = 0;
  if (showValues && hasExtendedData) {
    if (showPerception) valueWidth += 15;
    if (showInsertions) valueWidth += 11;
    if (showDeletions) valueWidth += 11;
    if (showNet) valueWidth += 11;
    if (showTestPct) valueWidth += 8;
    if (showCommits) valueWidth += 9;
    if (showActiveDays) valueWidth += 9;
    if (showChurnPct) valueWidth += 9;
    if (showPrs) valueWidth += 36;                // PRs + merged + cycle + reviews (4 × 9)
    if (showHeadcount) valueWidth += 7;          // "(hc)" column — last
  } else if (showValues) {
    valueWidth = 8;
  }
  const gutterWidth = glw + 2 + 1 + labelWidth + 1; // prefix + space + label + space
  const availableBarWidth = Math.min(
    maxBarWidth,
    Math.max(10, maxWidth - gutterWidth - valueWidth - 2)
  );

  const lines: string[] = [];

  // Column header row (only when showValues and bars have extended data)
  if (showValues && groups.length > 0) {
    const firstBar = groups[0].bars[0];
    if (firstBar?.insertions !== undefined || firstBar?.prsOpened !== undefined) {
      const headerIndent = " ".repeat(glw + 2) + " " + " ".repeat(labelWidth) + " " + " ".repeat(availableBarWidth);
      let header = headerIndent;
      const T = "  "; // trend spacer (2 chars)
      const pu = perUserMode; // shorthand for header labels
      if (showPerception) {
        header += " " + padLeft(chalk.dim("trend"), PERCEPTION_WIDTH);
      }
      if (showInsertions) {
        header += " " + padLeft(chalk.dim(pu ? "+ins/u" : "+ins"), 8) + T;
      }
      if (showDeletions) {
        header += " " + padLeft(chalk.dim(pu ? "-del/u" : "-del"), 8) + T;
      }
      if (showNet) {
        header += " " + padLeft(chalk.dim(pu ? "net/u" : "net"), 8) + T;
      }
      if (showTestPct) {
        header += " " + padLeft(chalk.dim("tst%"), 5) + T;
      }
      if (showCommits) {
        header += " " + padLeft(chalk.dim(pu ? "cmt/u" : "cmts"), 6) + T;
      }
      if (showActiveDays) {
        header += " " + padLeft(chalk.dim(pu ? "day/u" : "days"), 6) + T;
      }
      if (showChurnPct) {
        header += " " + padLeft(chalk.dim("churn"), 6) + T;
      }
      if (showPrs) {
        header += " " + padLeft(chalk.dim(pu ? "PRs/u" : "PRs"), 6) + T;
        header += " " + padLeft(chalk.dim(pu ? "mrg/u" : "merged"), 6) + T;
        header += " " + padLeft(chalk.dim("cycle"), 6) + T;
        header += " " + padLeft(chalk.dim(pu ? "rev/u" : "reviews"), 7) + T;
      }
      if (showHeadcount) {
        header += " " + padLeft(chalk.dim("hc"), 6);
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

      // Build bar label with segment + org type prefixes
      let barLabel = bar.label;
      if (bar.orgType === "core") {
        barLabel = "\u2605 " + barLabel;
      } else if (bar.orgType === "consultant") {
        barLabel = "\u25C6 " + barLabel;
      }
      if (bar.segment) {
        const ind = SEGMENT_INDICATORS[bar.segment];
        barLabel = ind.color(ind.char) + " " + barLabel;
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
          : (v: number, a: number | undefined, ta?: number) => trend(v, a, trendThreshold, ta);
        const valColor = isAvg ? chalk.dim : (s: string) => s;

        if ((bar.insertions !== undefined && bar.deletions !== undefined) || bar.prsOpened !== undefined) {
          // Per-user divisor: divide by headcount when perUserMode is active and hc > 1
          const pu = perUserMode && (bar.headcount ?? 0) > 1 ? bar.headcount! : 1;
          const avgPu = perUserMode && (bar.avgHeadcount ?? 0) > 1 ? bar.avgHeadcount! : 1;

          const ins = Math.round((bar.insertions ?? 0) / pu);
          const del = Math.round((bar.deletions ?? 0) / pu);
          const net = ins - del;
          const cmts = Math.round((bar.commits ?? 0) / pu);
          const days = +((bar.activeDays ?? 0) / pu).toFixed(1);

          const avgIns = bar.avgInsertions !== undefined ? bar.avgInsertions / avgPu : undefined;
          const avgDel = bar.avgDeletions !== undefined ? bar.avgDeletions / avgPu : undefined;
          const avgNet = bar.avgNet !== undefined ? bar.avgNet / avgPu : undefined;
          const avgCmts = bar.avgCommits !== undefined ? bar.avgCommits / avgPu : undefined;
          const avgDays = bar.avgActiveDays !== undefined ? bar.avgActiveDays / avgPu : undefined;
          const teamAvgIns = bar.teamAvgInsertions;
          const teamAvgDel = bar.teamAvgDeletions;
          const teamAvgNet = bar.teamAvgNet;
          const teamAvgCmts = bar.teamAvgCommits;
          const teamAvgDays = bar.teamAvgActiveDays;

          // perception / sparkline
          if (showPerception) {
            if (isAvg && bar.sparkData && bar.sparkData.length > 0) {
              line += " " + padLeft(chalk.dim(sparkline(bar.sparkData)), PERCEPTION_WIDTH);
            } else if (bar.perception) {
              line += " " + formatPerception(bar.perception);
            } else {
              line += " " + " ".repeat(PERCEPTION_WIDTH);
            }
          }

          // +ins
          if (showInsertions) {
            line += " " + padLeft(valColor(chalk.green("+" + fmt(ins))), 8);
            line += trendFn(ins, avgIns, teamAvgIns);
          }

          // -del
          if (showDeletions) {
            line += " " + padLeft(valColor(chalk.red("-" + fmt(del))), 8);
            line += trendFn(del, avgDel, teamAvgDel);
          }

          // net
          if (showNet) {
            const netStr = net >= 0 ? "+" + fmt(net) : "-" + fmt(Math.abs(net));
            const netColor = net >= 0 ? chalk.green : chalk.red;
            line += " " + padLeft(valColor(netColor(netStr)), 8);
            line += trendFn(net, avgNet, teamAvgNet);
          }

          // test%
          if (showTestPct) {
            if (bar.testPct !== undefined) {
              line += " " + padLeft(chalk.dim(bar.testPct + "%"), 5);
              line += trendFn(bar.testPct, bar.avgTestPct, bar.teamAvgTestPct);
            } else {
              line += " " + " ".repeat(5) + "  ";
            }
          }

          // commits
          if (showCommits) {
            line += " " + padLeft(chalk.dim(fmt(cmts)), 6);
            line += trendFn(cmts, avgCmts, teamAvgCmts);
          }

          // active days
          if (showActiveDays) {
            line += " " + padLeft(chalk.dim(fmt(days)), 6);
            line += trendFn(days, avgDays, teamAvgDays);
          }

          // churn%
          if (showChurnPct) {
            if (bar.churnRatePct !== undefined) {
              line += " " + padLeft(chalk.dim(bar.churnRatePct + "%"), 6);
              line += trendFn(bar.churnRatePct, bar.avgChurnRatePct, bar.teamAvgChurnRatePct);
            } else {
              line += " " + " ".repeat(6) + "  ";
            }
          }

          // PRs columns
          if (showPrs) {
            const prsO = Math.round((bar.prsOpened ?? 0) / pu);
            const prsM = Math.round((bar.prsMerged ?? 0) / pu);
            const revs = Math.round((bar.reviewsGiven ?? 0) / pu);
            const avgPrsO = bar.avgPrsOpened !== undefined ? bar.avgPrsOpened / avgPu : undefined;
            const avgPrsM = bar.avgPrsMerged !== undefined ? bar.avgPrsMerged / avgPu : undefined;
            const avgRevs = bar.avgReviewsGiven !== undefined ? bar.avgReviewsGiven / avgPu : undefined;
            line += " " + padLeft(chalk.dim(fmt(prsO)), 6);
            line += trendFn(prsO, avgPrsO, bar.teamAvgPrsOpened);
            line += " " + padLeft(chalk.dim(fmt(prsM)), 6);
            line += trendFn(prsM, avgPrsM, bar.teamAvgPrsMerged);
            const hrs = bar.avgCycleHrs ?? 0;
            const cycleLabel = hrs >= 24 ? `${(hrs / 24).toFixed(1)}d` : `${hrs.toFixed(0)}h`;
            line += " " + padLeft(chalk.dim(cycleLabel), 6);
            line += trendFn(hrs, bar.avgAvgCycleHrs, bar.teamAvgAvgCycleHrs);
            line += " " + padLeft(chalk.dim(fmt(revs)), 7);
            line += trendFn(revs, avgRevs, bar.teamAvgReviewsGiven);
          }

          // headcount (last column)
          if (showHeadcount && bar.headcount !== undefined && bar.headcount > 1) {
            line += " " + padLeft(chalk.dim(`(${bar.headcount})`), 6);
          } else if (showHeadcount) {
            line += " " + " ".repeat(6);
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
 *
 * When teamAvg is provided and the value exceeds both thresholds
 * in the same direction, renders a strong (bg-colored) indicator.
 */
function trend(value: number, avg: number | undefined, pct: number, teamAvg?: number): string {
  if (avg === undefined) return "  ";
  const delta = value - avg;
  const threshold = Math.abs(avg) * pct;
  const aboveOwn = delta > threshold;
  const belowOwn = delta < -threshold;

  if (teamAvg !== undefined) {
    const teamDelta = value - teamAvg;
    const teamThreshold = Math.abs(teamAvg) * pct;
    const aboveTeam = teamDelta > teamThreshold;
    const belowTeam = teamDelta < -teamThreshold;

    // Strong: exceeds both own avg and team avg — inverted (bg swap)
    if (aboveOwn && aboveTeam) return " " + chalk.bgGreen.black("\u25B2");
    if (belowOwn && belowTeam) return " " + chalk.bgRed.black("\u25BC");
  }

  if (aboveOwn) return " " + chalk.green("\u25B2");
  if (belowOwn) return " " + chalk.red("\u25BC");
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
