import chalk from "chalk";
import { fmt, stripAnsi, padLeft, padRight } from "./format.js";

export interface LineSeries {
  label: string;
  color: (s: string) => string;
  values: number[];
  style?: "solid" | "dotted";
}

export interface LineChartOptions {
  series: LineSeries[];
  xLabels: string[];
  height?: number;
  width?: number;
  yLabel?: string;
  showLegend?: boolean;
  yAxisWidth?: number;
}

/**
 * Line drawing characters for solid lines.
 * Selected based on direction transitions.
 */
const LINE_CHARS = {
  horizontal: "\u2500", // ─
  vertical: "\u2502",   // │
  cornerTopLeft: "\u256D",    // ╭ (going right then down, or arriving from below then going right)
  cornerTopRight: "\u256E",   // ╮ (going left then down, or arriving from left then going down)
  cornerBottomLeft: "\u2570", // ╰ (going right then up, or arriving from above then going right)
  cornerBottomRight: "\u256F", // ╯ (going left then up, or arriving from left then going up)
} as const;

const DOT_CHAR = "\u00B7"; // ·

/**
 * Determine the line character to use based on previous, current, and next Y positions.
 * Returns the appropriate box-drawing character for the direction of the line.
 */
function selectLineChar(
  prevY: number | undefined,
  currY: number,
  nextY: number | undefined,
  style: "solid" | "dotted"
): string {
  if (style === "dotted") {
    return DOT_CHAR;
  }

  // Only point (no neighbors with info)
  if (prevY === undefined && nextY === undefined) {
    return LINE_CHARS.horizontal;
  }

  // First point
  if (prevY === undefined) {
    if (nextY! < currY) {
      // Next is higher (lower y index) — going up-right
      return LINE_CHARS.cornerBottomLeft; // ╰
    } else if (nextY! > currY) {
      // Next is lower (higher y index) — going down-right
      return LINE_CHARS.cornerTopLeft; // ╭
    }
    return LINE_CHARS.horizontal;
  }

  // Last point
  if (nextY === undefined) {
    if (prevY < currY) {
      // Coming from higher (lower y index) — arrived going down
      return LINE_CHARS.cornerTopRight; // ╮
    } else if (prevY > currY) {
      // Coming from lower (higher y index) — arrived going up
      return LINE_CHARS.cornerBottomRight; // ╯
    }
    return LINE_CHARS.horizontal;
  }

  // Middle point — has both prev and next
  if (prevY < currY && nextY < currY) {
    // V shape — came down, going up
    return LINE_CHARS.cornerTopRight; // ╮ (bottom of V on inverted y)
    // Actually this is the lowest point, like a valley
    // With inverted Y (0=top): prevY < currY means prev is higher on screen
    // Coming from above, going back up => ╰ or ╯
    // Let's reconsider: y=0 is top of chart (high value), y=height-1 is bottom (low value)
    // prevY < currY: prev was higher on screen (higher value), current is lower
    // nextY < currY: next is higher on screen (higher value)
    // So we're at a valley: came down, going back up
    // The character should show: arriving from top-left, departing to top-right
    // That's ╰ combined with ╯ — use ╰ as approximation
  }

  if (prevY > currY && nextY > currY) {
    // Peak — came up, going down
    // prevY > currY: prev was lower on screen, current is higher
    // nextY > currY: next is lower on screen
    // We're at a peak: came up, going back down
    // ╮ or ╭ — use ╭ for arriving from bottom-left
  }

  // Straight horizontal
  if (prevY === currY && nextY === currY) {
    return LINE_CHARS.horizontal;
  }

  // Going up (currY < prevY means higher on screen = higher value)
  if (currY < prevY && (nextY === undefined || nextY <= currY)) {
    return LINE_CHARS.cornerBottomRight; // ╯ arriving from below-left
  }
  if (currY < prevY && nextY !== undefined && nextY > currY) {
    // Came up, now going down — peak
    return LINE_CHARS.cornerBottomRight; // ╯
  }
  if (currY < prevY && nextY !== undefined && nextY < currY) {
    // Continuing up
    return LINE_CHARS.cornerBottomRight; // ╯
  }

  // Going down (currY > prevY means lower on screen = lower value)
  if (currY > prevY && (nextY === undefined || nextY >= currY)) {
    return LINE_CHARS.cornerTopRight; // ╮
  }
  if (currY > prevY && nextY !== undefined && nextY < currY) {
    // Came down, now going up — valley
    return LINE_CHARS.cornerTopRight; // ╮
  }
  if (currY > prevY && nextY !== undefined && nextY > currY) {
    // Continuing down
    return LINE_CHARS.cornerTopRight; // ╮
  }

  // Flat from prev, changing to next
  if (currY === prevY && nextY !== undefined && nextY < currY) {
    return LINE_CHARS.cornerBottomLeft; // ╰ flat then going up
  }
  if (currY === prevY && nextY !== undefined && nextY > currY) {
    return LINE_CHARS.cornerTopLeft; // ╭ flat then going down
  }

  return LINE_CHARS.horizontal;
}

