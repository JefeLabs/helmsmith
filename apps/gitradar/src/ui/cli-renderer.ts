import { renderTable, type Column, type TableOptions } from './table.js';

// ── Atomic output primitives ─────────────────────────────────────────────────

/** Print a section title with surrounding blank lines. */
export function printTitle(title: string): void {
  console.log(`\n${title}\n`);
}

/** Print a standardized "no data" message. */
export function printNoData(message = 'No records found. Run "gitradar scan" first.'): void {
  console.log(message);
}

/** Print a summary line (preceded by a blank line). */
export function printSummary(text: string): void {
  console.log(`\n${text}`);
}

/** Print data as formatted JSON. */
export function printJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

// ── Table rendering ──────────────────────────────────────────────────────────

export interface CliTableOptions {
  /** Section title printed above the table (e.g. "Contributions by member (last 12 weeks)"). */
  title: string;
  columns: Column[];
  rows: Record<string, any>[];
  /** Summary line printed below the table (e.g. "9 members, 120 records"). */
  summary?: string;
  /** Passed through to renderTable. */
  borderStyle?: TableOptions['borderStyle'];
  /** Passed through to renderTable. */
  groupSeparator?: number[];
  /** Passed through to renderTable. */
  zebra?: boolean;
  /** Passed through to renderTable. */
  footerRows?: Record<string, any>[];
  /** Terminal width override. Defaults to process.stdout.columns. */
  maxWidth?: number;
}

/**
 * Print a complete CLI table section: title → table → summary.
 *
 * Wraps `renderTable()` from table.ts so commands don't need to
 * manually build header strings, separators, or row formatting.
 */
export function printTable(options: CliTableOptions): void {
  printTitle(options.title);
  const output = renderTable({
    columns: options.columns,
    rows: options.rows,
    borderStyle: options.borderStyle ?? 'minimal',
    groupSeparator: options.groupSeparator,
    zebra: options.zebra,
    footerRows: options.footerRows,
    maxWidth: options.maxWidth,
  });
  console.log(output);
  if (options.summary) {
    printSummary(options.summary);
  }
}

// Re-export Column for convenience so commands only need one import
export type { Column } from './table.js';
