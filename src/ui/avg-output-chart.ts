import chalk from "chalk";
import { fmt, stripAnsi, padRight, padLeft } from "../ui/format.js";

export interface SegmentDef {
  key: string;
  label: string;
  char: string;
  color: (s: string) => string;
}

export interface AvgOutputBar {
  label: string;
  headcount: number;
  segments: { key: string; value: number }[];
  total: number;
  runningAvg: number;
}

export interface AvgOutputChartOptions {
  bars: AvgOutputBar[];
  segmentDefs: SegmentDef[];
  labelWidth?: number;
  maxBarWidth?: number;
  showValues?: boolean;
  markerChar?: string;
  maxWidth?: number;
}

/**
 * Render a per-person average output chart with a running average marker.
 *
 * Each bar shows stacked segments for the current week's per-person average.
 * A \u25C8 marker is placed at the 3-month running average position on the
 * same horizontal scale.
 *
 * Bar past \u25C8 = above average, bar short of \u25C8 = below average.
 * Footer shows: "\u2514\u2500\u2500 \u25C8 = 3-month running avg per person"
 */
export function renderAvgOutputChart(
  options: AvgOutputChartOptions
): string {
  const {
    bars,
    segmentDefs,
    labelWidth = 14,
    maxBarWidth = 50,
    showValues = true,
    markerChar = "\u25C8",
    maxWidth = 100,
  } = options;

  if (bars.length === 0) {
    return "";
  }

  // globalMax considers both totals AND runningAvgs
  const globalMax = Math.max(
    1,
    ...bars.map((b) => b.total),
    ...bars.map((b) => b.runningAvg)
  );

  // Calculate available bar width
  const valueWidth = showValues ? 8 : 0;
  // Layout: [label] [(hc)] [space] [bar+marker area] [space] [value]
  const headcountWidth = 6; // " (##)"
  const gutterWidth = labelWidth + headcountWidth + 2;
  const availableBarWidth = Math.min(
    maxBarWidth,
    Math.max(10, maxWidth - gutterWidth - valueWidth - 2)
  );

  const lines: string[] = [];

  for (const bar of bars) {
    // Build label with headcount
    const labelStr =
      padRight(bar.label, labelWidth) +
      chalk.dim(` (${bar.headcount})`);

    // Render the stacked bar
    const barStr = renderBar(
      bar.segments,
      bar.total,
      globalMax,
      availableBarWidth,
      segmentDefs
    );

    // Calculate marker position
    const markerPos = Math.round(
      (bar.runningAvg / globalMax) * availableBarWidth
    );

    // Calculate bar visual width (strip ANSI to count visible chars)
    const barVisualWidth = stripAnsi(barStr).length;

    // Build the bar + marker line
    // The marker is placed at its absolute position within the bar area
    let barArea: string;

    if (markerPos <= barVisualWidth) {
      // Marker is within or at the end of the bar - bar extends past marker
      // Show bar, then pad to marker area width, then marker beyond bar
      barArea = barStr;
      const gapAfterBar = Math.max(0, availableBarWidth - barVisualWidth);
      if (gapAfterBar > 0) {
        barArea += " ".repeat(gapAfterBar);
      }
    } else {
      // Marker is beyond the bar - bar stops short of marker
      barArea = barStr;
      const gapToMarker = markerPos - barVisualWidth;
      barArea += " ".repeat(Math.max(0, gapToMarker - 1));
      barArea += chalk.white.bold(markerChar);
      const remaining =
        availableBarWidth - barVisualWidth - gapToMarker;
      if (remaining > 0) {
        barArea += " ".repeat(remaining);
      }
    }

    // If marker is within the bar range, we place it after the bar
    if (markerPos <= barVisualWidth && markerPos > 0) {
      // Reconstruct: bar, then spacing, then marker
      const gapAfterBar = Math.max(0, markerPos - barVisualWidth);
      barArea =
        barStr +
        " ".repeat(gapAfterBar) +
        chalk.white.bold(markerChar);
      const afterMarker =
        availableBarWidth - barVisualWidth - gapAfterBar - 1;
      if (afterMarker > 0) {
        barArea += " ".repeat(afterMarker);
      }
    }

    let line = "  " + labelStr + " " + barArea;

    if (showValues) {
      line += "  " + padLeft(fmt(bar.total), 8);
    }

    lines.push(line);
  }

  // Footer
  lines.push(
    " ".repeat(labelWidth + labelWidth) +
      `\u2514\u2500\u2500 ${chalk.white.bold(markerChar)} = 3-month running avg per person`
  );

  return lines.join("\n");
}

/**
 * Render a single stacked bar as colored characters.
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
