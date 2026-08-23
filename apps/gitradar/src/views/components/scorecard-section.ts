import chalk from 'chalk';
import { filterRecords } from '../../aggregator/filters.js';
import {
  type Cell,
  computeScorecard,
  FAMILIES,
  type Family,
  METRICS,
  type MetricDef,
  type MetricKey,
  type Scorecard,
  sortRows,
} from '../../aggregator/scorecard.js';
import { fmt, weekShort } from '../../ui/format.js';
import { type Column, renderTable } from '../../ui/table.js';
import type { ViewContext } from '../types.js';

export type ScorecardMode = 'value' | 'delta' | 'pctl';
export type ScorecardFamily = 'all' | Family;
export type SortKey = MetricKey | 'member' | 'score';

export interface ScorecardViewState {
  windowWeeks: 4 | 8 | 12;
  family: ScorecardFamily;
  mode: ScorecardMode;
  sortKey: SortKey;
  sortDesc: boolean;
}

export function defaultScorecardState(windowWeeks: 4 | 8 | 12): ScorecardViewState {
  return { windowWeeks, family: 'all', mode: 'value', sortKey: 'commitsPerWeek', sortDesc: true };
}

export function visibleMetricKeys(state: ScorecardViewState, hasScore: boolean): SortKey[] {
  const metrics =
    state.family === 'all'
      ? METRICS.filter((m) => m.core)
      : METRICS.filter((m) => m.family === state.family);
  const keys: SortKey[] = ['member', ...metrics.map((m) => m.key)];
  if (hasScore) keys.push('score');
  return keys;
}

export function moveSort(
  state: ScorecardViewState,
  dir: -1 | 1,
  hasScore: boolean,
): ScorecardViewState {
  const keys = visibleMetricKeys(state, hasScore);
  const idx = Math.max(0, keys.indexOf(state.sortKey));
  const next = keys[(idx + dir + keys.length) % keys.length];
  return { ...state, sortKey: next, sortDesc: next === 'member' ? false : state.sortDesc };
}

/**
 * Keep the sort key on a column that is actually on screen.
 *
 * Cycling the metric family changes which columns render. A sort key carried
 * over from the previous family leaves the table sorted by an invisible column
 * with no `▾` marker anywhere, and `moveSort` then recovers oddly:
 * `keys.indexOf(sortKey)` is -1, so `→` jumps to index 1 rather than continuing
 * from where the user was. Falls back to the first metric of the new family;
 * `sortDesc` is the user's choice and is preserved.
 */
export function reconcileSort(state: ScorecardViewState, hasScore: boolean): ScorecardViewState {
  const keys = visibleMetricKeys(state, hasScore);
  if (keys.includes(state.sortKey)) return state;
  return { ...state, sortKey: keys.find((k) => k !== 'member') ?? keys[0] };
}

export const FAMILY_ORDER: ScorecardFamily[] = ['all', ...FAMILIES];
export const MODE_ORDER: ScorecardMode[] = ['value', 'delta', 'pctl'];

// ── Cell formatting ───────────────────────────────────────────────────────────

const NULL = chalk.dim('—');

function fmtValue(m: MetricDef, v: number | null): string {
  if (v === null) return NULL;
  switch (m.format) {
    case 'int':
      return fmt(Math.round(v));
    case 'dec1':
      return v.toFixed(1);
    case 'pct':
      return `${Math.round(v)}%`;
    case 'ratio':
      return v.toFixed(2);
    case 'hours':
      return v >= 24 ? `${(v / 24).toFixed(1)}d` : `${v.toFixed(1)}h`;
  }
}

function colorFor(m: MetricDef, good: boolean | null): (s: string) => string {
  if (good === null || m.betterWhen === 'neutral') return chalk.dim;
  return good ? chalk.green : chalk.red;
}

function fmtDelta(m: MetricDef, c: Cell, threshold: number): string {
  if (c.deltaPct === null) return NULL;
  const within = Math.abs(c.deltaPct) <= threshold * 100;
  const up = c.deltaPct > 0;
  const glyph = within ? '○' : up ? '▲' : '▼';
  const good = within ? null : m.betterWhen === 'high' ? up : m.betterWhen === 'low' ? !up : null;
  return colorFor(m, good)(`${glyph} ${c.deltaPct > 0 ? '+' : ''}${c.deltaPct}%`);
}

function fmtPctl(m: MetricDef, c: Cell, minN: number): string {
  if (c.value === null) return NULL;
  if (c.percentile === null) return chalk.dim(`n<${minN}`);
  const good =
    m.betterWhen === 'high'
      ? c.percentile >= 50
      : m.betterWhen === 'low'
        ? c.percentile <= 50
        : null;
  return colorFor(m, good)(`p${c.percentile}`);
}

function trendGlyph(m: MetricDef, c: Cell, threshold: number): string {
  if (c.deltaPct === null) return ' ';
  const within = Math.abs(c.deltaPct) <= threshold * 100;
  if (within) return chalk.dim('○');
  const up = c.deltaPct > 0;
  const good = m.betterWhen === 'high' ? up : m.betterWhen === 'low' ? !up : null;
  return colorFor(m, good)(up ? '▲' : '▼');
}

