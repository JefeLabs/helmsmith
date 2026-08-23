import type { EnrichmentStore, ScorecardMetricKey, UserWeekRepoRecord } from '../types/schema.js';
import { excludeBots } from './bots.js';
import { rollup } from './engine.js';
import { getLastNWeeks } from './filters.js';
import { testPct } from './metrics.js';

/**
 * Per-member scorecard: every metric is reported three ways — raw value, delta vs the
 * member's own preceding window, and percentile within the visible cohort. No metric
 * is a line count, per-week metrics divide by ACTIVE weeks, and nothing is combined
 * into a single number unless the user configures weights.
 */
export type MetricKey = ScorecardMetricKey;
export type Family = 'throughput' | 'flow' | 'quality' | 'collab';
export type BetterWhen = 'high' | 'low' | 'neutral';

export interface MetricDef {
  key: MetricKey;
  family: Family;
  label: string;
  betterWhen: BetterWhen;
  /** Shown on the overview page. */
  core: boolean;
  format: 'int' | 'dec1' | 'pct' | 'ratio' | 'hours';
}

export const FAMILIES: readonly Family[] = ['throughput', 'flow', 'quality', 'collab'];

export const METRICS: readonly MetricDef[] = [
  {
    key: 'commitsPerWeek',
    family: 'throughput',
    label: 'cmt/wk',
    betterWhen: 'high',
    core: true,
    format: 'dec1',
  },
  {
    key: 'daysPerWeek',
    family: 'throughput',
    label: 'days/wk',
    betterWhen: 'high',
    core: true,
    format: 'dec1',
  },
  {
    key: 'prsPerWeek',
    family: 'throughput',
    label: 'PRs/wk',
    betterWhen: 'high',
    core: true,
    format: 'dec1',
  },
  {
    key: 'prSizeP50',
    family: 'flow',
    label: 'PR p50',
    betterWhen: 'low',
    core: true,
    format: 'int',
  },
  {
    key: 'prSizeP75',
    family: 'flow',
    label: 'PR p75',
    betterWhen: 'low',
    core: false,
    format: 'int',
  },
  {
    key: 'cycleHrs',
    family: 'flow',
    label: 'cycle',
    betterWhen: 'low',
    core: true,
    format: 'hours',
  },
  {
    key: 'reworkPct',
    family: 'quality',
    label: 'rework%',
    betterWhen: 'low',
    core: true,
    format: 'pct',
  },
  {
    key: 'fixToFeat',
    family: 'quality',
    label: 'fix:feat',
    betterWhen: 'neutral',
    core: true,
    format: 'ratio',
  },
  {
    key: 'testPct',
    family: 'quality',
    label: 'test%',
    betterWhen: 'neutral',
    core: true,
    format: 'pct',
  },
  {
    key: 'breaking',
    family: 'quality',
    label: 'brk',
    betterWhen: 'neutral',
    core: false,
    format: 'int',
  },
  {
    key: 'reviews',
    family: 'collab',
    label: 'reviews',
    betterWhen: 'high',
    core: true,
    format: 'int',
  },
  {
    key: 'reviewsPerPr',
    family: 'collab',
    label: 'rev/PR',
    betterWhen: 'high',
    core: false,
    format: 'dec1',
  },
  {
    key: 'repos',
    family: 'collab',
    label: 'repos',
    betterWhen: 'neutral',
    core: true,
    format: 'int',
  },
  {
    key: 'scopes',
    family: 'collab',
    label: 'scopes',
    betterWhen: 'neutral',
    core: false,
    format: 'int',
  },
];

export interface Cell {
  value: number | null;
  baseline: number | null;
  deltaPct: number | null;
  percentile: number | null;
}

export interface ScorecardRow {
  member: string;
  team: string;
  org: string;
  orgType: 'core' | 'consultant';
  activeWeeks: number;
  baselineActiveWeeks: number;
  cells: Record<MetricKey, Cell>;
  score: number | null;
}

export interface Scorecard {
  window: string[];
  baseline: string[];
  cohortSize: number;
  minN: number;
  sources: { enrichment: boolean; prProxy: boolean; rework: boolean };
  metrics: readonly MetricDef[];
  rows: ScorecardRow[];
  hasScore: boolean;
}

export interface ScorecardSettings {
  trend_threshold: number;
  scorecard_min_n: number;
  scorecard_weights?: Record<string, number>;
  bot_patterns: string[];
}

/** Nearest-rank percentile of a sorted ascending array (p in 0..100). */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return Number.NaN;
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1];
}

// ── Per-member window statistics ──────────────────────────────────────────────