/**
 * Render a multi-series line chart for terminal output.
 *
 * Features:
 * - Multiple series with different colors and styles (solid/dotted)
 * - Y-axis labels with fmt() formatting
 * - X-axis labels below the chart
 * - Optional legend showing series with line style indicators
 * - Handles overlapping series (later series overwrites)
 */
export function renderLineChart(options: LineChartOptions): string {
  const {
    series,
    xLabels,
    height = 10,
    width,
    yLabel,
    showLegend = false,
    yAxisWidth = 6,
  } = options;

  if (series.length === 0 || xLabels.length === 0) {
    return "";
  }

  const chartWidth = width ?? xLabels.length;
  const chartHeight = height;

  // Calculate global min/max across all series
  let globalMin = Infinity;
  let globalMax = -Infinity;

  for (const s of series) {
    for (const v of s.values) {
      if (v < globalMin) globalMin = v;
      if (v > globalMax) globalMax = v;
    }
  }

  // Handle edge case: all same values
  if (globalMin === globalMax) {
    globalMin = globalMin - 1;
    globalMax = globalMax + 1;
  }

  if (globalMin === Infinity) {
    globalMin = 0;
    globalMax = 1;
  }

  const range = globalMax - globalMin;

  /**
   * Map a data value to a Y row index (0 = top = highest value).
   */
  function valueToRow(value: number): number {
    const normalized = (value - globalMin) / range;
    // Invert: 0 = top (high value), chartHeight-1 = bottom (low value)
    const row = Math.round((1 - normalized) * (chartHeight - 1));
    return Math.max(0, Math.min(chartHeight - 1, row));
  }

  /**
   * Map an x data index to a chart column, distributing points across chartWidth.
   */
  function dataIndexToCol(dataIndex: number, totalPoints: number): number {
    if (totalPoints <= 1) return 0;
    return Math.round((dataIndex / (totalPoints - 1)) * (chartWidth - 1));
  }

  // Build the grid: chartHeight rows x chartWidth columns
  // Each cell stores: { char, color } or null
  const grid: ({ char: string; color: (s: string) => string } | null)[][] =
    Array.from({ length: chartHeight }, () =>
      Array.from({ length: chartWidth }, () => null)
    );

  // Plot each series (later series overwrite earlier on overlap)
  for (const s of series) {
    const style = s.style ?? "solid";
    const numPoints = s.values.length;

    // Calculate row positions for each data point
    const rowPositions = s.values.map((v) => valueToRow(v));

    for (let di = 0; di < numPoints; di++) {
      const col = dataIndexToCol(di, numPoints);
      const row = rowPositions[di];

      const prevRow = di > 0 ? rowPositions[di - 1] : undefined;
      const nextRow = di < numPoints - 1 ? rowPositions[di + 1] : undefined;

      const char = selectLineChar(prevRow, row, nextRow, style);

      if (col >= 0 && col < chartWidth && row >= 0 && row < chartHeight) {
        grid[row][col] = { char, color: s.color };
      }

      // Fill vertical segments between consecutive points
      if (di > 0) {
        const prevCol = dataIndexToCol(di - 1, numPoints);
        const prevRowVal = rowPositions[di - 1];

        // If there's a vertical gap between consecutive points in adjacent columns,
        // fill with vertical chars
        if (Math.abs(prevCol - col) <= 1 && Math.abs(prevRowVal - row) > 1) {
          const startRow = Math.min(prevRowVal, row) + 1;
          const endRow = Math.max(prevRowVal, row);
          const fillCol = prevRowVal < row ? col : col;

          for (let r = startRow; r < endRow; r++) {
            if (
              fillCol >= 0 &&
              fillCol < chartWidth &&
              r >= 0 &&
              r < chartHeight
            ) {
              grid[r][fillCol] = {
                char: style === "dotted" ? DOT_CHAR : LINE_CHARS.vertical,
                color: s.color,
              };
            }
          }
        }
      }
    }
  }

  const lines: string[] = [];

  // === Y label ===
  if (yLabel) {
    lines.push(" ".repeat(yAxisWidth) + " " + chalk.dim(yLabel));
  }

  // === Chart body: rows from top (high) to bottom (low) ===
  for (let r = 0; r < chartHeight; r++) {
    // Y-axis label: show at top, middle, and bottom
    let yLabelStr = "";
    if (r === 0) {
      yLabelStr = fmt(globalMax);
    } else if (r === chartHeight - 1) {
      yLabelStr = fmt(globalMin);
    } else if (r === Math.floor(chartHeight / 2)) {
      yLabelStr = fmt(globalMin + range / 2);
    }

    const yAxisStr = padLeft(yLabelStr, yAxisWidth);
    const separator = r === 0 || r === chartHeight - 1 ? "\u2524" : "\u2502";

    // Build row content
    const rowChars: string[] = [];
    for (let c = 0; c < chartWidth; c++) {
      const cell = grid[r][c];
      if (cell) {
        rowChars.push(cell.color(cell.char));
      } else {
        rowChars.push(" ");
      }
    }

    lines.push(chalk.dim(yAxisStr + separator) + rowChars.join(""));
  }

  // === X-axis line ===
  lines.push(
    chalk.dim(" ".repeat(yAxisWidth) + "\u2514" + "\u2500".repeat(chartWidth))
  );

  // === X-axis labels ===
  if (xLabels.length > 0) {
    // Distribute labels evenly across the chart width.
    // Allow space beyond chartWidth so the last label is not clipped.
    const maxLabelLen = Math.max(...xLabels.map((l) => l.length));
    const lineLen = chartWidth + maxLabelLen;
    const labelLine = new Array(lineLen).fill(" ");
    const numLabels = Math.min(xLabels.length, chartWidth);

    for (let i = 0; i < numLabels; i++) {
      const col = dataIndexToCol(i, numLabels);
      const label = xLabels[i];
      // Place label starting at col position
      for (let j = 0; j < label.length && col + j < lineLen; j++) {
        labelLine[col + j] = label[j];
      }
    }

    // Trim trailing spaces
    const labelStr = labelLine.join("").trimEnd();
    lines.push(" ".repeat(yAxisWidth + 1) + labelStr);
  }

  // === Legend ===
  if (showLegend) {
    const legendParts = series.map((s) => {
      const style = s.style ?? "solid";
      const indicator = style === "solid" ? "\u2500\u2500" : DOT_CHAR + DOT_CHAR;
      return s.color(indicator) + " " + s.label;
    });
    lines.push("");
    lines.push(" ".repeat(yAxisWidth + 1) + legendParts.join("  "));
  }

  return lines.join("\n");
}
