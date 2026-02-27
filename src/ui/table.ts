import chalk from "chalk";
import { stripAnsi, padRight, padLeft } from "./format.js";

export interface Column {
  key: string;
  label: string;
  align?: "left" | "right" | "center";
  width?: number;
  minWidth?: number;
  flex?: number;
  format?: (value: any, row: Record<string, any>) => string;
  headerColor?: (s: string) => string;
}

export interface TableOptions {
  columns: Column[];
  rows: Record<string, any>[];
  compact?: boolean;
  footerRows?: Record<string, any>[];
  highlightRow?: number;
  maxWidth?: number;
  borderStyle?: "rounded" | "minimal" | "none";
  zebra?: boolean;
  groupSeparator?: number[];
}

/**
 * ANSI-aware truncation. Truncates the visible content to `maxWidth` characters,
 * appending an ellipsis character if truncation occurs.
 * Strips ANSI codes, truncates the plain text, and returns the plain truncated form.
 * If the input contains ANSI codes, we do a character-by-character walk to preserve
 * color codes up to the visible limit.
 */
function truncate(s: string, maxWidth: number): string {
  if (maxWidth <= 0) {
    return "";
  }

  const plain = stripAnsi(s);

  if (plain.length <= maxWidth) {
    return s;
  }

  // We need to truncate. Walk through the original string, tracking visible chars.
  const ellipsis = "\u2026"; // …
  const targetVisible = maxWidth - 1; // Reserve 1 char for ellipsis

  if (targetVisible <= 0) {
    return ellipsis;
  }

  let result = "";
  let visibleCount = 0;
  let i = 0;

  while (i < s.length && visibleCount < targetVisible) {
    // Check if we're at an ANSI escape sequence
    if (s[i] === "\x1b" && s[i + 1] === "[") {
      // Find the end of the ANSI sequence
      let j = i + 2;
      while (j < s.length && s[j] !== "m") {
        j++;
      }
      // Include the 'm'
      result += s.slice(i, j + 1);
      i = j + 1;
    } else {
      result += s[i];
      visibleCount++;
      i++;
    }
  }

  // Reset any open ANSI codes and append ellipsis
  result += "\x1b[0m" + ellipsis;

  return result;
}

/**
 * Align cell content within a given width, ANSI-aware.
 */
function alignCell(
  content: string,
  width: number,
  align: "left" | "right" | "center"
): string {
  const visLen = stripAnsi(content).length;

  if (visLen >= width) {
    return content;
  }

  switch (align) {
    case "right":
      return padLeft(content, width);
    case "center": {
      const totalPad = width - visLen;
      const leftPad = Math.floor(totalPad / 2);
      const rightPad = totalPad - leftPad;
      return " ".repeat(leftPad) + content + " ".repeat(rightPad);
    }
    case "left":
    default:
      return padRight(content, width);
  }
}

/**
 * Calculate column widths using the sizing algorithm:
 * 1. Assign fixed widths (column.width)
 * 2. Apply minWidth floors
 * 3. Distribute remaining space to flex columns proportionally
 * 4. Clamp to available space
 */
function calculateColumnWidths(
  columns: Column[],
  maxWidth: number,
  rows: Record<string, any>[],
  footerRows?: Record<string, any>[]
): number[] {
  const widths = new Array<number>(columns.length).fill(0);
  const allRows = [...rows, ...(footerRows ?? [])];

  // Step 1: Assign fixed widths and calculate content-based widths for non-flex columns
  for (let i = 0; i < columns.length; i++) {
    const col = columns[i];
    if (col.width !== undefined) {
      widths[i] = col.width;
    } else if (col.flex === undefined) {
      // Auto-size: use the max of header label and content widths
      let maxContent = stripAnsi(col.label).length;
      for (const row of allRows) {
        const val = row[col.key];
        const formatted =
          col.format !== undefined ? col.format(val, row) : String(val ?? "");
        const visLen = stripAnsi(formatted).length;
        if (visLen > maxContent) {
          maxContent = visLen;
        }
      }
      widths[i] = maxContent;
    }
  }

  // Step 2: Apply minWidth floors
  for (let i = 0; i < columns.length; i++) {
    const col = columns[i];
    if (col.minWidth !== undefined && widths[i] < col.minWidth) {
      widths[i] = col.minWidth;
    }
  }

  // Step 3: Distribute remaining space to flex columns
  const fixedTotal = widths.reduce((sum, w) => sum + w, 0);
  // Account for column separators (1 space between columns for minimal/none, 3 for rounded)
  const separatorWidth = columns.length > 1 ? columns.length - 1 : 0;
  const remaining = Math.max(0, maxWidth - fixedTotal - separatorWidth);

  const flexColumns = columns
    .map((col, i) => ({ col, index: i }))
    .filter(({ col }) => col.flex !== undefined);

  if (flexColumns.length > 0 && remaining > 0) {
    const totalFlex = flexColumns.reduce(
      (sum, { col }) => sum + (col.flex ?? 0),
      0
    );

    if (totalFlex > 0) {
      let distributed = 0;
      for (let j = 0; j < flexColumns.length; j++) {
        const { col, index } = flexColumns[j];
        const flexVal = col.flex ?? 0;

        if (j === flexColumns.length - 1) {
          // Last flex column gets the remainder to avoid rounding issues
          widths[index] = remaining - distributed;
        } else {
          const share = Math.floor((flexVal / totalFlex) * remaining);
          widths[index] = share;
          distributed += share;
        }

        // Apply minWidth to flex columns too
        if (col.minWidth !== undefined && widths[index] < col.minWidth) {
          widths[index] = col.minWidth;
        }
      }
    }
  }

  // Ensure no width is less than 1
  for (let i = 0; i < widths.length; i++) {
    if (widths[i] < 1) {
      widths[i] = 1;
    }
  }

  return widths;
}

