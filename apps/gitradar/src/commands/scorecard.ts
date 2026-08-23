import { type Filters, filterRecords, getCurrentWeek } from '../aggregator/filters.js';
import { computeScorecard, type ScorecardSettings } from '../aggregator/scorecard.js';
import { loadEnrichmentsSQL, queryRecords } from '../store/sqlite-store.js';
import type { EnrichmentStore, UserWeekRepoRecord } from '../types/schema.js';
import { printJson, printNoData } from '../ui/cli-renderer.js';
import {
  defaultScorecardState,
  renderScorecard,
  type ScorecardFamily,
  type SortKey,
} from '../views/components/scorecard-section.js';

export interface ScorecardCommandOptions {
  weeks?: number;
  family?: ScorecardFamily;
  sort?: SortKey;
  asc?: boolean;
  json?: boolean;
  filters?: Filters;
  settings?: ScorecardSettings;
  /** Pre-loaded records / enrichments (skips the DB — used by tests). */
  records?: UserWeekRepoRecord[];
  enrichments?: EnrichmentStore;
}

const DEFAULT_SETTINGS: ScorecardSettings = {
  trend_threshold: 0.1,
  scorecard_min_n: 8,
  bot_patterns: ['[bot]', 'dependabot', 'renovate', 'github-actions'],
};

function toWindow(weeks: number | undefined): 4 | 8 | 12 {
  if (!weeks || weeks <= 4) return 4;
  if (weeks <= 8) return 8;
  return 12;
}

export async function scorecard(options: ScorecardCommandOptions = {}): Promise<void> {
  let records = options.records ?? queryRecords({});
  if (options.filters) records = filterRecords(records, options.filters);
  const enrichments = options.enrichments ?? (options.records ? undefined : loadEnrichmentsSQL());
  const settings = options.settings ?? DEFAULT_SETTINGS;

  const windowWeeks = toWindow(options.weeks);
  const sc = computeScorecard({
    records,
    enrichments,
    currentWeek: getCurrentWeek(),
    windowWeeks,
    settings,
  });

  if (sc.rows.length === 0) {
    printNoData('No contributors in this window. Run "gitradar scan" first.');
    return;
  }
  if (options.json) {
    printJson(sc);
    return;
  }

  const state = {
    ...defaultScorecardState(windowWeeks),
    family: options.family ?? 'all',
    sortKey: options.sort ?? 'commitsPerWeek',
    sortDesc: !options.asc,
  };
  console.log(renderScorecard(sc, state, process.stdout.columns || 120, settings.trend_threshold));
}