interface WindowStats {
  activeWeeks: number;
  commits: number;
  activeDays: number;
  prsMergedGit: number;
  prSizes: number[];
  reworkLines: number;
  insertions: number;
  fix: number;
  feat: number;
  breaking: number;
  testPct: number | null;
  repos: number;
  scopes: number;
  prsOpenedEnrich: number | null;
  reviews: number | null;
  cycleWeighted: number;
  cycleWeight: number;
}

function windowStats(
  records: UserWeekRepoRecord[],
  weeks: Set<string>,
  enrichments?: EnrichmentStore,
): WindowStats {
  const inWindow = records.filter((r) => weeks.has(r.week));
  const agg = rollup(inWindow, () => 'all').get('all');
  const activeWeekSet = new Set<string>();
  const repoSet = new Set<string>();
  const scopeSet = new Set<string>();
  let fix = 0;
  let feat = 0;
  let prsOpened: number | null = null;
  let reviews: number | null = null;
  let cycleWeighted = 0;
  let cycleWeight = 0;

  for (const r of inWindow) {
    if (r.commits > 0) {
      activeWeekSet.add(r.week);
      repoSet.add(r.repo);
    }
    for (const s of r.scopes ?? []) scopeSet.add(s);
    fix += r.intent?.fix ?? 0;
    feat += r.intent?.feat ?? 0;
    const e = enrichments?.enrichments[`${r.member}::${r.week}::${r.repo}`];
    if (e) {
      prsOpened = (prsOpened ?? 0) + e.prs_opened;
      reviews = (reviews ?? 0) + e.reviews_given;
      if (e.prs_merged > 0) {
        cycleWeighted += e.avg_cycle_hrs * e.prs_merged;
        cycleWeight += e.prs_merged;
      }
    }
  }

  return {
    activeWeeks: activeWeekSet.size,
    commits: agg?.commits ?? 0,
    activeDays: agg?.activeDays ?? 0,
    prsMergedGit: agg?.prsMergedGit ?? 0,
    prSizes: [...(agg?.prSizes ?? [])].sort((a, b) => a - b),
    reworkLines: agg?.reworkLines ?? 0,
    insertions: agg?.insertions ?? 0,
    fix,
    feat,
    breaking: agg?.breakingChanges ?? 0,
    testPct:
      agg &&
      agg.filetype.app.insertions +
        agg.filetype.app.deletions +
        agg.filetype.test.insertions +
        agg.filetype.test.deletions >
        0
        ? testPct(agg.filetype)
        : null,
    repos: repoSet.size,
    scopes: scopeSet.size,
    prsOpenedEnrich: prsOpened,
    reviews,
    cycleWeighted,
    cycleWeight,
  };
}

function perWeek(n: number, weeks: number): number | null {
  return weeks > 0 ? Math.round((n / weeks) * 10) / 10 : null;
}

function metricValue(key: MetricKey, s: WindowStats, sources: Scorecard['sources']): number | null {
  switch (key) {
    case 'commitsPerWeek':
      return perWeek(s.commits, s.activeWeeks);
    case 'daysPerWeek':
      return perWeek(s.activeDays, s.activeWeeks);
    case 'prsPerWeek':
      return sources.prProxy ? perWeek(s.prsMergedGit, s.activeWeeks) : null;
    case 'prSizeP50':
      return s.prSizes.length ? percentile(s.prSizes, 50) : null;
    case 'prSizeP75':
      return s.prSizes.length ? percentile(s.prSizes, 75) : null;
    case 'cycleHrs':
      return s.cycleWeight > 0 ? Math.round((s.cycleWeighted / s.cycleWeight) * 10) / 10 : null;
    case 'reworkPct':
      return sources.rework && s.insertions > 0
        ? Math.round((s.reworkLines / s.insertions) * 1000) / 10
        : null;
    case 'fixToFeat':
      return s.feat > 0 ? Math.round((s.fix / s.feat) * 100) / 100 : null;
    case 'testPct':
      return s.testPct;
    case 'breaking':
      return s.activeWeeks > 0 ? s.breaking : null;
    case 'reviews':
      return s.reviews;
    case 'reviewsPerPr': {
      const denom = Math.max(s.prsMergedGit, s.prsOpenedEnrich ?? 0);
      return s.reviews !== null && denom > 0 ? Math.round((s.reviews / denom) * 10) / 10 : null;
    }
    case 'repos':
      return s.activeWeeks > 0 ? s.repos : null;
    case 'scopes':
      return s.activeWeeks > 0 ? s.scopes : null;
  }
}

function deltaPct(value: number | null, baseline: number | null): number | null {
  if (value === null || baseline === null || baseline === 0) return null;
  return Math.round(((value - baseline) / Math.abs(baseline)) * 100);
}