// ── Rendering ─────────────────────────────────────────────────────────────────

export function renderScorecard(
  sc: Scorecard,
  state: ScorecardViewState,
  termCols: number,
  trendThreshold = 0.1,
): string {
  const lines: string[] = [];
  const w = sc.window;
  const title = `Scorecard · ${state.family === 'all' ? 'overview' : state.family} · ${state.mode}`;
  lines.push(
    `${chalk.bold(title)}  ${chalk.dim(`${weekShort(w[0])} → ${weekShort(w[w.length - 1])}`)}`,
  );
  lines.push('');

  if (sc.rows.length === 0) {
    lines.push(chalk.dim('  No contributors in this window.'));
    return lines.join('\n');
  }

  const keys = visibleMetricKeys(state, sc.hasScore);
  const defs = new Map(METRICS.map((m) => [m.key, m]));
  const columns: Column[] = [
    { key: 'member', label: 'Name', minWidth: 12, flex: 1 },
    { key: 'team', label: 'Team', minWidth: 8 },
  ];
  const rows: Record<string, string>[] = [];

  for (const k of keys) {
    if (k === 'member') continue;
    if (k === 'score') {
      columns.push({ key: 'score', label: 'score', align: 'right', minWidth: 6 });
      continue;
    }
    const m = defs.get(k)!;
    const mark = state.sortKey === k ? (state.sortDesc ? '▾' : '▴') : '';
    if (state.family === 'all') {
      columns.push({
        key: k,
        label: `${m.label}${mark}`,
        align: 'right',
        minWidth: Math.max(7, m.label.length + 2),
      });
    } else {
      columns.push({ key: k, label: `${m.label}${mark}`, align: 'right', minWidth: 8 });
      columns.push({ key: `${k}:d`, label: 'Δ', align: 'right', minWidth: 7 });
      columns.push({ key: `${k}:p`, label: 'pctl', align: 'right', minWidth: 5 });
    }
  }

  for (const r of sortRows(sc.rows, state.sortKey, state.sortDesc)) {
    const row: Record<string, string> = { member: r.member, team: chalk.dim(r.team) };
    if (sc.hasScore) row.score = r.score === null ? NULL : chalk.bold(String(r.score));
    for (const k of keys) {
      if (k === 'member' || k === 'score') continue;
      const m = defs.get(k)!;
      const c = r.cells[k];
      if (state.family === 'all') {
        row[k] =
          state.mode === 'value'
            ? `${fmtValue(m, c.value)}${trendGlyph(m, c, trendThreshold)}`
            : state.mode === 'delta'
              ? fmtDelta(m, c, trendThreshold)
              : fmtPctl(m, c, sc.minN);
      } else {
        row[k] = fmtValue(m, c.value);
        row[`${k}:d`] = fmtDelta(m, c, trendThreshold);
        row[`${k}:p`] = fmtPctl(m, c, sc.minN);
      }
    }
    rows.push(row);
  }

  lines.push(renderTable({ columns, rows, maxWidth: termCols, borderStyle: 'minimal' }));
  lines.push('');
  const b = sc.baseline;
  const src = (on: boolean) => (on ? '✓' : '–');
  lines.push(
    chalk.dim(
      `  cohort ${sc.cohortSize} · baseline ${weekShort(b[0])} → ${weekShort(b[b.length - 1])} · ` +
        `sources: rework ${src(sc.sources.rework)}, PR proxy ${src(sc.sources.prProxy)}, enrichment ${src(sc.sources.enrichment)}` +
        (sc.cohortSize < sc.minN ? ` · percentiles need n≥${sc.minN}` : ''),
    ),
  );
  lines.push(
    chalk.dim('  ▲▼ vs own previous window · ○ within threshold · — no data · bots excluded'),
  );
  return lines.join('\n');
}

export function renderScorecardTab(
  ctx: ViewContext,
  state: ScorecardViewState,
  termCols: number,
): void {
  const s = ctx.config.settings;
  const sc = computeScorecard({
    records: filterRecords(ctx.records, {}),
    enrichments: ctx.enrichments,
    currentWeek: ctx.currentWeek,
    windowWeeks: state.windowWeeks,
    settings: {
      trend_threshold: s.trend_threshold,
      scorecard_min_n: s.scorecard_min_n,
      scorecard_weights: s.scorecard_weights,
      bot_patterns: s.bot_patterns,
    },
  });
  console.log(renderScorecard(sc, state, termCols, s.trend_threshold));
}

export function buildScorecardHotkeys(
  state: ScorecardViewState,
): Array<{ key: string; label: string }> {
  return [
    { key: '1/2/3', label: `${state.windowWeeks}w` },
    { key: 'F', label: state.family === 'all' ? 'Family' : state.family },
    { key: 'N', label: state.mode },
    { key: '←/→', label: `sort: ${state.sortKey}` },
    { key: 'R', label: state.sortDesc ? 'desc' : 'asc' },
  ];
}