/**
 * Render a custom ANSI-aware table.
 *
 * Uses stripAnsi() for all width calculations so cells may contain
 * ANSI colors, sparklines, stacked bars, etc.
 *
 * Border styles:
 * - "minimal" (default): header separator line, no vertical borders
 * - "rounded": box-drawing characters with rounded corners
 * - "none": spaces only, no lines
 *
 * Features:
 * - zebra: dim alternate rows
 * - groupSeparator: dashed line after specified row indices
 * - format functions may return ANSI-colored strings
 * - highlightRow: bold the specified row
 * - footerRows: rendered after a separator
 */
export function renderTable(options: TableOptions): string {
  const {
    columns,
    rows,
    compact = false,
    footerRows,
    highlightRow,
    maxWidth = process.stdout.columns || 80,
    borderStyle = "minimal",
    zebra = false,
    groupSeparator = [],
  } = options;

  if (columns.length === 0) {
    return "";
  }

  const colWidths = calculateColumnWidths(columns, maxWidth, rows, footerRows);
  const lines: string[] = [];

  const groupSepSet = new Set(groupSeparator);

  /**
   * Format a single cell value.
   */
  function formatCell(
    col: Column,
    row: Record<string, any>,
    width: number
  ): string {
    const raw = row[col.key];
    const formatted =
      col.format !== undefined ? col.format(raw, row) : String(raw ?? "");
    const truncated = truncate(formatted, width);
    return alignCell(truncated, width, col.align ?? "left");
  }

  /**
   * Build a data row string.
   */
  function buildRow(row: Record<string, any>): string {
    const cells = columns.map((col, i) => formatCell(col, row, colWidths[i]));

    if (borderStyle === "rounded") {
      return "\u2502 " + cells.join(" \u2502 ") + " \u2502";
    } else if (borderStyle === "none") {
      return cells.join(" ");
    } else {
      // minimal
      return cells.join(" ");
    }
  }

  // === Rounded border: top border ===
  if (borderStyle === "rounded") {
    const topBorder =
      "\u256D" +
      colWidths.map((w) => "\u2500".repeat(w + 2)).join("\u252C") +
      "\u256E";
    lines.push(topBorder);
  }

  // === Header row ===
  const headerCells = columns.map((col, i) => {
    const label = col.label;
    const truncated = truncate(label, colWidths[i]);
    const aligned = alignCell(truncated, colWidths[i], col.align ?? "left");
    if (col.headerColor) {
      return col.headerColor(aligned);
    }
    return chalk.bold(aligned);
  });

  if (borderStyle === "rounded") {
    lines.push("\u2502 " + headerCells.join(" \u2502 ") + " \u2502");
  } else if (borderStyle === "none") {
    lines.push(headerCells.join(" "));
  } else {
    // minimal
    lines.push(headerCells.join(" "));
  }

  // === Header separator ===
  if (borderStyle === "rounded") {
    const sep =
      "\u251C" +
      colWidths.map((w) => "\u2500".repeat(w + 2)).join("\u253C") +
      "\u2524";
    lines.push(sep);
  } else if (borderStyle === "minimal") {
    const totalWidth = colWidths.reduce((sum, w) => sum + w, 0) + (columns.length - 1);
    lines.push(chalk.dim("\u2500".repeat(totalWidth)));
  }
  // "none" border style: no header separator

  // === Data rows ===
  for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
    const row = rows[rowIdx];
    let rowStr = buildRow(row);

    // Zebra striping: dim alternate (odd-indexed) rows
    if (zebra && rowIdx % 2 === 1) {
      rowStr = chalk.dim(rowStr);
    }

    // Highlight row
    if (highlightRow !== undefined && rowIdx === highlightRow) {
      rowStr = chalk.bold(rowStr);
    }

    lines.push(rowStr);

    // Group separator after this row
    if (groupSepSet.has(rowIdx)) {
      if (borderStyle === "rounded") {
        const sep =
          "\u251C" +
          colWidths
            .map((w) => {
              // Dashed line inside rounded
              const dashes: string[] = [];
              for (let d = 0; d < w + 2; d++) {
                dashes.push(d % 2 === 0 ? "\u2500" : " ");
              }
              return dashes.join("");
            })
            .join("\u253C") +
          "\u2524";
        lines.push(chalk.dim(sep));
      } else if (borderStyle === "minimal" || borderStyle === "none") {
        const totalWidth =
          colWidths.reduce((sum, w) => sum + w, 0) + (columns.length - 1);
        const dashes: string[] = [];
        for (let d = 0; d < totalWidth; d++) {
          dashes.push(d % 2 === 0 ? "\u2500" : " ");
        }
        lines.push(chalk.dim(dashes.join("")));
      }
    }
  }

  // === Footer separator + footer rows ===
  if (footerRows && footerRows.length > 0) {
    if (borderStyle === "rounded") {
      const sep =
        "\u251C" +
        colWidths.map((w) => "\u2500".repeat(w + 2)).join("\u253C") +
        "\u2524";
      lines.push(sep);
    } else if (borderStyle === "minimal") {
      const totalWidth =
        colWidths.reduce((sum, w) => sum + w, 0) + (columns.length - 1);
      lines.push(chalk.dim("\u2500".repeat(totalWidth)));
    }

    for (const row of footerRows) {
      lines.push(chalk.bold(buildRow(row)));
    }
  }

  // === Rounded border: bottom border ===
  if (borderStyle === "rounded") {
    const bottomBorder =
      "\u2570" +
      colWidths.map((w) => "\u2500".repeat(w + 2)).join("\u2534") +
      "\u256F";
    lines.push(bottomBorder);
  }

  return lines.join("\n");
}
