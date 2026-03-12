import type { FiletypeRollup, RolledUp } from '../store/sqlite-store.js';

/**
 * Canonical derived-metric calculations.
 *
 * Every place that needs net_lines, test_pct, or churn should call these
 * functions rather than reimplementing the arithmetic inline.
 */

/** Sum insertions + deletions for a single filetype bucket. */
export function totalLines(ft: { insertions: number; deletions: number }): number {
  return ft.insertions + ft.deletions;
}

/** Net lines = insertions − deletions across all filetypes. */
export function netLines(agg: RolledUp): number {
  return agg.insertions - agg.deletions;
}

/**
 * Test ratio as an integer percentage (0–100).
 *
 * Formula: test_lines / (app_lines + test_lines).
 * Returns 0 when the denominator is zero.
 */
export function testPct(filetype: {
  app: { insertions: number; deletions: number };
  test: { insertions: number; deletions: number };
}): number {
  const appLines = filetype.app.insertions + filetype.app.deletions;
  const testLines = filetype.test.insertions + filetype.test.deletions;
  const denom = appLines + testLines;
  return denom > 0 ? Math.round((testLines / denom) * 100) : 0;
}

/**
 * Compute all standard derived metrics from a RolledUp aggregate.
 *
 * Centralizes calculations that were previously inlined in dashboard.ts,
 * contributions.ts, and export-data.ts.
 */
export interface DerivedMetrics {
  netLines: number;
  testPct: number;
  appLines: number;
  testLines: number;
  configLines: number;
  storybookLines: number;
  docLines: number;
  totalLines: number;
}

export function calculateDerived(agg: RolledUp): DerivedMetrics {
  const appLines = totalLines(agg.filetype.app);
  const testLines = totalLines(agg.filetype.test);
  const configLines = totalLines(agg.filetype.config);
  const storybookLines = totalLines(agg.filetype.storybook);
  const docLines = totalLines(agg.filetype.doc);

  return {
    netLines: agg.insertions - agg.deletions,
    testPct: testPct(agg.filetype),
    appLines,
    testLines,
    configLines,
    storybookLines,
    docLines,
    totalLines: appLines + testLines + configLines + storybookLines + docLines,
  };
}