// ── Public API ────────────────────────────────────────────────────────────────

export function computeScorecard(input: {
  records: UserWeekRepoRecord[];
  enrichments?: EnrichmentStore;
  currentWeek: string;
  windowWeeks: number;
  settings: ScorecardSettings;
}): Scorecard {
  const { settings } = input;
  const window = getLastNWeeks(input.windowWeeks, input.currentWeek);
  const baseline = getLastNWeeks(input.windowWeeks * 2, input.currentWeek).slice(
    0,
    input.windowWeeks,
  );
  const windowSet = new Set(window);
  const baselineSet = new Set(baseline);

  const records = excludeBots(input.records, settings.bot_patterns);
  const sources = {
    enrichment: !!input.enrichments && Object.keys(input.enrichments.enrichments).length > 0,
    prProxy: records.some((r) => (r.prsMergedGit ?? 0) > 0),
    rework: records.some((r) => (r.reworkLines ?? 0) > 0),
  };

  // Members are whoever has a record in the window (a zero-commit holder still shows, with nulls).
  const byMember = new Map<string, UserWeekRepoRecord[]>();
  for (const r of records) {
    if (!windowSet.has(r.week) && !baselineSet.has(r.week)) continue;
    const list = byMember.get(r.member) ?? [];
    list.push(r);
    byMember.set(r.member, list);
  }

  const rows: ScorecardRow[] = [];
  for (const [member, recs] of byMember) {
    if (!recs.some((r) => windowSet.has(r.week))) continue;
    const cur = windowStats(recs, windowSet, input.enrichments);
    const base = windowStats(recs, baselineSet, input.enrichments);
    // Most recent window record (ISO week strings compare lexicographically), independent of input order.
    const meta = recs
      .filter((r) => windowSet.has(r.week))
      .reduce((latest, r) => (r.week > latest.week ? r : latest));
    const cells = {} as Record<MetricKey, Cell>;
    for (const m of METRICS) {
      const value = metricValue(m.key, cur, sources);
      const b = metricValue(m.key, base, sources);
      cells[m.key] = { value, baseline: b, deltaPct: deltaPct(value, b), percentile: null };
    }
    rows.push({
      member,
      team: meta.team,
      org: meta.org,
      orgType: meta.orgType,
      activeWeeks: cur.activeWeeks,
      baselineActiveWeeks: base.activeWeeks,
      cells,
      score: null,
    });
  }

  // Percentiles within the cohort (only when the cohort is large enough to mean anything).
  const minN = settings.scorecard_min_n;
  for (const m of METRICS) {
    const present = rows.filter((r) => r.cells[m.key].value !== null);
    if (present.length < minN) continue;
    const values = present.map((r) => r.cells[m.key].value as number);
    for (const r of present) {
      const v = r.cells[m.key].value as number;
      const below = values.filter((x) => x < v).length;
      r.cells[m.key].percentile =
        values.length === 1 ? 100 : Math.round((100 * below) / (values.length - 1));
    }
  }

  // Opt-in composite.
  const weights = settings.scorecard_weights ?? {};
  const hasScore = Object.keys(weights).length > 0;
  if (hasScore) {
    for (const r of rows) {
      let num = 0;
      let den = 0;
      for (const m of METRICS) {
        const w = weights[m.key];
        const p = r.cells[m.key].percentile;
        if (!w || p === null) continue;
        num += w * (m.betterWhen === 'low' ? 100 - p : p);
        den += w;
      }
      r.score = den > 0 ? Math.round(num / den) : null;
    }
  }

  return {
    window,
    baseline,
    cohortSize: rows.length,
    minN,
    sources,
    metrics: METRICS,
    rows,
    hasScore,
  };
}

/** Stable sort; null values always sort last regardless of direction. */
export function sortRows(
  rows: ScorecardRow[],
  key: MetricKey | 'member' | 'score',
  desc: boolean,
): ScorecardRow[] {
  const val = (r: ScorecardRow): number | string | null =>
    key === 'member' ? r.member : key === 'score' ? r.score : r.cells[key].value;
  return [...rows].sort((a, b) => {
    const av = val(a);
    const bv = val(b);
    if (av === null && bv === null) return a.member.localeCompare(b.member);
    if (av === null) return 1;
    if (bv === null) return -1;
    if (typeof av === 'string' && typeof bv === 'string')
      return desc ? bv.localeCompare(av) : av.localeCompare(bv);
    const diff = (av as number) - (bv as number);
    if (diff === 0) return a.member.localeCompare(b.member);
    return desc ? -diff : diff;
  });
}
