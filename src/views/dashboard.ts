import chalk from 'chalk';
import { homedir } from 'node:os';
import path from 'node:path';
import { writeFile } from 'node:fs/promises';
import yaml from 'js-yaml';
import type { ViewContext, NavigationAction } from './types.js';
import type { UserWeekRepoRecord, EnrichmentStore } from '../types/schema.js';
import type { ProductivityExtensions } from '../types/schema.js';

const defaultEnrichment: ProductivityExtensions = {
  prs_opened: 0, prs_merged: 0, avg_cycle_hrs: 0, reviews_given: 0, churn_rate_pct: 0,
  pr_feature: 0, pr_fix: 0, pr_bugfix: 0, pr_chore: 0, pr_hotfix: 0, pr_other: 0,
};

function getEnrichment(store: EnrichmentStore, key: string): ProductivityExtensions {
  return store.enrichments[key] ?? defaultEnrichment;
}
import { renderGroupedHBarChart } from '../ui/grouped-hbar-chart.js';
import type { HBarGroup, HBar, DetailLayer } from '../ui/grouped-hbar-chart.js';
import { renderBanner } from '../ui/banner.js';
import { renderLegend } from '../ui/legend.js';
import { renderTabBar, renderHotkeyBar, renderBreadcrumb } from '../ui/tab-bar.js';
import type { TabDef } from '../ui/tab-bar.js';
import { renderTable } from '../ui/table.js';
import { readKey, readKeyWithTimeout } from '../ui/keypress.js';
import { readLine } from '../ui/readline.js';
import { stackedBar } from '../ui/bar.js';
import { rollup } from '../aggregator/engine.js';
import { filterRecords, getLastNWeeks, getLastNMonths, getLastNQuarters, getLastNYears, weekToMonth, weekToQuarter, weekToYear, monthShort } from '../aggregator/filters.js';
import { computeLeaderboard } from '../aggregator/leaderboard.js';
import { recordsToCsv } from '../commands/export-data.js';
import { assignAuthor, unassignAuthor, assignByIdentifierPrefix } from '../store/author-registry.js';
import { reattributeRecords } from '../collector/author-map.js';
import { SEGMENT_DEFS, FILETYPE_COLORS, FILETYPE_CHARS, SEGMENT_INDICATORS } from '../ui/constants.js';
import { calculateSegments, type Segment } from '../aggregator/segments.js';
import { fmt, weekShort, quarterShort, yearShort, padRight, padLeft } from '../ui/format.js';
import { teamDetailView } from './team-detail.js';
import { buildRepoOrgGroups } from './repo-activity.js';
import { renderManageTab, buildManageHotkeyItems } from './manage-tab.js';
import { scanDirectory } from '../collector/dir-scanner.js';
import { expandTilde } from '../store/paths.js';
import type { ManageSection } from './manage-tab.js';

// ── Types ────────────────────────────────────────────────────────────────────

type TabId = 'contributions' | 'repo_activity' | 'top_performers' | 'manage';
type ManageSectionId = ManageSection;
type DrillLevel = 'org' | 'team' | 'user';
type WindowSize = 4 | 8 | 12;
type ContribGranularity = 'week' | 'month' | 'quarter' | 'year';

interface TimeBucket {
  label: string;
  weeks: string[];
}

const TABS: TabDef[] = [
  { id: 'contributions', key: 'c', label: 'Contributions' },
  { id: 'repo_activity', key: 'r', label: 'Repo Activity' },
  { id: 'top_performers', key: 'p', label: 'Top Performers' },
  { id: 'manage', key: 'm', label: 'Manage' },
];

const WINDOW_LABELS: Record<WindowSize, string> = {
  4: '4 weeks',
  8: '8 weeks',
  12: '3 months',
};

const GRANULARITY_ORDER: ContribGranularity[] = ['year', 'quarter', 'month', 'week'];
const DRILL_ORDER: DrillLevel[] = ['org', 'team', 'user'];

const GRANULARITY_DEFAULTS: Record<ContribGranularity, number> = {
  week: 12,
  month: 6,
  quarter: 4,
  year: 3,
};

const DEPTH_BOUNDS: Record<ContribGranularity, { min: number; max: number; step: number }> = {
  week: { min: 2, max: 24, step: 2 },
  month: { min: 2, max: 12, step: 1 },
  quarter: { min: 2, max: 8, step: 1 },
  year: { min: 1, max: 5, step: 1 },
};

function toWindowSize(weeksBack: number): WindowSize {
  if (weeksBack <= 4) return 4;
  if (weeksBack <= 8) return 8;
  return 12;
}

// ── Shared helpers ───────────────────────────────────────────────────────────

/**
 * Calculate how many weeks to display based on terminal height and bars per group.
 */
export function computeWeeksToShow(termRows: number, barsPerGroup: number): number {
  return Math.min(4, Math.max(2, Math.floor((termRows - 30) / (barsPerGroup + 1))));
}

/**
 * Build time buckets for the Contributions tab.
 * Week mode: one bucket per ISO week.
 * Month mode: one bucket per calendar month, aggregating all weeks in that month.
 */
function buildTimeBuckets(
  granularity: ContribGranularity,
  depth: number,
  currentWeek: string,
  records: UserWeekRepoRecord[],
): TimeBucket[] {
  if (granularity === 'week') {
    const weeks = getLastNWeeks(depth, currentWeek);
    return weeks.reverse().map((w) => ({ label: weekShort(w), weeks: [w] }));
  }

  const allWeeks = [...new Set(records.map((r) => r.week))];

  if (granularity === 'month') {
    const months = getLastNMonths(depth, currentWeek);
    return months.reverse().map((m) => ({
      label: monthShort(m),
      weeks: allWeeks.filter((w) => weekToMonth(w) === m),
    }));
  }

  if (granularity === 'quarter') {
    const quarters = getLastNQuarters(depth, currentWeek);
    return quarters.reverse().map((q) => ({
      label: quarterShort(q),
      weeks: allWeeks.filter((w) => weekToQuarter(w) === q),
    }));
  }

  // year
  const years = getLastNYears(depth, currentWeek);
  return years.reverse().map((y) => ({
    label: yearShort(y),
    weeks: allWeeks.filter((w) => weekToYear(w) === y),
  }));
}

/**
 * Classify the trend shape from a chronological series of values.
 * Returns a short perception label: accelerating, slowing, recovering, dipping, stable, new.
 */
function classifyPerception(history: number[]): string {
  const nonZero = history.filter((v) => v > 0);
  if (nonZero.length <= 1) return 'new';
  if (history.length < 3) {
    // Only 2 points — simple comparison
    const [a, b] = history;
    const threshold = Math.max(a, b) * 0.1;
    if (b > a + threshold) return 'accelerating';
    if (b < a - threshold) return 'dipping';
    return 'stable';
  }

  // Split into first half and second half
  const mid = Math.floor(history.length / 2);
  const firstHalf = history.slice(0, mid);
  const secondHalf = history.slice(mid);
  const avgFirst = firstHalf.reduce((s, v) => s + v, 0) / firstHalf.length;
  const avgSecond = secondHalf.reduce((s, v) => s + v, 0) / secondHalf.length;

  // Find the minimum point index for V-shape / peak detection
  const minVal = Math.min(...history);
  const maxVal = Math.max(...history);
  const minIdx = history.indexOf(minVal);
  const maxIdx = history.indexOf(maxVal);
  const range = maxVal - minVal;
  const threshold = maxVal * 0.15;

  // V-shape: dip in the middle, recovery at end
  if (range > threshold && minIdx > 0 && minIdx < history.length - 1) {
    const afterMin = history.slice(minIdx);
    const avgAfterMin = afterMin.reduce((s, v) => s + v, 0) / afterMin.length;
    if (avgAfterMin > minVal + threshold && avgSecond > avgFirst) {
      return 'recovering';
    }
  }

  // Peak in the middle, declining at end
  if (range > threshold && maxIdx > 0 && maxIdx < history.length - 1) {
    const afterMax = history.slice(maxIdx);
    const avgAfterMax = afterMax.reduce((s, v) => s + v, 0) / afterMax.length;
    if (avgAfterMax < maxVal - threshold && avgSecond < avgFirst) {
      return 'slowing';
    }
  }

  // Consistent direction
  if (avgSecond > avgFirst + threshold) return 'accelerating';
  if (avgSecond < avgFirst - threshold) return 'dipping';
  return 'stable';
}

const legend = renderLegend(
  SEGMENT_DEFS.map((d) => ({ label: d.label, color: d.color, char: d.char })),
  { inline: true },
);

function getNumberedTeams(
  config: ViewContext['config'],
): Array<{ key: string; label: string; teamName: string }> {
  const teams: Array<{ key: string; label: string; teamName: string }> = [];
  let n = 1;
  for (const org of config.orgs) {
    for (const team of org.teams) {
      if (n > 9) break;
      const prefix = org.type === 'core' ? '\u2605' : '\u25C6';
      teams.push({
        key: String(n),
        label: `${prefix} ${team.name}`,
        teamName: team.name,
      });
      n++;
    }
  }
  return teams;
}

/** Compute test% = test lines / (app + test) lines, as integer 0-100. */
function computeTestPct(agg: { filetype: { app: { insertions: number; deletions: number }; test: { insertions: number; deletions: number } } }): number {
  const appLines = agg.filetype.app.insertions + agg.filetype.app.deletions;
  const testLines = agg.filetype.test.insertions + agg.filetype.test.deletions;
  const total = appLines + testLines;
  return total > 0 ? Math.round((testLines / total) * 100) : 0;
}

// ── Enrichment aggregation helper ────────────────────────────────────────────

interface AggregatedEnrichments {
  prsOpened: number;
  prsMerged: number;
  reviewsGiven: number;
  avgCycleHrs: number;
  churnRatePct: number;
}

function aggregateEnrichments(
  records: UserWeekRepoRecord[],
  enrichments: EnrichmentStore,
  groupBy: (r: UserWeekRepoRecord) => string,
): Map<string, AggregatedEnrichments> {
  const result = new Map<string, {
    prsOpened: number; prsMerged: number; reviewsGiven: number;
    sumCycleWeighted: number; totalPrCount: number;
    sumChurnWeighted: number; totalLines: number;
  }>();
  const seen = new Set<string>();

  for (const r of records) {
    const enrichKey = `${r.member}::${r.week}::${r.repo}`;
    const groupKey = groupBy(r);
    const dedupeKey = `${groupKey}::${enrichKey}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const e = getEnrichment(enrichments, enrichKey);
    const lines = r.filetype.app.insertions + r.filetype.app.deletions +
      r.filetype.test.insertions + r.filetype.test.deletions +
      r.filetype.config.insertions + r.filetype.config.deletions +
      r.filetype.storybook.insertions + r.filetype.storybook.deletions +
      (r.filetype.doc?.insertions ?? 0) + (r.filetype.doc?.deletions ?? 0);

    const agg = result.get(groupKey) ?? {
      prsOpened: 0, prsMerged: 0, reviewsGiven: 0,
      sumCycleWeighted: 0, totalPrCount: 0,
      sumChurnWeighted: 0, totalLines: 0,
    };
    agg.prsOpened += e.prs_opened;
    agg.prsMerged += e.prs_merged;
    agg.reviewsGiven += e.reviews_given;
    agg.sumCycleWeighted += e.avg_cycle_hrs * e.prs_merged;
    agg.totalPrCount += e.prs_merged;
    agg.sumChurnWeighted += e.churn_rate_pct * lines;
    agg.totalLines += lines;
    result.set(groupKey, agg);
  }

  const final = new Map<string, AggregatedEnrichments>();
  for (const [key, agg] of result) {
    final.set(key, {
      prsOpened: agg.prsOpened,
      prsMerged: agg.prsMerged,
      reviewsGiven: agg.reviewsGiven,
      avgCycleHrs: agg.totalPrCount > 0 ? agg.sumCycleWeighted / agg.totalPrCount : 0,
      churnRatePct: agg.totalLines > 0 ? agg.sumChurnWeighted / agg.totalLines : 0,
    });
  }
  return final;
}

// ── Contributions tab data ───────────────────────────────────────────────────

function buildContributionGroups(
  records: UserWeekRepoRecord[],
  buckets: TimeBucket[],
  drillLevel: DrillLevel,
  tagOverlay: boolean,
  config: ViewContext['config'],
  enrichments?: EnrichmentStore,
): HBarGroup[] {
  const groups: HBarGroup[] = [];

  for (const bucket of buckets) {
    const bucketRecords = filterRecords(records, { weeks: bucket.weeks });
    const bars: HBar[] = [];
    let separatorAfter: number[] | undefined;

    if (tagOverlay) {
      const rolled = rollup(bucketRecords, (r) => r.tag);
      const tagKeys = Object.keys(config.tags ?? {});
      for (const [tag] of rolled) {
        if (!tagKeys.includes(tag)) tagKeys.push(tag);
      }
      for (const tag of tagKeys) {
        const agg = rolled.get(tag);
        if (!agg) continue;
        const label = config.tags?.[tag]?.label ?? tag;
        bars.push({
          label,
          segments: [
            { key: 'app', value: agg.filetype.app.insertions + agg.filetype.app.deletions },
            { key: 'test', value: agg.filetype.test.insertions + agg.filetype.test.deletions },
            { key: 'config', value: agg.filetype.config.insertions + agg.filetype.config.deletions },
            { key: 'storybook', value: agg.filetype.storybook.insertions + agg.filetype.storybook.deletions },
            { key: 'doc', value: agg.filetype.doc.insertions + agg.filetype.doc.deletions },
          ],
          total: agg.insertions + agg.deletions,
          insertions: agg.insertions,
          deletions: agg.deletions,
          testPct: computeTestPct(agg),
          commits: agg.commits,
          activeDays: agg.activeDays,
          headcount: agg.activeMembers,
        });
      }
    } else if (drillLevel === 'org') {
      const rolled = rollup(bucketRecords, (r) => r.org);
      for (const org of config.orgs) {
        const agg = rolled.get(org.name);
        if (!agg) continue;
        bars.push({
          label: org.name,
          orgType: org.type,
          segments: [
            { key: 'app', value: agg.filetype.app.insertions + agg.filetype.app.deletions },
            { key: 'test', value: agg.filetype.test.insertions + agg.filetype.test.deletions },
            { key: 'config', value: agg.filetype.config.insertions + agg.filetype.config.deletions },
            { key: 'storybook', value: agg.filetype.storybook.insertions + agg.filetype.storybook.deletions },
            { key: 'doc', value: agg.filetype.doc.insertions + agg.filetype.doc.deletions },
          ],
          total: agg.insertions + agg.deletions,
          insertions: agg.insertions,
          deletions: agg.deletions,
          testPct: computeTestPct(agg),
          commits: agg.commits,
          activeDays: agg.activeDays,
          headcount: agg.activeMembers,
        });
      }
    } else if (drillLevel === 'team') {
      let barIndex = 0;
      separatorAfter = [];
      for (let oi = 0; oi < config.orgs.length; oi++) {
        const org = config.orgs[oi];
        const orgTeamRecords = filterRecords(bucketRecords, { org: org.name });
        const rolled = rollup(orgTeamRecords, (r) => r.team);
        for (const team of org.teams) {
          const agg = rolled.get(team.name);
          if (!agg) continue;
          bars.push({
            label: team.name,
            orgType: org.type,
            segments: [
              { key: 'app', value: agg.filetype.app.insertions + agg.filetype.app.deletions },
              { key: 'test', value: agg.filetype.test.insertions + agg.filetype.test.deletions },
              { key: 'config', value: agg.filetype.config.insertions + agg.filetype.config.deletions },
              { key: 'storybook', value: agg.filetype.storybook.insertions + agg.filetype.storybook.deletions },
              { key: 'doc', value: agg.filetype.doc.insertions + agg.filetype.doc.deletions },
            ],
            total: agg.insertions + agg.deletions,
            insertions: agg.insertions,
            deletions: agg.deletions,
            testPct: computeTestPct(agg),
            commits: agg.commits,
            activeDays: agg.activeDays,
            headcount: agg.activeMembers,
          });
          barIndex++;
        }
        if (oi < config.orgs.length - 1 && barIndex > 0) {
          separatorAfter.push(barIndex - 1);
        }
      }
    } else {
      // user level — one bar per individual member
      const rolled = rollup(bucketRecords, (r) => r.member);
      const entries = [...rolled.entries()].sort((a, b) =>
        (b[1].insertions + b[1].deletions) - (a[1].insertions + a[1].deletions),
      );
      for (const [member, agg] of entries) {
        bars.push({
          label: member,
          segments: [
            { key: 'app', value: agg.filetype.app.insertions + agg.filetype.app.deletions },
            { key: 'test', value: agg.filetype.test.insertions + agg.filetype.test.deletions },
            { key: 'config', value: agg.filetype.config.insertions + agg.filetype.config.deletions },
            { key: 'storybook', value: agg.filetype.storybook.insertions + agg.filetype.storybook.deletions },
            { key: 'doc', value: agg.filetype.doc.insertions + agg.filetype.doc.deletions },
          ],
          total: agg.insertions + agg.deletions,
          insertions: agg.insertions,
          deletions: agg.deletions,
          testPct: computeTestPct(agg),
          commits: agg.commits,
          activeDays: agg.activeDays,
          headcount: 1,
        });
      }
    }

    // Stamp enrichment data onto bars
    if (enrichments) {
      const groupByFn = tagOverlay ? (r: UserWeekRepoRecord) => (config.tags?.[r.tag]?.label ?? r.tag)
        : drillLevel === 'org' ? (r: UserWeekRepoRecord) => r.org
        : drillLevel === 'team' ? (r: UserWeekRepoRecord) => r.team
        : (r: UserWeekRepoRecord) => r.member;
      const enrichAgg = aggregateEnrichments(bucketRecords, enrichments, groupByFn);
      for (const bar of bars) {
        const e = enrichAgg.get(bar.label);
        if (e) {
          bar.prsOpened = e.prsOpened;
          bar.prsMerged = e.prsMerged;
          bar.avgCycleHrs = Math.round(e.avgCycleHrs * 10) / 10;
          bar.reviewsGiven = e.reviewsGiven;
          bar.churnRatePct = Math.round(e.churnRatePct * 10) / 10;
        }
      }
    }

    groups.push({
      groupLabel: bucket.label,
      bars,
      separatorAfter: separatorAfter && separatorAfter.length > 0 ? separatorAfter : undefined,
    });
  }

  // Compute per-label averages across all buckets and stamp onto each bar
  const labelTotals = new Map<string, {
    sumTotal: number; sumIns: number; sumDel: number; sumNet: number;
    sumCommits: number; sumActiveDays: number; sumHeadcount: number;
    sumTestPct: number;
    sumChurnRatePct: number; sumPrsOpened: number; sumPrsMerged: number;
    sumAvgCycleHrs: number; sumReviewsGiven: number;
    count: number;
  }>();
  for (const group of groups) {
    for (const bar of group.bars) {
      const entry = labelTotals.get(bar.label) ?? {
        sumTotal: 0, sumIns: 0, sumDel: 0, sumNet: 0,
        sumCommits: 0, sumActiveDays: 0, sumHeadcount: 0,
        sumTestPct: 0,
        sumChurnRatePct: 0, sumPrsOpened: 0, sumPrsMerged: 0,
        sumAvgCycleHrs: 0, sumReviewsGiven: 0,
        count: 0,
      };
      entry.sumTotal += bar.total;
      entry.sumIns += bar.insertions ?? 0;
      entry.sumDel += bar.deletions ?? 0;
      entry.sumNet += (bar.insertions ?? 0) - (bar.deletions ?? 0);
      entry.sumCommits += bar.commits ?? 0;
      entry.sumActiveDays += bar.activeDays ?? 0;
      entry.sumHeadcount += bar.headcount ?? 0;
      entry.sumTestPct += bar.testPct ?? 0;
      entry.sumChurnRatePct += bar.churnRatePct ?? 0;
      entry.sumPrsOpened += bar.prsOpened ?? 0;
      entry.sumPrsMerged += bar.prsMerged ?? 0;
      entry.sumAvgCycleHrs += bar.avgCycleHrs ?? 0;
      entry.sumReviewsGiven += bar.reviewsGiven ?? 0;
      entry.count++;
      labelTotals.set(bar.label, entry);
    }
  }
  for (const group of groups) {
    for (const bar of group.bars) {
      const entry = labelTotals.get(bar.label);
      if (entry && entry.count > 0) {
        bar.avg = entry.sumTotal / entry.count;
        bar.avgInsertions = entry.sumIns / entry.count;
        bar.avgDeletions = entry.sumDel / entry.count;
        bar.avgNet = entry.sumNet / entry.count;
        bar.avgCommits = entry.sumCommits / entry.count;
        bar.avgActiveDays = entry.sumActiveDays / entry.count;
        bar.avgHeadcount = entry.sumHeadcount / entry.count;
        bar.avgTestPct = entry.sumTestPct / entry.count;
        bar.avgChurnRatePct = entry.sumChurnRatePct / entry.count;
        bar.avgPrsOpened = entry.sumPrsOpened / entry.count;
        bar.avgPrsMerged = entry.sumPrsMerged / entry.count;
        bar.avgAvgCycleHrs = entry.sumAvgCycleHrs / entry.count;
        bar.avgReviewsGiven = entry.sumReviewsGiven / entry.count;
      }
    }
  }

  // Compute rolling perception per label per bucket.
  // Groups are most-recent-first, so build chronological history per label,
  // then for each bucket classify using the trailing window ending at that bucket.
  const labelChronTotals = new Map<string, number[]>();
  for (let gi = groups.length - 1; gi >= 0; gi--) {
    for (const bar of groups[gi].bars) {
      const hist = labelChronTotals.get(bar.label) ?? [];
      hist.push(bar.total);
      labelChronTotals.set(bar.label, hist);
    }
  }
  // Now stamp each bar with its perception based on its position in the timeline
  for (let gi = 0; gi < groups.length; gi++) {
    // chronological index: most recent bucket (gi=0) = last in chronological array
    const chronIdx = groups.length - 1 - gi;
    for (const bar of groups[gi].bars) {
      const fullHist = labelChronTotals.get(bar.label);
      if (!fullHist || chronIdx < 1) {
        bar.perception = 'new';
        continue;
      }
      // Take the trailing window ending at this bucket (up to 4 periods)
      const windowStart = Math.max(0, chronIdx - 3);
      const window = fullHist.slice(windowStart, chronIdx + 1);
      bar.perception = classifyPerception(window);
    }
  }

  // Compute team averages per bucket and stamp onto user-level bars.
  // Only applies at user drill level (each bar.label = member name).
  if (drillLevel === 'user' && !tagOverlay) {
    // Build member → team lookup from the records
    const memberTeamMap = new Map<string, string>();
    for (const r of records) {
      if (!memberTeamMap.has(r.member)) memberTeamMap.set(r.member, r.team);
    }

    // For each bucket, compute per-team averages across members
    for (const group of groups) {
      // Collect per-team totals for this bucket
      const teamBucketTotals = new Map<string, {
        sumIns: number; sumDel: number; sumNet: number;
        sumCommits: number; sumActiveDays: number; sumTestPct: number;
        sumChurnRatePct: number; sumPrsOpened: number; sumPrsMerged: number;
        sumAvgCycleHrs: number; sumReviewsGiven: number;
        memberCount: number;
      }>();

      for (const bar of group.bars) {
        const team = memberTeamMap.get(bar.label) ?? 'unassigned';
        const e = teamBucketTotals.get(team) ?? {
          sumIns: 0, sumDel: 0, sumNet: 0,
          sumCommits: 0, sumActiveDays: 0, sumTestPct: 0,
          sumChurnRatePct: 0, sumPrsOpened: 0, sumPrsMerged: 0,
          sumAvgCycleHrs: 0, sumReviewsGiven: 0,
          memberCount: 0,
        };
        e.sumIns += bar.insertions ?? 0;
        e.sumDel += bar.deletions ?? 0;
        e.sumNet += (bar.insertions ?? 0) - (bar.deletions ?? 0);
        e.sumCommits += bar.commits ?? 0;
        e.sumActiveDays += bar.activeDays ?? 0;
        e.sumTestPct += bar.testPct ?? 0;
        e.sumChurnRatePct += bar.churnRatePct ?? 0;
        e.sumPrsOpened += bar.prsOpened ?? 0;
        e.sumPrsMerged += bar.prsMerged ?? 0;
        e.sumAvgCycleHrs += bar.avgCycleHrs ?? 0;
        e.sumReviewsGiven += bar.reviewsGiven ?? 0;
        e.memberCount++;
        teamBucketTotals.set(team, e);
      }

      // Stamp team average onto each member bar
      for (const bar of group.bars) {
        const team = memberTeamMap.get(bar.label) ?? 'unassigned';
        const t = teamBucketTotals.get(team);
        if (t && t.memberCount > 0) {
          bar.teamAvgInsertions = t.sumIns / t.memberCount;
          bar.teamAvgDeletions = t.sumDel / t.memberCount;
          bar.teamAvgNet = t.sumNet / t.memberCount;
          bar.teamAvgCommits = t.sumCommits / t.memberCount;
          bar.teamAvgActiveDays = t.sumActiveDays / t.memberCount;
          bar.teamAvgTestPct = t.sumTestPct / t.memberCount;
          bar.teamAvgChurnRatePct = t.sumChurnRatePct / t.memberCount;
          bar.teamAvgPrsOpened = t.sumPrsOpened / t.memberCount;
          bar.teamAvgPrsMerged = t.sumPrsMerged / t.memberCount;
          bar.teamAvgAvgCycleHrs = t.sumAvgCycleHrs / t.memberCount;
          bar.teamAvgReviewsGiven = t.sumReviewsGiven / t.memberCount;
        }
      }
    }
  }

  return groups;
}

/**
 * Entity-first chart groups: outer = entities, inner = time buckets as bars.
 * Same bar data, just flipped axes.
 */
function buildContributionGroupsByEntity(
  records: UserWeekRepoRecord[],
  buckets: TimeBucket[],
  drillLevel: DrillLevel,
  tagOverlay: boolean,
  config: ViewContext['config'],
  enrichments?: EnrichmentStore,
): HBarGroup[] {
  const groupByFn = tagOverlay ? (r: UserWeekRepoRecord) => r.tag
    : drillLevel === 'org' ? (r: UserWeekRepoRecord) => r.org
    : drillLevel === 'team' ? (r: UserWeekRepoRecord) => r.team
    : (r: UserWeekRepoRecord) => r.member;

  // Build entity list
  type Entry = { label: string; orgType?: 'core' | 'consultant'; key: string };
  let entries: Entry[] = [];
  if (tagOverlay) {
    const tagKeys = Object.keys(config.tags ?? {});
    const tagRolled = rollup(records, (r) => r.tag);
    for (const [tag] of tagRolled) {
      if (!tagKeys.includes(tag)) tagKeys.push(tag);
    }
    entries = tagKeys.map((t) => ({ label: config.tags?.[t]?.label ?? t, key: t }));
  } else if (drillLevel === 'org') {
    entries = config.orgs.map((o) => ({ label: o.name, orgType: o.type, key: o.name }));
  } else if (drillLevel === 'team') {
    for (const org of config.orgs) {
      for (const team of org.teams) {
        entries.push({ label: team.name, orgType: org.type, key: team.name });
      }
    }
  } else {
    const memberRolled = rollup(records, groupByFn);
    const sorted = [...memberRolled.entries()].sort(
      (a, b) => (b[1].insertions + b[1].deletions) - (a[1].insertions + a[1].deletions),
    );
    entries = sorted.map(([m]) => ({ label: m, key: m }));
  }

  const allBucketWeeks = new Set(buckets.flatMap((b) => b.weeks));
  const groups: HBarGroup[] = [];

  for (const entry of entries) {
    const entityRecords = records.filter((r) =>
      allBucketWeeks.has(r.week) && groupByFn(r) === entry.key,
    );
    if (entityRecords.length === 0) continue;

    const bars: HBar[] = [];
    for (const bucket of buckets) {
      const bucketRecords = entityRecords.filter((r) => bucket.weeks.includes(r.week));
      if (bucketRecords.length === 0) continue;

      const rolled = rollup(bucketRecords, groupByFn);
      const agg = rolled.get(entry.key);
      if (!agg) continue;

      const bar: HBar = {
        label: bucket.label,
        orgType: entry.orgType,
        segments: [
          { key: 'app', value: agg.filetype.app.insertions + agg.filetype.app.deletions },
          { key: 'test', value: agg.filetype.test.insertions + agg.filetype.test.deletions },
          { key: 'config', value: agg.filetype.config.insertions + agg.filetype.config.deletions },
          { key: 'storybook', value: agg.filetype.storybook.insertions + agg.filetype.storybook.deletions },
          { key: 'doc', value: agg.filetype.doc.insertions + agg.filetype.doc.deletions },
        ],
        total: agg.insertions + agg.deletions,
        insertions: agg.insertions,
        deletions: agg.deletions,
        testPct: computeTestPct(agg),
        commits: agg.commits,
        activeDays: agg.activeDays,
        headcount: agg.activeMembers,
      };

      if (enrichments) {
        const enrichAgg = aggregateEnrichments(bucketRecords, enrichments, groupByFn);
        const ea = enrichAgg.get(entry.key);
        if (ea) {
          bar.prsOpened = ea.prsOpened;
          bar.prsMerged = ea.prsMerged;
          bar.avgCycleHrs = Math.round(ea.avgCycleHrs * 10) / 10;
          bar.reviewsGiven = ea.reviewsGiven;
          bar.churnRatePct = Math.round(ea.churnRatePct * 10) / 10;
        }
      }

      bars.push(bar);
    }

    if (bars.length === 0) continue;

    const prefix = entry.orgType === 'core' ? '\u2605 ' : entry.orgType === 'consultant' ? '\u25C6 ' : '';
    groups.push({ groupLabel: prefix + entry.label, bars });
  }

  // Compute per-label averages (labels are now time bucket labels)
  const labelTotals = new Map<string, {
    sumTotal: number; sumIns: number; sumDel: number; sumNet: number;
    sumCommits: number; sumActiveDays: number; sumHeadcount: number;
    sumTestPct: number; count: number;
    sumPrsOpened: number; sumPrsMerged: number; sumReviews: number;
    churnWeightedSum: number; churnWeight: number;
    cycleWeightedSum: number; cycleWeight: number;
  }>();
  for (const group of groups) {
    for (const bar of group.bars) {
      const e = labelTotals.get(bar.label) ?? {
        sumTotal: 0, sumIns: 0, sumDel: 0, sumNet: 0,
        sumCommits: 0, sumActiveDays: 0, sumHeadcount: 0,
        sumTestPct: 0, count: 0,
        sumPrsOpened: 0, sumPrsMerged: 0, sumReviews: 0,
        churnWeightedSum: 0, churnWeight: 0,
        cycleWeightedSum: 0, cycleWeight: 0,
      };
      e.sumTotal += bar.total;
      e.sumIns += bar.insertions ?? 0;
      e.sumDel += bar.deletions ?? 0;
      e.sumNet += (bar.insertions ?? 0) - (bar.deletions ?? 0);
      e.sumCommits += bar.commits ?? 0;
      e.sumActiveDays += bar.activeDays ?? 0;
      e.sumHeadcount += bar.headcount ?? 0;
      e.sumTestPct += bar.testPct ?? 0;
      e.sumPrsOpened += bar.prsOpened ?? 0;
      e.sumPrsMerged += bar.prsMerged ?? 0;
      e.sumReviews += bar.reviewsGiven ?? 0;
      if (bar.churnRatePct !== undefined) {
        e.churnWeightedSum += bar.churnRatePct * bar.total;
        e.churnWeight += bar.total;
      }
      if (bar.avgCycleHrs !== undefined && bar.prsMerged) {
        e.cycleWeightedSum += bar.avgCycleHrs * bar.prsMerged;
        e.cycleWeight += bar.prsMerged;
      }
      e.count++;
      labelTotals.set(bar.label, e);
    }
  }
  for (const group of groups) {
    for (const bar of group.bars) {
      const e = labelTotals.get(bar.label);
      if (e && e.count > 0) {
        bar.avg = e.sumTotal / e.count;
        bar.avgInsertions = e.sumIns / e.count;
        bar.avgDeletions = e.sumDel / e.count;
        bar.avgNet = e.sumNet / e.count;
        bar.avgCommits = e.sumCommits / e.count;
        bar.avgActiveDays = e.sumActiveDays / e.count;
        bar.avgHeadcount = e.sumHeadcount / e.count;
        bar.avgTestPct = e.sumTestPct / e.count;
        bar.avgPrsOpened = e.sumPrsOpened / e.count;
        bar.avgPrsMerged = e.sumPrsMerged / e.count;
        bar.avgReviewsGiven = e.sumReviews / e.count;
        bar.avgChurnRatePct = e.churnWeight > 0 ? e.churnWeightedSum / e.churnWeight : undefined;
        bar.avgAvgCycleHrs = e.cycleWeight > 0 ? e.cycleWeightedSum / e.cycleWeight : undefined;
      }
    }
  }

  // Perception: for entity-first, bars are chronological (most-recent-first)
  for (const group of groups) {
    const chronTotals: number[] = [];
    for (let bi = group.bars.length - 1; bi >= 0; bi--) {
      chronTotals.push(group.bars[bi].total);
    }
    for (let bi = 0; bi < group.bars.length; bi++) {
      const chronIdx = group.bars.length - 1 - bi;
      if (chronIdx < 1) {
        group.bars[bi].perception = 'new';
        continue;
      }
      const windowStart = Math.max(0, chronIdx - 3);
      const window = chronTotals.slice(windowStart, chronIdx + 1);
      group.bars[bi].perception = classifyPerception(window);
    }
  }

  return groups;
}

// ── Top Performers tab data ──────────────────────────────────────────────────

function renderLeaderboard(
  records: UserWeekRepoRecord[],
  currentWeek: string,
  windowWeeks: WindowSize,
): string {
  const weeks = getLastNWeeks(windowWeeks, currentWeek);
  const columns = computeLeaderboard(records, weeks, 5);
  if (columns.length === 0) return '';

  const lines: string[] = [];
  lines.push(
    chalk.bold(`Top Performers (${weekShort(weeks[0])} \u2192 ${weekShort(weeks[weeks.length - 1])})`) +
      '  ' + legend,
  );
  lines.push('');

  const colWidth = 24;
  const headers = columns.map((c) => padRight(chalk.bold(c.title), colWidth));
  lines.push(headers.join(chalk.dim(' | ')));
  const sep = columns.map(() => '\u2500'.repeat(colWidth)).join(chalk.dim('-+-'));
  lines.push(chalk.dim(sep));

  const maxEntries = Math.max(...columns.map((c) => c.entries.length));
  for (let i = 0; i < maxEntries; i++) {
    const nameParts = columns.map((col) => {
      const entry = col.entries[i];
      if (!entry) return padRight('', colWidth);
      const combined = `${entry.rank}. ` + entry.member;
      return padRight(combined, colWidth - 6) + padLeft(fmt(entry.value), 6);
    });
    lines.push(nameParts.join(chalk.dim(' | ')));

    const barParts = columns.map((col) => {
      const entry = col.entries[i];
      if (!entry) return padRight('', colWidth);
      const teamStr = '   ' + chalk.dim(entry.team) + ' ';
      const barWidth = 10;
      let bar: string;
      if (col.metric === 'all') {
        bar = stackedBar(
          [
            { value: entry.filetype.app, color: FILETYPE_COLORS.app, char: FILETYPE_CHARS.app },
            { value: entry.filetype.test, color: FILETYPE_COLORS.test, char: FILETYPE_CHARS.test },
            { value: entry.filetype.config, color: FILETYPE_COLORS.config, char: FILETYPE_CHARS.config },
            { value: entry.filetype.storybook, color: FILETYPE_COLORS.storybook, char: FILETYPE_CHARS.storybook },
            { value: entry.filetype.doc, color: FILETYPE_COLORS.doc, char: FILETYPE_CHARS.doc },
          ],
          barWidth,
        );
      } else {
        const colorFn = FILETYPE_COLORS[col.metric as keyof typeof FILETYPE_COLORS];
        const ch = FILETYPE_CHARS[col.metric as keyof typeof FILETYPE_CHARS];
        const maxVal = Math.max(...col.entries.map((e) => e.value), 1);
        const w = Math.max(1, Math.round((entry.value / maxVal) * barWidth));
        bar = colorFn(ch.repeat(w));
      }
      return teamStr + bar;
    });
    lines.push(barParts.join(chalk.dim(' | ')));
  }

  return lines.join('\n');
}

// ── Contributions detail data ────────────────────────────────────────────────

function buildContributionDetailRows(
  records: UserWeekRepoRecord[],
  buckets: TimeBucket[],
  drillLevel: DrillLevel,
  tagOverlay: boolean,
  config: ViewContext['config'],
): { rows: Record<string, any>[]; groupSeparators: number[] } {
  const rows: Record<string, any>[] = [];
  const groupSeparators: number[] = [];

  for (let bi = 0; bi < buckets.length; bi++) {
    const bucket = buckets[bi];
    const bucketRecords = filterRecords(records, { weeks: bucket.weeks });
    const bucketStartIndex = rows.length;

    let entries: Array<{ label: string; orgType?: 'core' | 'consultant'; key: string }> = [];
    if (tagOverlay) {
      const tagKeys = Object.keys(config.tags ?? {});
      const tagRolled = rollup(bucketRecords, (r) => r.tag);
      for (const [tag] of tagRolled) {
        if (!tagKeys.includes(tag)) tagKeys.push(tag);
      }
      entries = tagKeys.map((t) => ({ label: config.tags?.[t]?.label ?? t, key: t }));
    } else if (drillLevel === 'org') {
      entries = config.orgs.map((o) => ({ label: o.name, orgType: o.type, key: o.name }));
    } else if (drillLevel === 'team') {
      for (const org of config.orgs) {
        for (const team of org.teams) {
          entries.push({ label: team.name, orgType: org.type, key: team.name });
        }
      }
    } else {
      // user level
      const memberRolled = rollup(bucketRecords, (r) => r.member);
      entries = [...memberRolled.keys()].map((m) => ({ label: m, key: m }));
    }

    const groupByFn = tagOverlay ? (r: UserWeekRepoRecord) => r.tag
      : drillLevel === 'org' ? (r: UserWeekRepoRecord) => r.org
      : drillLevel === 'team' ? (r: UserWeekRepoRecord) => r.team
      : (r: UserWeekRepoRecord) => r.member;

    const rolled = rollup(bucketRecords, groupByFn);

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const agg = rolled.get(entry.key);
      if (!agg) continue;

      const prefix = entry.orgType === 'core' ? '\u2605 ' : entry.orgType === 'consultant' ? '\u25C6 ' : '';
      const avgSize = agg.commits > 0 ? Math.round((agg.insertions + agg.deletions) / agg.commits) : 0;

      rows.push({
        week: rows.length === bucketStartIndex ? bucket.label : '',
        group: prefix + entry.label,
        commits: agg.commits,
        avgSize,
        files: agg.filesChanged,
        filesAdded: agg.filesAdded,
        filesDeleted: agg.filesDeleted,
        insertions: agg.insertions,
        deletions: agg.deletions,
        net: agg.netLines,
      });
    }

    // Add group separator after each bucket (except last)
    if (rows.length > 0 && bi < buckets.length - 1) {
      groupSeparators.push(rows.length - 1);
    }
  }

  return { rows, groupSeparators };
}

/**
 * Entity-first detail rows: outer loop = entities, inner loop = time buckets.
 * Each entity gets a header row (with totals) followed by per-period sub-rows.
 */
function buildContributionDetailRowsByEntity(
  records: UserWeekRepoRecord[],
  buckets: TimeBucket[],
  drillLevel: DrillLevel,
  tagOverlay: boolean,
  config: ViewContext['config'],
): { rows: Record<string, any>[]; groupSeparators: number[] } {
  const rows: Record<string, any>[] = [];
  const groupSeparators: number[] = [];

  const groupByFn = tagOverlay ? (r: UserWeekRepoRecord) => r.tag
    : drillLevel === 'org' ? (r: UserWeekRepoRecord) => r.org
    : drillLevel === 'team' ? (r: UserWeekRepoRecord) => r.team
    : (r: UserWeekRepoRecord) => r.member;

  // Build entity list
  let entries: Array<{ label: string; orgType?: 'core' | 'consultant'; key: string }> = [];
  if (tagOverlay) {
    const tagKeys = Object.keys(config.tags ?? {});
    const tagRolled = rollup(records, (r) => r.tag);
    for (const [tag] of tagRolled) {
      if (!tagKeys.includes(tag)) tagKeys.push(tag);
    }
    entries = tagKeys.map((t) => ({ label: config.tags?.[t]?.label ?? t, key: t }));
  } else if (drillLevel === 'org') {
    entries = config.orgs.map((o) => ({ label: o.name, orgType: o.type, key: o.name }));
  } else if (drillLevel === 'team') {
    for (const org of config.orgs) {
      for (const team of org.teams) {
        entries.push({ label: team.name, orgType: org.type, key: team.name });
      }
    }
  } else {
    const memberRolled = rollup(records, groupByFn);
    // Sort members by total lines desc
    const sorted = [...memberRolled.entries()].sort(
      (a, b) => (b[1].insertions + b[1].deletions) - (a[1].insertions + a[1].deletions),
    );
    entries = sorted.map(([m]) => ({ label: m, key: m }));
  }

  // Collect all bucket weeks for filtering
  const allBucketWeeks = new Set(buckets.flatMap((b) => b.weeks));

  for (let ei = 0; ei < entries.length; ei++) {
    const entry = entries[ei];
    const prefix = entry.orgType === 'core' ? '\u2605 ' : entry.orgType === 'consultant' ? '\u25C6 ' : '';

    // Entity total row
    const entityRecords = records.filter((r) => {
      if (!allBucketWeeks.has(r.week)) return false;
      return groupByFn(r) === entry.key;
    });
    if (entityRecords.length === 0) continue;

    const totalRolled = rollup(entityRecords, groupByFn);
    const totalAgg = totalRolled.get(entry.key);
    if (!totalAgg) continue;

    const totalAvgSize = totalAgg.commits > 0 ? Math.round((totalAgg.insertions + totalAgg.deletions) / totalAgg.commits) : 0;

    rows.push({
      group: prefix + entry.label,
      week: 'TOTAL',
      commits: totalAgg.commits,
      avgSize: totalAvgSize,
      files: totalAgg.filesChanged,
      filesAdded: totalAgg.filesAdded,
      filesDeleted: totalAgg.filesDeleted,
      insertions: totalAgg.insertions,
      deletions: totalAgg.deletions,
      net: totalAgg.netLines,
    });

    // Per-bucket sub-rows
    for (const bucket of buckets) {
      const bucketRecords = entityRecords.filter((r) => bucket.weeks.includes(r.week));
      if (bucketRecords.length === 0) continue;

      const rolled = rollup(bucketRecords, groupByFn);
      const agg = rolled.get(entry.key);
      if (!agg) continue;

      const avgSize = agg.commits > 0 ? Math.round((agg.insertions + agg.deletions) / agg.commits) : 0;

      rows.push({
        group: '',
        week: bucket.label,
        commits: agg.commits,
        avgSize,
        files: agg.filesChanged,
        filesAdded: agg.filesAdded,
        filesDeleted: agg.filesDeleted,
        insertions: agg.insertions,
        deletions: agg.deletions,
        net: agg.netLines,
      });
    }

    // Separator between entities (except last)
    if (ei < entries.length - 1) {
      groupSeparators.push(rows.length - 1);
    }
  }

  return { rows, groupSeparators };
}

// ── Tab content renderers ────────────────────────────────────────────────────

function renderContributionsDetailTab(
  ctx: ViewContext,
  drillLevel: DrillLevel,
  tagOverlay: boolean,
  pivotEntity: boolean,
  buckets: TimeBucket[],
  rangeLabel: string,
  periodLabel: string,
  termCols: number,
  records?: UserWeekRepoRecord[],
): void {
  const recs = records ?? ctx.records;
  const modeLabel = tagOverlay ? 'Tag'
    : drillLevel === 'org' ? 'Organization'
    : drillLevel === 'team' ? 'Team' : 'User';
  const firstLabel = buckets[0]?.label ?? '';
  const lastLabel = buckets[buckets.length - 1]?.label ?? '';
  const pivotLabel = pivotEntity ? 'by entity' : 'by time';
  console.log(
    chalk.bold(`Contribution Detail`) + '  ' +
    chalk.dim(`(${modeLabel} view \u00b7 ${pivotLabel} \u00b7 ${rangeLabel} \u00b7 ${firstLabel} \u2192 ${lastLabel})`),
  );
  console.log('');

  const { rows, groupSeparators } = pivotEntity
    ? buildContributionDetailRowsByEntity(recs, buckets, drillLevel, tagOverlay, ctx.config)
    : buildContributionDetailRows(recs, buckets, drillLevel, tagOverlay, ctx.config);

  if (rows.length === 0) {
    console.log(chalk.dim('  No data for this time window.'));
    return;
  }

  // Swap column order: entity-first puts entity name first, time-first puts period first
  const col1 = pivotEntity
    ? { key: 'group', label: modeLabel, minWidth: 12 }
    : { key: 'week', label: periodLabel, minWidth: 4 };
  const col2 = pivotEntity
    ? { key: 'week', label: periodLabel, minWidth: 6 }
    : { key: 'group', label: modeLabel, minWidth: 12 };

  console.log(renderTable({
    columns: [
      col1,
      col2,
      { key: 'commits', label: 'Commits', align: 'right', minWidth: 7 },
      { key: 'avgSize', label: 'Avg Size', align: 'right', minWidth: 8, format: (v) => fmt(v) },
      { key: 'filesAdded', label: '+Files', align: 'right', minWidth: 6, format: (v) => chalk.green(fmt(v)) },
      { key: 'filesDeleted', label: '-Files', align: 'right', minWidth: 6, format: (v) => chalk.red(fmt(v)) },
      { key: 'insertions', label: '+Lines', align: 'right', minWidth: 7, format: (v) => chalk.green(fmt(v)) },
      { key: 'deletions', label: '-Lines', align: 'right', minWidth: 7, format: (v) => chalk.red(fmt(v)) },
      { key: 'net', label: 'Net', align: 'right', minWidth: 6, format: (v) => v >= 0 ? chalk.green(fmt(v)) : chalk.red(fmt(v)) },
    ],
    rows,
    maxWidth: termCols,
    groupSeparator: groupSeparators,
  }));
}

function renderContributionsTab(
  ctx: ViewContext,
  drillLevel: DrillLevel,
  tagOverlay: boolean,
  pivotEntity: boolean,
  buckets: TimeBucket[],
  granularity: ContribGranularity,
  rangeLabel: string,
  termCols: number,
  labelWidth?: number,
  records?: UserWeekRepoRecord[],
  excludedSegments?: Set<Segment>,
  detailLayers?: Set<DetailLayer>,
  enrichments?: EnrichmentStore,
  perUserMode = false,
): void {
  const recs = records ?? ctx.records;
  const modeLabel = tagOverlay ? 'Tag'
    : drillLevel === 'org' ? 'Organization'
    : drillLevel === 'team' ? 'Team' : 'User';
  const byLabel = pivotEntity ? modeLabel
    : granularity === 'week' ? 'Week'
    : granularity === 'month' ? 'Month'
    : granularity === 'quarter' ? 'Quarter' : 'Year';
  const firstLabel = buckets[0]?.label ?? '';
  const lastLabel = buckets[buckets.length - 1]?.label ?? '';
  console.log(
    chalk.bold(`Contribution by ${byLabel}`) + '  ' +
    chalk.dim(`(${pivotEntity ? 'by entity' : 'by time'} \u00b7 ${rangeLabel} \u00b7 ${firstLabel} \u2192 ${lastLabel})`) +
    '  ' + legend,
  );
  console.log('');

  let groups = pivotEntity
    ? buildContributionGroupsByEntity(recs, buckets, drillLevel, tagOverlay, ctx.config, enrichments)
    : buildContributionGroups(recs, buckets, drillLevel, tagOverlay, ctx.config, enrichments);

  // Stamp segments onto bars and optionally filter by excluded segments.
  // Segments are computed per-group (per time bucket in by-time mode, per entity in by-entity mode)
  // so that each group gets its own 20/60/20 distribution.
  if (!pivotEntity) {
    // By-time mode: each group is a time bucket, bars are entities.
    // Compute segments across all bars using the global (all-bucket) member totals.
    const memberTotals = new Map<string, number>();
    for (const g of groups) {
      for (const bar of g.bars) {
        memberTotals.set(bar.label, (memberTotals.get(bar.label) ?? 0) + bar.total);
      }
    }
    const segMap = calculateSegments(memberTotals);
    for (const g of groups) {
      for (const bar of g.bars) {
        bar.segment = segMap.get(bar.label);
      }
    }
  } else {
    // By-entity mode: each group is an entity, bars are time buckets. No per-bar segmentation.
    // Segment the entities (groups) themselves by their total across all bars.
    const entityTotals = new Map<string, number>();
    for (const g of groups) {
      const total = g.bars.reduce((s, b) => s + b.total, 0);
      entityTotals.set(g.groupLabel, total);
    }
    const segMap = calculateSegments(entityTotals);
    for (const g of groups) {
      const seg = segMap.get(g.groupLabel);
      if (seg) {
        // Stamp segment on all bars in this group for display
        for (const bar of g.bars) {
          bar.segment = seg;
        }
        // Prefix group label with segment indicator
        const ind = SEGMENT_INDICATORS[seg];
        g.groupLabel = ind.color(ind.char) + ' ' + g.groupLabel;
      }
    }
  }

  // Filter by excluded segments
  if (excludedSegments && excludedSegments.size > 0) {
    if (!pivotEntity) {
      for (const g of groups) {
        g.bars = g.bars.filter((b) => !b.segment || !excludedSegments.has(b.segment));
      }
      groups = groups.filter((g) => g.bars.length > 0);
    } else {
      // Filter entire entity groups
      const entityTotals = new Map<string, number>();
      for (const g of groups) {
        entityTotals.set(g.groupLabel, g.bars.reduce((s, b) => s + b.total, 0));
      }
      groups = groups.filter((g) => {
        const seg = g.bars[0]?.segment;
        return !seg || !excludedSegments.has(seg);
      });
    }
  }

  // Build an "Avg" summary row from the per-label averages already stamped on bars
  if (groups.length > 1 && groups[0].bars.length > 0) {
    // Build chronological totals per label for sparklines
    const labelChronTotals = new Map<string, number[]>();
    for (let gi = groups.length - 1; gi >= 0; gi--) {
      for (const bar of groups[gi].bars) {
        const hist = labelChronTotals.get(bar.label) ?? [];
        hist.push(bar.total);
        labelChronTotals.set(bar.label, hist);
      }
    }

    const seen = new Set<string>();
    const avgBars: HBar[] = [];
    for (const g of groups) {
      for (const bar of g.bars) {
        if (seen.has(bar.label)) continue;
        seen.add(bar.label);
        // Average the segments proportionally
        const segTotals = new Map<string, number>();
        let count = 0;
        for (const gg of groups) {
          for (const b of gg.bars) {
            if (b.label !== bar.label) continue;
            for (const seg of b.segments) {
              segTotals.set(seg.key, (segTotals.get(seg.key) ?? 0) + seg.value);
            }
            count++;
          }
        }
        avgBars.push({
          label: bar.label,
          orgType: bar.orgType,
          segments: bar.segments.map((s) => ({
            key: s.key,
            value: Math.round((segTotals.get(s.key) ?? 0) / count),
          })),
          total: Math.round(bar.avg ?? 0),
          insertions: Math.round(bar.avgInsertions ?? 0),
          deletions: Math.round(bar.avgDeletions ?? 0),
          testPct: Math.round(bar.avgTestPct ?? 0),
          commits: Math.round(bar.avgCommits ?? 0),
          activeDays: Math.round(bar.avgActiveDays ?? 0),
          headcount: Math.round(bar.avgHeadcount ?? 0),
          churnRatePct: bar.avgChurnRatePct !== undefined ? Math.round(bar.avgChurnRatePct * 10) / 10 : undefined,
          prsOpened: bar.avgPrsOpened !== undefined ? Math.round(bar.avgPrsOpened) : undefined,
          prsMerged: bar.avgPrsMerged !== undefined ? Math.round(bar.avgPrsMerged) : undefined,
          avgCycleHrs: bar.avgAvgCycleHrs,
          reviewsGiven: bar.avgReviewsGiven !== undefined ? Math.round(bar.avgReviewsGiven) : undefined,
          isAverage: true,
          sparkData: labelChronTotals.get(bar.label),
        });
      }
    }
    groups.push({ groupLabel: 'Avg', bars: avgBars, isSummary: true });

    // At user drill level, add a "Team Avg" summary row showing the per-member
    // average within each member's team (so members can compare to their team).
    if (drillLevel === 'user' && !tagOverlay && !pivotEntity) {
      const memberTeamMap = new Map<string, string>();
      for (const r of recs) {
        if (!memberTeamMap.has(r.member)) memberTeamMap.set(r.member, r.team);
      }

      // Collect per-team per-bucket totals
      const teamBucketData = new Map<string, {
        sumTotal: number; sumIns: number; sumDel: number;
        sumCommits: number; sumActiveDays: number; sumTestPct: number;
        segTotals: Map<string, number>; memberCount: number; bucketCount: number;
        sumPrsOpened: number; sumPrsMerged: number; sumReviews: number;
        churnWeightedSum: number; churnWeight: number;
        cycleWeightedSum: number; cycleWeight: number;
      }>();

      for (const g of groups) {
        if (g.isSummary) continue;
        // Count members per team in this bucket
        const teamMembers = new Map<string, number>();
        for (const bar of g.bars) {
          const team = memberTeamMap.get(bar.label) ?? 'unassigned';
          teamMembers.set(team, (teamMembers.get(team) ?? 0) + 1);
        }
        for (const bar of g.bars) {
          const team = memberTeamMap.get(bar.label) ?? 'unassigned';
          const mc = teamMembers.get(team) ?? 1;
          const e = teamBucketData.get(team) ?? {
            sumTotal: 0, sumIns: 0, sumDel: 0,
            sumCommits: 0, sumActiveDays: 0, sumTestPct: 0,
            segTotals: new Map(), memberCount: mc, bucketCount: 0,
            sumPrsOpened: 0, sumPrsMerged: 0, sumReviews: 0,
            churnWeightedSum: 0, churnWeight: 0,
            cycleWeightedSum: 0, cycleWeight: 0,
          };
          e.sumTotal += bar.total;
          e.sumIns += bar.insertions ?? 0;
          e.sumDel += bar.deletions ?? 0;
          e.sumCommits += bar.commits ?? 0;
          e.sumActiveDays += bar.activeDays ?? 0;
          e.sumTestPct += bar.testPct ?? 0;
          for (const seg of bar.segments) {
            e.segTotals.set(seg.key, (e.segTotals.get(seg.key) ?? 0) + seg.value);
          }
          e.sumPrsOpened += bar.prsOpened ?? 0;
          e.sumPrsMerged += bar.prsMerged ?? 0;
          e.sumReviews += bar.reviewsGiven ?? 0;
          if (bar.churnRatePct !== undefined) {
            const linesWeight = bar.total;
            e.churnWeightedSum += bar.churnRatePct * linesWeight;
            e.churnWeight += linesWeight;
          }
          if (bar.avgCycleHrs !== undefined && bar.prsMerged) {
            e.cycleWeightedSum += bar.avgCycleHrs * bar.prsMerged;
            e.cycleWeight += bar.prsMerged;
          }
          e.memberCount = mc;
          teamBucketData.set(team, e);
        }
      }

      // Count non-summary buckets
      const bucketCount = groups.filter((g) => !g.isSummary).length;

      // Build one bar per team showing average per member per bucket
      const teamAvgBars: HBar[] = [];
      for (const [team, data] of teamBucketData) {
        const divisor = data.memberCount * bucketCount;
        if (divisor === 0) continue;
        teamAvgBars.push({
          label: team,
          segments: [...data.segTotals.entries()].map(([key, val]) => ({
            key,
            value: Math.round(val / divisor),
          })),
          total: Math.round(data.sumTotal / divisor),
          insertions: Math.round(data.sumIns / divisor),
          deletions: Math.round(data.sumDel / divisor),
          testPct: Math.round(data.sumTestPct / divisor),
          commits: Math.round(data.sumCommits / divisor),
          activeDays: Math.round(data.sumActiveDays / divisor),
          headcount: data.memberCount,
          prsOpened: data.sumPrsOpened > 0 ? Math.round(data.sumPrsOpened / divisor) : undefined,
          prsMerged: data.sumPrsMerged > 0 ? Math.round(data.sumPrsMerged / divisor) : undefined,
          reviewsGiven: data.sumReviews > 0 ? Math.round(data.sumReviews / divisor) : undefined,
          churnRatePct: data.churnWeight > 0 ? data.churnWeightedSum / data.churnWeight : undefined,
          avgCycleHrs: data.cycleWeight > 0 ? data.cycleWeightedSum / data.cycleWeight : undefined,
          isAverage: true,
        });
      }
      if (teamAvgBars.length > 0) {
        groups.push({ groupLabel: 'Team Avg', bars: teamAvgBars, isSummary: true });
      }
    }
  }

  const trendPct = ctx.config.settings.trend_threshold;
  console.log(renderGroupedHBarChart({
    groups,
    segmentDefs: SEGMENT_DEFS,
    maxBarWidth: 30,
    maxWidth: termCols,
    showValues: true,
    showXAxis: false,
    labelWidth,
    trendThreshold: trendPct,
    detailLayers,
    perUserMode,
  }));
  console.log('');

  // ── Footer: aggregate totals + avg per period + legend ──
  const allBucketWeeks = buckets.flatMap((b) => b.weeks);
  const windowRecords = filterRecords(recs, { weeks: allBucketWeeks });
  const agg = rollup(windowRecords, () => '__all__').get('__all__');
  const periodCount = buckets.length;

  if (agg) {
    const members = new Set(windowRecords.map((r) => r.member));
    const net = agg.insertions - agg.deletions;
    const netStr = net >= 0 ? '+' + fmt(net) : '-' + fmt(Math.abs(net));
    const netColor = net >= 0 ? chalk.green : chalk.red;

    // Totals line
    console.log(
      chalk.dim('  \u03A3 ') +
      chalk.green('+' + fmt(agg.insertions)) + chalk.dim(' ins  ') +
      chalk.red('-' + fmt(agg.deletions)) + chalk.dim(' del  ') +
      netColor(netStr) + chalk.dim(' net  ') +
      chalk.dim(fmt(agg.commits) + ' cmts  ') +
      chalk.dim(fmt(agg.activeDays) + ' days  ') +
      chalk.dim(`(${members.size} contributors)`),
    );

    // Avg per period line
    if (periodCount > 1) {
      const avgIns = Math.round(agg.insertions / periodCount);
      const avgDel = Math.round(agg.deletions / periodCount);
      const avgNet = Math.round(net / periodCount);
      const avgNetStr = avgNet >= 0 ? '+' + fmt(avgNet) : '-' + fmt(Math.abs(avgNet));
      const avgCmts = Math.round(agg.commits / periodCount);
      const avgDays = Math.round(agg.activeDays / periodCount);

      console.log(
        chalk.dim(`  \u00F8 `) +
        chalk.dim(`+${fmt(avgIns)} ins  -${fmt(avgDel)} del  ${avgNetStr} net  ${fmt(avgCmts)} cmts  ${fmt(avgDays)} days  per ${granularity}`),
      );
    }
  }

  // PRs footer summary (when enrichment data exists and any PR data is present)
  if (enrichments) {
    let totalPrsOpened = 0;
    let totalPrsMerged = 0;
    let totalReviews = 0;
    let cycleSum = 0;
    let cycleWeight = 0;
    for (const g of groups) {
      if (g.isSummary) continue;
      for (const bar of g.bars) {
        totalPrsOpened += bar.prsOpened ?? 0;
        totalPrsMerged += bar.prsMerged ?? 0;
        totalReviews += bar.reviewsGiven ?? 0;
        if (bar.avgCycleHrs !== undefined && bar.prsMerged) {
          cycleSum += bar.avgCycleHrs * bar.prsMerged;
          cycleWeight += bar.prsMerged;
        }
      }
    }
    if (totalPrsOpened > 0 || totalPrsMerged > 0) {
      const avgCycle = cycleWeight > 0 ? cycleSum / cycleWeight : 0;
      const cycleStr = avgCycle >= 24 ? `${(avgCycle / 24).toFixed(1)}d` : `${avgCycle.toFixed(1)}h`;
      console.log(
        chalk.dim('  \u03A3 ') +
        chalk.dim(`${fmt(totalPrsOpened)} PRs opened  `) +
        chalk.dim(`${fmt(totalPrsMerged)} merged  `) +
        chalk.dim(`${cycleStr} avg cycle  `) +
        chalk.dim(`${fmt(totalReviews)} reviews`),
      );
    }
  }

  // Legend
  const trendPctLabel = Math.round(trendPct * 100);
  console.log(
    chalk.dim('  ') +
    chalk.green('\u25B2') + chalk.dim(' above avg  ') +
    chalk.red('\u25BC') + chalk.dim(' below avg  ') +
    chalk.bgGreen.black('\u25B2') + chalk.dim(' above avg+team  ') +
    chalk.bgRed.black('\u25BC') + chalk.dim(' below avg+team  ') +
    chalk.dim(`\u25CB within ${trendPctLabel}%`),
  );
}

function renderRepoActivityTab(ctx: ViewContext, windowWeeks: WindowSize, termCols: number): void {
  const weeks = getLastNWeeks(windowWeeks, ctx.currentWeek);
  console.log(
    chalk.bold(`Contribution by Repo`) + '  ' +
    chalk.dim(`(${WINDOW_LABELS[windowWeeks]} \u00b7 ${weekShort(weeks[0])} \u2192 ${weekShort(weeks[weeks.length - 1])})`) +
    '  ' + legend,
  );
  console.log('');
  const groups = buildRepoOrgGroups(ctx.records, weeks, ctx.config);
  console.log(renderGroupedHBarChart({
    groups,
    segmentDefs: SEGMENT_DEFS,
    maxWidth: termCols,
    showValues: true,
    showXAxis: false,
  }));
  const totalRepos = groups.length;
  const totalLines = groups.reduce((sum, g) => sum + g.bars.reduce((s, b) => s + b.total, 0), 0);
  console.log('');
  console.log(chalk.dim(`  ${totalRepos} repos \u00b7 ${fmt(totalLines)} lines changed over ${WINDOW_LABELS[windowWeeks]}`));
}

function renderTopPerformersTab(ctx: ViewContext, windowWeeks: WindowSize): void {
  const output = renderLeaderboard(ctx.records, ctx.currentWeek, windowWeeks);
  if (output) {
    console.log(output);
  } else {
    console.log(chalk.dim('  No data for this time window.'));
  }
}

// ── Key mapping ──────────────────────────────────────────────────────────────

function mapKey(
  keyName: string,
  activeTab: TabId,
  repoWindowWeeks: WindowSize,
  leaderboardWindowWeeks: WindowSize,
  numberedTeams: Array<{ key: string; teamName: string }>,
): string | null {
  // Tab cycling
  if (keyName === 'tab') return `tab:next`;

  // Global
  if (keyName === 'q') return 'quit';

  // Tab-specific
  switch (activeTab) {
    case 'contributions':
      if (keyName === '+' || keyName === '=') return 'contrib_granularity_finer';
      if (keyName === '-') return 'contrib_granularity_coarser';
      if (keyName === 'right') return 'contrib_extend';
      if (keyName === 'left') return 'contrib_shrink';
      if (keyName === 'down') return 'contrib_drill_down';
      if (keyName === 'up') return 'contrib_drill_up';
      if (keyName === 't') return 'contrib_toggle_tag';
      if (keyName === 'd') return 'contrib_toggle_detail';
      if (keyName === 'v') return 'contrib_toggle_pivot';
      if (keyName === 'h') return 'contrib_toggle_unassigned';
      if (keyName === 'u') return 'contrib_toggle_peruser';
      if (keyName === 's') return 'contrib_segment_menu';
      // Numbered team drill-down
      for (const t of numberedTeams) {
        if (keyName === t.key) return `team:${t.teamName}`;
      }
      break;
    case 'repo_activity':
      if (keyName === '1' && repoWindowWeeks !== 4) return 'repo_window_4';
      if (keyName === '2' && repoWindowWeeks !== 8) return 'repo_window_8';
      if (keyName === '3' && repoWindowWeeks !== 12) return 'repo_window_12';
      break;
    case 'top_performers':
      if (keyName === '1' && leaderboardWindowWeeks !== 4) return 'lb_window_4';
      if (keyName === '2' && leaderboardWindowWeeks !== 8) return 'lb_window_8';
      if (keyName === '3' && leaderboardWindowWeeks !== 12) return 'lb_window_12';
      break;
    case 'manage':
      if (keyName === 'r') return 'manage_repos';
      if (keyName === 'o') return 'manage_orgs';
      if (keyName === 'a') return 'manage_authors';
      if (keyName === 'g') return 'manage_groups';
      if (keyName === 't') return 'manage_tags';
      if (keyName === 's') return 'manage_scan_all';
      if (keyName === 'd') return 'manage_scan_dir';
      if (keyName === 'up') return 'manage_cursor_up';
      if (keyName === 'down') return 'manage_cursor_down';
      if (keyName === 'return') return 'manage_action_selected';
      if (keyName === 'x' || keyName === 'backspace') return 'manage_remove_repo';
      if (keyName === 'n') return 'manage_new_org';
      if (keyName === '+' || keyName === '=') return 'manage_add_team';
      if (keyName === '-') return 'manage_remove_team';
      if (keyName === 'u') return 'manage_unassign_author';
      if (keyName === 'e') return 'manage_export';
      if (keyName === 'p') return 'manage_bulk_assign';
      break;
  }

  return null; // unrecognized key — re-render
}

// ── Hotkey bar builder ───────────────────────────────────────────────────────

function buildHotkeyItems(
  activeTab: TabId,
  drillLevel: DrillLevel,
  tagOverlay: boolean,
  contribGranularity: ContribGranularity,
  contribDepth: number,
  detailLayers: Set<DetailLayer>,
  contribTableMode: boolean,
  contribPivotEntity: boolean,
  contribPerUserMode: boolean,
  contribHideUnassigned: boolean,
  excludedSegments: Set<Segment>,
  repoWindow: WindowSize,
  lbWindow: WindowSize,
): Array<{ key: string; label: string }> {
  const items: Array<{ key: string; label: string }> = [];

  const granShort = contribGranularity[0]; // w, m, q, y

  switch (activeTab) {
    case 'contributions': {
      const drillIdx = DRILL_ORDER.indexOf(drillLevel);
      if (drillIdx < DRILL_ORDER.length - 1) {
        items.push({ key: '\u2193', label: `${DRILL_ORDER[drillIdx + 1]}` });
      }
      if (drillIdx > 0) {
        items.push({ key: '\u2191', label: `${DRILL_ORDER[drillIdx - 1]}` });
      }
      items.push({ key: tagOverlay ? '[T]' : 'T', label: 'Tags' });
      items.push({ key: '+/-', label: contribGranularity });
      items.push({ key: '\u2190/\u2192', label: `${contribDepth}${granShort}` });
      const hasAnyDetail = detailLayers.size > 0 || contribTableMode;
      let dLabel = 'Detail';
      if (contribTableMode) {
        dLabel = 'Table';
      } else if (detailLayers.has('lines')) {
        dLabel = 'Lines';
      }
      items.push({ key: hasAnyDetail ? '[D]' : 'D', label: dLabel });
      items.push({ key: contribPivotEntity ? '[V]' : 'V', label: contribPivotEntity ? 'By Entity' : 'By Time' });
      items.push({ key: contribPerUserMode ? '[U]' : 'U', label: contribPerUserMode ? '/user' : 'Total' });
      items.push({ key: contribHideUnassigned ? '[H]' : 'H', label: contribHideUnassigned ? 'Assigned' : 'Show all' });
      if (excludedSegments.size > 0) {
        const excluded = [...excludedSegments].map((s) => s[0].toUpperCase()).join('');
        items.push({ key: '[S]', label: `-${excluded}` });
      } else {
        items.push({ key: 'S', label: 'Seg' });
      }
      break;
    }
    case 'repo_activity':
      if (repoWindow !== 4) items.push({ key: '1', label: '4 weeks' });
      if (repoWindow !== 8) items.push({ key: '2', label: '8 weeks' });
      if (repoWindow !== 12) items.push({ key: '3', label: '3 months' });
      break;
    case 'top_performers':
      if (lbWindow !== 4) items.push({ key: '1', label: '4 weeks' });
      if (lbWindow !== 8) items.push({ key: '2', label: '8 weeks' });
      if (lbWindow !== 12) items.push({ key: '3', label: '3 months' });
      break;
  }

  items.push({ key: 'Q', label: 'Quit' });

  return items;
}

// ── Dashboard view ───────────────────────────────────────────────────────────

/**
 * Dashboard view — tabbed entry screen with instant hotkey navigation.
 *
 * Four tabs: Contributions, Avg Output, Repo Activity, Top Performers.
 * Press a single key to switch tabs, toggle options, or drill down.
 * No scrollable menus — every action is one keypress away.
 */
export async function dashboardView(ctx: ViewContext): Promise<NavigationAction> {
  const initialWindow = toWindowSize(ctx.config.settings.weeks_back);
  let activeTab: TabId = 'contributions';
  let contribDrillLevel: DrillLevel = 'org';
  let contribTagOverlay = false;
  let contribGranularity: ContribGranularity = 'week';
  let contribDepth: number = ctx.config.settings.weeks_back;
  let contribDetailLayers = new Set<DetailLayer>();
  let contribTableMode = false;
  let contribPivotEntity = false;
  let contribPerUserMode = false;
  let contribHideUnassigned = true;
  let contribExcludedSegments = new Set<Segment>();
  let repoWindowWeeks: WindowSize = initialWindow;
  let leaderboardWindowWeeks: WindowSize = initialWindow;
  let manageSection: ManageSectionId = 'repos';
  let manageRepoNames: string[] = [];
  let manageRepoIdx = 0;
  let manageAuthorGroups: string[][] = [];
  let manageAuthorIdx = 0;

  const numberedTeams = getNumberedTeams(ctx.config);

  // Pre-compute label width across all drill levels so columns stay stable
  let contribLabelWidth = 14;
  for (const org of ctx.config.orgs) {
    const orgLen = org.name.length + 2; // "★ " or "◆ " prefix
    if (orgLen > contribLabelWidth) contribLabelWidth = orgLen;
    for (const team of org.teams) {
      const teamLen = team.name.length + 2;
      if (teamLen > contribLabelWidth) contribLabelWidth = teamLen;
    }
  }
  for (const [tag, meta] of Object.entries(ctx.config.tags ?? {})) {
    const tagLen = (meta?.label ?? tag).length;
    if (tagLen > contribLabelWidth) contribLabelWidth = tagLen;
  }
  // Include member names for user drill level
  for (const r of ctx.records) {
    if (r.member.length > contribLabelWidth) contribLabelWidth = r.member.length;
  }
  contribLabelWidth += 1; // padding

  while (true) {
    const termCols = process.stdout.columns || 100;

    // Clear screen + scrollback buffer + move cursor home
    process.stdout.write('\x1B[2J\x1B[3J\x1B[H');

    // Banner
    console.log(renderBanner({ title: 'GitRadar' }));

    // Tab bar
    console.log(renderTabBar(TABS, activeTab));

    // Hotkey bar
    let hotkeys: Array<{ key: string; label: string }>;
    if (activeTab === 'manage') {
      hotkeys = buildManageHotkeyItems(
        manageSection,
        ctx.config.repos.length > 0,
        (ctx.authorRegistry ? Object.keys(ctx.authorRegistry.authors).length : 0) > 0,
        ctx.config.orgs.length > 0,
      );
    } else {
      hotkeys = buildHotkeyItems(
        activeTab, contribDrillLevel, contribTagOverlay, contribGranularity, contribDepth,
        contribDetailLayers, contribTableMode, contribPivotEntity, contribPerUserMode, contribHideUnassigned, contribExcludedSegments, repoWindowWeeks, leaderboardWindowWeeks,
      );
    }
    console.log(renderHotkeyBar(hotkeys));

    // Breadcrumb row (contributions tab — shows drill level + numbered team drill-downs)
    if (activeTab === 'contributions') {
      const modeLabel = contribTagOverlay ? 'By Tag'
        : contribDrillLevel === 'org' ? 'By Org'
        : contribDrillLevel === 'team' ? 'By Team' : 'By User';
      console.log(renderBreadcrumb([modeLabel], numberedTeams));
    }
    console.log('');

    // Build time buckets and range label for contributions tab
    const contribBuckets = buildTimeBuckets(contribGranularity, contribDepth, ctx.currentWeek, ctx.records);
    const contribRangeLabel = `${contribDepth} ${contribGranularity}s`;
    const contribPeriodLabel = contribGranularity === 'week' ? 'Week'
      : contribGranularity === 'month' ? 'Month'
      : contribGranularity === 'quarter' ? 'Quarter' : 'Year';

    // Tab content
    const contribRecords = contribHideUnassigned
      ? ctx.records.filter((r) => r.org !== 'unassigned')
      : ctx.records;

    switch (activeTab) {
      case 'contributions':
        if (contribTableMode) {
          renderContributionsDetailTab(ctx, contribDrillLevel, contribTagOverlay, contribPivotEntity, contribBuckets, contribRangeLabel, contribPeriodLabel, termCols, contribRecords);
        } else {
          renderContributionsTab(ctx, contribDrillLevel, contribTagOverlay, contribPivotEntity, contribBuckets, contribGranularity, contribRangeLabel, termCols, contribLabelWidth, contribRecords, contribExcludedSegments, contribDetailLayers, ctx.enrichments, contribPerUserMode);
        }
        break;
      case 'repo_activity':
        renderRepoActivityTab(ctx, repoWindowWeeks, termCols);
        break;
      case 'top_performers':
        renderTopPerformersTab(ctx, leaderboardWindowWeeks);
        break;
      case 'manage': {
        // Clamp cursors to valid range
        if (manageRepoIdx >= ctx.config.repos.length) {
          manageRepoIdx = Math.max(0, ctx.config.repos.length - 1);
        }
        const authorCount = ctx.authorRegistry ? Object.keys(ctx.authorRegistry.authors).length : 0;
        if (manageAuthorIdx >= authorCount) {
          manageAuthorIdx = Math.max(0, authorCount - 1);
        }
        const manageResult = renderManageTab(ctx, manageSection, termCols, manageRepoIdx, manageAuthorIdx);
        manageRepoNames = manageResult.repoNames;
        manageAuthorGroups = manageResult.authorEmailGroups;
        break;
      }
    }

    // Wait for keypress (with timeout to poll for external DB changes)
    try {
      const POLL_INTERVAL_MS = 5_000;
      const key = ctx.onRefreshData
        ? await readKeyWithTimeout(POLL_INTERVAL_MS)
        : await readKey();

      // Timeout — check if background process updated the database
      if (key === null) {
        ctx.onRefreshData?.();
        continue; // re-render (with potentially fresh data)
      }

      const action = mapKey(
        key.name, activeTab,
        repoWindowWeeks, leaderboardWindowWeeks, numberedTeams,
      );

      if (!action) continue; // unrecognized key — re-render

      // Tab switches
      if (action === 'tab:next') {
        const tabIds = TABS.map((t) => t.id) as TabId[];
        const idx = tabIds.indexOf(activeTab);
        activeTab = tabIds[(idx + 1) % tabIds.length];
        continue;
      }
      if (action.startsWith('tab:')) {
        activeTab = action.slice(4) as TabId;
        continue;
      }

      // Contributions: granularity (+/-)
      if (action === 'contrib_granularity_finer') {
        const idx = GRANULARITY_ORDER.indexOf(contribGranularity);
        if (idx < GRANULARITY_ORDER.length - 1) {
          contribGranularity = GRANULARITY_ORDER[idx + 1];
          contribDepth = GRANULARITY_DEFAULTS[contribGranularity];
        }
        continue;
      }
      if (action === 'contrib_granularity_coarser') {
        const idx = GRANULARITY_ORDER.indexOf(contribGranularity);
        if (idx > 0) {
          contribGranularity = GRANULARITY_ORDER[idx - 1];
          contribDepth = GRANULARITY_DEFAULTS[contribGranularity];
        }
        continue;
      }
      // Contributions: timeframe (←/→)
      if (action === 'contrib_extend') {
        const bounds = DEPTH_BOUNDS[contribGranularity];
        contribDepth = Math.min(bounds.max, contribDepth + bounds.step);
        continue;
      }
      if (action === 'contrib_shrink') {
        const bounds = DEPTH_BOUNDS[contribGranularity];
        contribDepth = Math.max(bounds.min, contribDepth - bounds.step);
        continue;
      }
      // Contributions: drill level (↑/↓)
      if (action === 'contrib_drill_down') {
        const idx = DRILL_ORDER.indexOf(contribDrillLevel);
        if (idx < DRILL_ORDER.length - 1) {
          contribDrillLevel = DRILL_ORDER[idx + 1];
        }
        continue;
      }
      if (action === 'contrib_drill_up') {
        const idx = DRILL_ORDER.indexOf(contribDrillLevel);
        if (idx > 0) {
          contribDrillLevel = DRILL_ORDER[idx - 1];
        }
        continue;
      }
      // Contributions: tag overlay toggle
      if (action === 'contrib_toggle_tag') { contribTagOverlay = !contribTagOverlay; continue; }
      // Contributions: detail toggle
      if (action === 'contrib_toggle_detail') {
        process.stdout.write('\n');
        console.log(chalk.bold('  Detail View:'));
        console.log(`  ${chalk.cyan('L')}  ${contribDetailLayers.has('lines') ? chalk.underline('Lines') : 'Lines'} ${chalk.dim('(+ins · -del · tst% · churn)')}`);
        console.log(`  ${chalk.cyan('T')}  ${contribTableMode ? chalk.underline('Table') : 'Table'} ${chalk.dim('(full numeric table)')}`);
        console.log(chalk.dim('  Esc  Clear\n'));
        const detailKey = await readKey();
        if (detailKey.name === 'l') {
          contribTableMode = false;
          if (contribDetailLayers.has('lines')) contribDetailLayers.delete('lines');
          else contribDetailLayers.add('lines');
        } else if (detailKey.name === 't') {
          contribTableMode = !contribTableMode;
          contribDetailLayers.clear();
        } else {
          contribDetailLayers.clear();
          contribTableMode = false;
        }
        continue;
      }
      // Contributions: pivot toggle (time-first ↔ entity-first)
      if (action === 'contrib_toggle_peruser') { contribPerUserMode = !contribPerUserMode; continue; }
      if (action === 'contrib_toggle_pivot') { contribPivotEntity = !contribPivotEntity; continue; }
      // Contributions: show/hide unassigned authors
      if (action === 'contrib_toggle_unassigned') { contribHideUnassigned = !contribHideUnassigned; continue; }

      // Contributions: segment exclusion menu
      if (action === 'contrib_segment_menu') {
        process.stdout.write('\n');
        console.log(chalk.bold('  Segment Filter:'));
        console.log(`  ${chalk.cyan('H')}  ${contribExcludedSegments.has('high') ? chalk.strikethrough('High (top 20%)') : 'Hide High (top 20%)'}`);
        console.log(`  ${chalk.cyan('M')}  ${contribExcludedSegments.has('middle') ? chalk.strikethrough('Middle (60%)') : 'Hide Middle (60%)'}`);
        console.log(`  ${chalk.cyan('L')}  ${contribExcludedSegments.has('low') ? chalk.strikethrough('Low (bottom 20%)') : 'Hide Low (bottom 20%)'}`);
        console.log(`  ${chalk.cyan('A')}  Show All (reset)`);
        console.log(chalk.dim('  Esc  Cancel\n'));
        const segKey = await readKey();
        if (segKey.name === 'h') {
          if (contribExcludedSegments.has('high')) contribExcludedSegments.delete('high');
          else contribExcludedSegments.add('high');
        } else if (segKey.name === 'm') {
          if (contribExcludedSegments.has('middle')) contribExcludedSegments.delete('middle');
          else contribExcludedSegments.add('middle');
        } else if (segKey.name === 'l') {
          if (contribExcludedSegments.has('low')) contribExcludedSegments.delete('low');
          else contribExcludedSegments.add('low');
        } else if (segKey.name === 'a') {
          contribExcludedSegments = new Set<Segment>();
        }
        continue;
      }

      // Repo Activity window
      if (action === 'repo_window_4') { repoWindowWeeks = 4; continue; }
      if (action === 'repo_window_8') { repoWindowWeeks = 8; continue; }
      if (action === 'repo_window_12') { repoWindowWeeks = 12; continue; }

      // Top Performers window
      if (action === 'lb_window_4') { leaderboardWindowWeeks = 4; continue; }
      if (action === 'lb_window_8') { leaderboardWindowWeeks = 8; continue; }
      if (action === 'lb_window_12') { leaderboardWindowWeeks = 12; continue; }

      // Manage tab: section switches
      if (action === 'manage_repos') { manageSection = 'repos'; continue; }
      if (action === 'manage_orgs') { manageSection = 'orgs'; continue; }
      if (action === 'manage_authors') { manageSection = 'authors'; continue; }
      if (action === 'manage_groups') { manageSection = 'groups'; continue; }
      if (action === 'manage_tags') { manageSection = 'tags'; continue; }

      // Manage tab: cursor navigation
      if (action === 'manage_cursor_up') {
        if (manageSection === 'repos' && manageRepoNames.length > 0) {
          manageRepoIdx = (manageRepoIdx - 1 + manageRepoNames.length) % manageRepoNames.length;
        } else if (manageSection === 'authors' && manageAuthorGroups.length > 0) {
          manageAuthorIdx = (manageAuthorIdx - 1 + manageAuthorGroups.length) % manageAuthorGroups.length;
        }
        continue;
      }
      if (action === 'manage_cursor_down') {
        if (manageSection === 'repos' && manageRepoNames.length > 0) {
          manageRepoIdx = (manageRepoIdx + 1) % manageRepoNames.length;
        } else if (manageSection === 'authors' && manageAuthorGroups.length > 0) {
          manageAuthorIdx = (manageAuthorIdx + 1) % manageAuthorGroups.length;
        }
        continue;
      }

      // Manage tab: remove selected repo
      if (action === 'manage_remove_repo' && manageSection === 'repos') {
        if (manageRepoIdx >= 0 && manageRepoIdx < manageRepoNames.length) {
          const repoName = manageRepoNames[manageRepoIdx];
          process.stdout.write(chalk.yellow(`\n  Remove ${repoName}? (y/n) `));
          const confirm = await readKey();
          if (confirm.name === 'y') {
            ctx.config.repos.splice(manageRepoIdx, 1);
            if (ctx.onRemoveRepo) {
              await ctx.onRemoveRepo(repoName);
            }
            // Adjust cursor
            if (manageRepoIdx >= ctx.config.repos.length && manageRepoIdx > 0) {
              manageRepoIdx--;
            }
          }
        }
        continue;
      }

      // Manage tab: scan selected repo (Enter in repos section)
      if (action === 'manage_action_selected' && manageSection === 'repos' && ctx.onScanRepo) {
        if (manageRepoIdx >= 0 && manageRepoIdx < manageRepoNames.length) {
          const repoName = manageRepoNames[manageRepoIdx];
          process.stdout.write('\x1B[2J\x1B[3J\x1B[H');
          console.log(chalk.bold(`Collecting git data: ${repoName}...\n`));
          try {
            await ctx.onScanRepo(repoName);
            console.log(chalk.green(`\nCollection complete. Press any key to continue.`));
          } catch (err) {
            console.log(chalk.red(`\nScan failed: ${err instanceof Error ? err.message : err}`));
            console.log(chalk.dim('Press any key to continue.'));
          }
          await readKey();
        }
        continue;
      }

      // Manage tab: scan all repos
      if (action === 'manage_scan_all' && ctx.onScanRepo) {
        process.stdout.write('\x1B[2J\x1B[3J\x1B[H');
        console.log(chalk.bold(`Collecting git data from all repos...\n`));
        for (const repoName of manageRepoNames) {
          try {
            await ctx.onScanRepo(repoName);
          } catch (err) {
            console.log(chalk.red(`  ${repoName}: failed — ${err instanceof Error ? err.message : err}`));
          }
        }
        console.log(chalk.green(`\nAll collections complete. Press any key to continue.`));
        await readKey();
        continue;
      }

      // Manage tab: assign/move selected author (Enter in authors section)
      if (action === 'manage_action_selected' && manageSection === 'authors') {
        if (manageAuthorIdx >= 0 && manageAuthorIdx < manageAuthorGroups.length && ctx.authorRegistry) {
          const emails = manageAuthorGroups[manageAuthorIdx];
          const firstAuthor = ctx.authorRegistry.authors[emails[0].toLowerCase()];
          if (!firstAuthor) { continue; }

          if (ctx.config.orgs.length === 0) {
            process.stdout.write('\n');
            console.log(chalk.yellow('  No organizations configured. Press O to add one first.'));
            console.log(chalk.dim('  Press any key to continue.'));
            await readKey();
            continue;
          }

          process.stdout.write('\n');
          const emailLabel = emails.length > 1
            ? chalk.dim(` (${emails.length} emails)`)
            : chalk.dim(` <${firstAuthor.email}>`);
          const isReassign = !!firstAuthor.org;
          const verb = isReassign ? 'Move' : 'Assign';
          console.log(chalk.bold(`  ${verb}: ${firstAuthor.name}`) + emailLabel);
          if (isReassign) {
            console.log(chalk.dim(`  Currently: ${firstAuthor.org} → ${firstAuthor.team}`));
          }
          console.log('');

          // If already assigned, offer quick "change team within same org"
          const currentOrg = isReassign
            ? ctx.config.orgs.find((o) => o.name === firstAuthor.org)
            : undefined;
          if (currentOrg && currentOrg.teams.length > 1) {
            console.log(chalk.dim(`  Change team within ${currentOrg.name}:`));
            for (let i = 0; i < currentOrg.teams.length; i++) {
              const isCurrent = currentOrg.teams[i].name === firstAuthor.team;
              const marker = isCurrent ? chalk.green(' ●') : '  ';
              console.log(`  ${chalk.cyan(String(i + 1))}  ${currentOrg.teams[i].name}${marker}`);
            }
            console.log(`  ${chalk.cyan('O')}  Pick different org`);
            console.log(`  ${chalk.dim('Esc')}  Cancel\n`);

            const teamOrOrgChoice = await readKey();
            if (teamOrOrgChoice.name === 'escape') { continue; }

            if (teamOrOrgChoice.name !== 'o') {
              // Quick team change within same org
              const teamIdx = parseInt(teamOrOrgChoice.name, 10) - 1;
              if (isNaN(teamIdx) || teamIdx < 0 || teamIdx >= currentOrg.teams.length) { continue; }
              const teamName = currentOrg.teams[teamIdx].name;

              for (const email of emails) {
                ctx.authorRegistry = assignAuthor(ctx.authorRegistry, email, currentOrg.name, teamName);
              }
              if (ctx.onSaveAuthorRegistry) {
                await ctx.onSaveAuthorRegistry(ctx.authorRegistry);
              }
              ctx.records = reattributeRecords(ctx.records, ctx.config, ctx.authorRegistry);
              const countLabel = emails.length > 1 ? ` (${emails.length} emails)` : '';
              console.log(chalk.green(`  Moved to ${currentOrg.name} → ${teamName}${countLabel}`));
              console.log(chalk.dim('  Press any key to continue.'));
              await readKey();
              continue;
            }
            // Fall through to full org picker
            console.log('');
          }

          // Pick org
          for (let i = 0; i < ctx.config.orgs.length; i++) {
            const o = ctx.config.orgs[i];
            const prefix = o.type === 'core' ? '\u2605' : '\u25C6';
            const isCurrent = isReassign && o.name === firstAuthor.org;
            const marker = isCurrent ? chalk.green(' ●') : '';
            console.log(`  ${chalk.cyan(String(i + 1))}  ${prefix} ${o.name}${marker}`);
          }
          console.log(`  ${chalk.dim('Esc')}  Cancel\n`);

          const orgChoice = await readKey();
          if (orgChoice.name === 'escape') { continue; }
          const orgIdx = parseInt(orgChoice.name, 10) - 1;
          if (isNaN(orgIdx) || orgIdx < 0 || orgIdx >= ctx.config.orgs.length) { continue; }
          const selectedOrg = ctx.config.orgs[orgIdx];

          // Pick team
          let teamName: string;
          if (selectedOrg.teams.length === 1) {
            teamName = selectedOrg.teams[0].name;
          } else {
            console.log('');
            for (let i = 0; i < selectedOrg.teams.length; i++) {
              const isCurrent = isReassign && selectedOrg.name === firstAuthor.org && selectedOrg.teams[i].name === firstAuthor.team;
              const marker = isCurrent ? chalk.green(' ●') : '';
              console.log(`  ${chalk.cyan(String(i + 1))}  ${selectedOrg.teams[i].name}${marker}`);
            }
            console.log(`  ${chalk.dim('Esc')}  Cancel\n`);

            const teamChoice = await readKey();
            if (teamChoice.name === 'escape') { continue; }
            const teamIdx = parseInt(teamChoice.name, 10) - 1;
            if (isNaN(teamIdx) || teamIdx < 0 || teamIdx >= selectedOrg.teams.length) { continue; }
            teamName = selectedOrg.teams[teamIdx].name;
          }

          // Assign all emails in the group
          for (const email of emails) {
            ctx.authorRegistry = assignAuthor(ctx.authorRegistry, email, selectedOrg.name, teamName);
          }
          if (ctx.onSaveAuthorRegistry) {
            await ctx.onSaveAuthorRegistry(ctx.authorRegistry);
          }
          // Re-attribute existing records with updated author assignments
          ctx.records = reattributeRecords(ctx.records, ctx.config, ctx.authorRegistry);
          const countLabel = emails.length > 1 ? ` (${emails.length} emails)` : '';
          console.log(chalk.green(`  ${isReassign ? 'Moved' : 'Assigned'} to ${selectedOrg.name} → ${teamName}${countLabel}`));

          console.log(chalk.dim('  Press any key to continue.'));
          await readKey();
        }
        continue;
      }

      // Manage tab: unassign selected author
      if (action === 'manage_unassign_author' && manageSection === 'authors') {
        if (manageAuthorIdx >= 0 && manageAuthorIdx < manageAuthorGroups.length && ctx.authorRegistry) {
          const emails = manageAuthorGroups[manageAuthorIdx];
          const firstAuthor = ctx.authorRegistry.authors[emails[0].toLowerCase()];
          if (!firstAuthor) { continue; }

          if (!firstAuthor.org) {
            process.stdout.write('\n');
            console.log(chalk.dim(`  ${firstAuthor.name} is already unassigned.`));
            console.log(chalk.dim('  Press any key to continue.'));
            await readKey();
            continue;
          }

          process.stdout.write('\n');
          const emailLabel = emails.length > 1
            ? chalk.dim(` (${emails.length} emails)`)
            : chalk.dim(` <${firstAuthor.email}>`);
          console.log(chalk.bold(`  Unassign: ${firstAuthor.name}`) + emailLabel);
          console.log(chalk.dim(`  Currently: ${firstAuthor.org} → ${firstAuthor.team}`));
          console.log('');
          console.log(`  ${chalk.cyan('Y')}  Confirm unassign`);
          console.log(`  ${chalk.dim('Esc')}  Cancel\n`);

          const confirm = await readKey();
          if (confirm.name !== 'y') { continue; }

          for (const email of emails) {
            ctx.authorRegistry = unassignAuthor(ctx.authorRegistry, email);
          }
          if (ctx.onSaveAuthorRegistry) {
            await ctx.onSaveAuthorRegistry(ctx.authorRegistry);
          }
          ctx.records = reattributeRecords(ctx.records, ctx.config, ctx.authorRegistry);
          const countLabel = emails.length > 1 ? ` (${emails.length} emails)` : '';
          console.log(chalk.green(`  Unassigned ${firstAuthor.name}${countLabel}`));

          console.log(chalk.dim('  Press any key to continue.'));
          await readKey();
        }
        continue;
      }

      // Manage tab: bulk assign by identifier prefix
      if (action === 'manage_bulk_assign' && manageSection === 'authors' && ctx.authorRegistry) {
        if (ctx.config.orgs.length === 0) {
          process.stdout.write('\n');
          console.log(chalk.yellow('  No organizations configured. Press O to add one first.'));
          console.log(chalk.dim('  Press any key to continue.'));
          await readKey();
          continue;
        }

        process.stdout.write('\x1B[2J\x1B[3J\x1B[H');
        console.log(chalk.bold('Bulk Assign by Identifier Prefix\n'));

        // Show existing prefixes
        const prefixes = Object.values(ctx.authorRegistry.authors)
          .filter((a) => a.identifier && !a.org)
          .reduce((acc, a) => {
            const p = a.identifier!.slice(0, 3).toUpperCase();
            acc.set(p, (acc.get(p) ?? 0) + 1);
            return acc;
          }, new Map<string, number>());

        if (prefixes.size > 0) {
          console.log(chalk.dim('  Unassigned prefixes found:'));
          for (const [p, count] of [...prefixes.entries()].sort((a, b) => b[1] - a[1])) {
            console.log(`    ${chalk.cyan(p)}  ${count} authors`);
          }
          console.log('');
        }

        const prefix = await readLine(chalk.cyan('  Identifier prefix: '));
        if (!prefix?.trim()) { continue; }

        // Pick org
        console.log('');
        for (let i = 0; i < ctx.config.orgs.length; i++) {
          const o = ctx.config.orgs[i];
          const marker = o.type === 'core' ? '\u2605' : '\u25C6';
          console.log(`  ${chalk.cyan(String(i + 1))}  ${marker} ${o.name}`);
        }
        console.log(`  ${chalk.dim('Esc')}  Cancel\n`);

        const orgChoice = await readKey();
        if (orgChoice.name === 'escape') { continue; }
        const orgIdx = parseInt(orgChoice.name, 10) - 1;
        if (isNaN(orgIdx) || orgIdx < 0 || orgIdx >= ctx.config.orgs.length) { continue; }
        const selectedOrg = ctx.config.orgs[orgIdx];

        // Pick team
        let teamName: string;
        if (selectedOrg.teams.length === 1) {
          teamName = selectedOrg.teams[0].name;
        } else {
          console.log('');
          for (let i = 0; i < selectedOrg.teams.length; i++) {
            console.log(`  ${chalk.cyan(String(i + 1))}  ${selectedOrg.teams[i].name}`);
          }
          console.log(`  ${chalk.dim('Esc')}  Cancel\n`);

          const teamChoice = await readKey();
          if (teamChoice.name === 'escape') { continue; }
          const teamIdx = parseInt(teamChoice.name, 10) - 1;
          if (isNaN(teamIdx) || teamIdx < 0 || teamIdx >= selectedOrg.teams.length) { continue; }
          teamName = selectedOrg.teams[teamIdx].name;
        }

        const result = assignByIdentifierPrefix(
          ctx.authorRegistry, prefix.trim(), selectedOrg.name, teamName,
        );
        ctx.authorRegistry = result.registry;

        if (ctx.onSaveAuthorRegistry) {
          await ctx.onSaveAuthorRegistry(ctx.authorRegistry);
        }
        // Re-attribute existing records with updated author assignments
        ctx.records = reattributeRecords(ctx.records, ctx.config, ctx.authorRegistry);

        if (result.assignedCount > 0) {
          console.log(chalk.green(`\n  Assigned ${result.assignedCount} authors with prefix "${prefix.trim()}" to ${selectedOrg.name} → ${teamName}`));
        } else {
          console.log(chalk.yellow(`\n  No unassigned authors found with prefix "${prefix.trim()}"`));
        }

        console.log(chalk.dim('\n  Press any key to continue.'));
        await readKey();
        continue;
      }

      // Manage tab: scan directory for repos
      if (action === 'manage_scan_dir' && manageSection === 'repos') {
        process.stdout.write('\x1B[2J\x1B[3J\x1B[H');
        console.log(chalk.bold('Add Repos from Directory\n'));

        const cwd = process.cwd();
        const home = homedir();
        console.log(`  ${chalk.cyan('1')}  Home     ${chalk.dim(home)}`);
        console.log(`  ${chalk.cyan('2')}  Current  ${chalk.dim(cwd)}`);
        console.log(`  ${chalk.cyan('3')}  Custom path`);
        console.log(`  ${chalk.dim('Esc')}  Cancel\n`);

        const choice = await readKey();
        if (choice.name === 'escape') { continue; }

        let dirPath: string | null = null;
        if (choice.name === '1') {
          dirPath = home;
        } else if (choice.name === '2') {
          dirPath = cwd;
        } else if (choice.name === '3') {
          dirPath = await readLine(chalk.cyan('  Path: '));
          if (dirPath) dirPath = expandTilde(dirPath.trim());
        } else {
          continue;
        }

        if (!dirPath) { continue; }

        const group = await readLine(chalk.cyan('  Group name (default): ')) ?? '';
        const depthStr = await readLine(chalk.cyan('  Depth 1-3 (1): ')) ?? '';
        const depth = Math.min(3, Math.max(1, parseInt(depthStr, 10) || 1));

        console.log(chalk.dim(`\n  Scanning ${dirPath} (depth ${depth})...\n`));

        let added = 0;
        try {
          if (ctx.onScanDir) {
            // Full flow: discover + persist to repos.yml + update config
            added = await ctx.onScanDir(dirPath, group.trim() || 'default', depth);
          } else {
            // Lightweight: just discover and add to runtime config
            const discovered = await scanDirectory(dirPath, depth);
            const existingNames = new Set(ctx.config.repos.map(
              (r) => r.name ?? r.path.split('/').pop() ?? r.path,
            ));
            const groupName = group.trim() || 'default';
            for (const repo of discovered) {
              if (!existingNames.has(repo.name)) {
                ctx.config.repos.push({ path: repo.path, name: repo.name, group: groupName });
                added++;
              }
            }
          }

          if (added > 0) {
            console.log(chalk.green(`  ${added} new repos added.`));
          } else {
            console.log(chalk.yellow('  No new repos found.'));
          }
        } catch (err) {
          console.log(chalk.red(`  Error: ${err instanceof Error ? err.message : err}`));
        }

        // Offer to scan the newly added repos right away
        if (added > 0 && ctx.onScanRepo) {
          console.log(chalk.cyan(`\n  Collect git data now? (y/n) `));
          const confirm = await readKey();
          if (confirm.name === 'y') {
            const updatedRepoNames = ctx.config.repos.map(
              (r) => r.name ?? r.path.split('/').pop() ?? r.path,
            );
            console.log('');
            for (const repoName of updatedRepoNames) {
              try {
                await ctx.onScanRepo(repoName);
              } catch (err) {
                console.log(chalk.red(`  ${repoName}: failed — ${err instanceof Error ? err.message : err}`));
              }
            }
            console.log(chalk.green(`\n  All collections complete.`));
          }
        }
        console.log(chalk.dim('\n  Press any key to continue.'));
        await readKey();
        continue;
      }

      // Manage tab: add new organization
      if (action === 'manage_new_org' && manageSection === 'orgs') {
        process.stdout.write('\x1B[2J\x1B[3J\x1B[H');
        console.log(chalk.bold('New Organization\n'));

        // Org name
        const orgName = await readLine(chalk.cyan('  Name: '));
        if (!orgName?.trim()) { continue; }

        // Org type
        console.log(`\n  ${chalk.cyan('1')}  Core (internal team)`);
        console.log(`  ${chalk.cyan('2')}  Consultant (external/vendor)`);
        const typeChoice = await readKey();
        const orgType = typeChoice.name === '2' ? 'consultant' : 'core';

        // Identifier prefix (optional)
        console.log('');
        const identifier = await readLine(
          chalk.cyan('  Identifier prefix ') + chalk.dim('(e.g. ACN, optional): '),
        );

        // Initial team
        const teamName = await readLine(chalk.cyan('  First team name: '));
        if (!teamName?.trim()) { continue; }

        // Tag for the team
        const teamTag = await readLine(
          chalk.cyan('  Team tag ') + chalk.dim('(default): '),
        ) ?? '';

        const newOrg = {
          name: orgName.trim(),
          type: orgType as 'core' | 'consultant',
          identifier: identifier?.trim() || undefined,
          teams: [{
            name: teamName.trim(),
            tag: teamTag.trim() || 'default',
            members: [],
          }],
        };

        ctx.config.orgs.push(newOrg);

        if (ctx.onAddOrg) {
          try {
            await ctx.onAddOrg(newOrg);
            console.log(chalk.green(`\n  Organization "${newOrg.name}" created and saved.`));
          } catch (err) {
            console.log(chalk.red(`\n  Error saving: ${err instanceof Error ? err.message : err}`));
          }
        } else {
          console.log(chalk.green(`\n  Organization "${newOrg.name}" added (runtime only).`));
        }

        console.log(chalk.dim('\n  Press any key to continue.'));
        await readKey();
        continue;
      }

      // Manage tab: add team to existing org
      if (action === 'manage_add_team' && manageSection === 'orgs') {
        if (ctx.config.orgs.length === 0) { continue; }

        process.stdout.write('\x1B[2J\x1B[3J\x1B[H');
        console.log(chalk.bold('Add Team to Organization\n'));

        // Pick org
        for (let i = 0; i < ctx.config.orgs.length; i++) {
          const o = ctx.config.orgs[i];
          const prefix = o.type === 'core' ? '\u2605' : '\u25C6';
          const teamCount = chalk.dim(`(${o.teams.length} team${o.teams.length !== 1 ? 's' : ''})`);
          console.log(`  ${chalk.cyan(String(i + 1))}  ${prefix} ${o.name} ${teamCount}`);
        }
        console.log(`  ${chalk.dim('Esc')}  Cancel\n`);

        const orgChoice = await readKey();
        if (orgChoice.name === 'escape') { continue; }
        const orgIdx = parseInt(orgChoice.name, 10) - 1;
        if (isNaN(orgIdx) || orgIdx < 0 || orgIdx >= ctx.config.orgs.length) { continue; }
        const selectedOrg = ctx.config.orgs[orgIdx];

        // Show existing teams
        console.log(chalk.dim(`  Existing teams in ${selectedOrg.name}: ${selectedOrg.teams.map((t) => t.name).join(', ')}\n`));

        // Team name
        const teamName = await readLine(chalk.cyan('  Team name: '));
        if (!teamName?.trim()) { continue; }

        // Check for duplicate
        if (selectedOrg.teams.some((t) => t.name.toLowerCase() === teamName.trim().toLowerCase())) {
          console.log(chalk.yellow(`\n  Team "${teamName.trim()}" already exists in ${selectedOrg.name}.`));
          console.log(chalk.dim('  Press any key to continue.'));
          await readKey();
          continue;
        }

        // Tag
        const teamTag = await readLine(
          chalk.cyan('  Team tag ') + chalk.dim('(default): '),
        ) ?? '';

        selectedOrg.teams.push({
          name: teamName.trim(),
          tag: teamTag.trim() || 'default',
          members: [],
        });

        if (ctx.onAddOrg) {
          try {
            await ctx.onAddOrg(selectedOrg);
            console.log(chalk.green(`\n  Team "${teamName.trim()}" added to ${selectedOrg.name} and saved.`));
          } catch (err) {
            console.log(chalk.red(`\n  Error saving: ${err instanceof Error ? err.message : err}`));
          }
        } else {
          console.log(chalk.green(`\n  Team "${teamName.trim()}" added to ${selectedOrg.name} (runtime only).`));
        }

        console.log(chalk.dim(`  Teams: ${selectedOrg.teams.map((t) => t.name).join(', ')}`));
        console.log(chalk.dim('\n  Press any key to continue.'));
        await readKey();
        continue;
      }

      // Manage tab: remove team from org
      if (action === 'manage_remove_team' && manageSection === 'orgs') {
        if (ctx.config.orgs.length === 0) { continue; }

        process.stdout.write('\x1B[2J\x1B[3J\x1B[H');
        console.log(chalk.bold('Remove Team from Organization\n'));

        // Pick org
        for (let i = 0; i < ctx.config.orgs.length; i++) {
          const o = ctx.config.orgs[i];
          const prefix = o.type === 'core' ? '\u2605' : '\u25C6';
          const teamCount = chalk.dim(`(${o.teams.length} team${o.teams.length !== 1 ? 's' : ''})`);
          console.log(`  ${chalk.cyan(String(i + 1))}  ${prefix} ${o.name} ${teamCount}`);
        }
        console.log(`  ${chalk.dim('Esc')}  Cancel\n`);

        const orgChoice = await readKey();
        if (orgChoice.name === 'escape') { continue; }
        const orgIdx = parseInt(orgChoice.name, 10) - 1;
        if (isNaN(orgIdx) || orgIdx < 0 || orgIdx >= ctx.config.orgs.length) { continue; }
        const selectedOrg = ctx.config.orgs[orgIdx];

        if (selectedOrg.teams.length <= 1) {
          console.log(chalk.yellow(`  ${selectedOrg.name} has only one team — cannot remove the last team.`));
          console.log(chalk.dim('  Press any key to continue.'));
          await readKey();
          continue;
        }

        // Pick team to remove
        console.log(chalk.dim(`  Select team to remove from ${selectedOrg.name}:\n`));
        for (let i = 0; i < selectedOrg.teams.length; i++) {
          const t = selectedOrg.teams[i];
          const memberCount = t.members.length > 0 ? chalk.dim(` (${t.members.length} members)`) : '';
          console.log(`  ${chalk.cyan(String(i + 1))}  ${t.name}${memberCount}`);
        }
        console.log(`  ${chalk.dim('Esc')}  Cancel\n`);

        const teamChoice = await readKey();
        if (teamChoice.name === 'escape') { continue; }
        const teamIdx = parseInt(teamChoice.name, 10) - 1;
        if (isNaN(teamIdx) || teamIdx < 0 || teamIdx >= selectedOrg.teams.length) { continue; }
        const teamToRemove = selectedOrg.teams[teamIdx];

        // Check if authors are assigned to this team
        const assignedCount = ctx.authorRegistry
          ? Object.values(ctx.authorRegistry.authors).filter(
              (a) => a.org === selectedOrg.name && a.team === teamToRemove.name,
            ).length
          : 0;

        if (assignedCount > 0) {
          console.log(chalk.yellow(`\n  ${assignedCount} author${assignedCount !== 1 ? 's' : ''} assigned to "${teamToRemove.name}".`));
          console.log(chalk.yellow('  They will become unassigned.'));
        }

        console.log(`\n  ${chalk.red('Remove')} "${teamToRemove.name}" from ${selectedOrg.name}?`);
        console.log(`  ${chalk.cyan('Y')}  Confirm`);
        console.log(`  ${chalk.dim('Esc')}  Cancel\n`);

        const confirm = await readKey();
        if (confirm.name !== 'y') { continue; }

        // Remove the team
        selectedOrg.teams.splice(teamIdx, 1);

        // Unassign authors that were on this team
        if (assignedCount > 0 && ctx.authorRegistry) {
          for (const author of Object.values(ctx.authorRegistry.authors)) {
            if (author.org === selectedOrg.name && author.team === teamToRemove.name) {
              author.org = undefined;
              author.team = undefined;
            }
          }
          if (ctx.onSaveAuthorRegistry) {
            await ctx.onSaveAuthorRegistry(ctx.authorRegistry);
          }
          ctx.records = reattributeRecords(ctx.records, ctx.config, ctx.authorRegistry);
        }

        if (ctx.onAddOrg) {
          try {
            await ctx.onAddOrg(selectedOrg);
            console.log(chalk.green(`  Team "${teamToRemove.name}" removed from ${selectedOrg.name}.`));
          } catch (err) {
            console.log(chalk.red(`  Error saving: ${err instanceof Error ? err.message : err}`));
          }
        } else {
          console.log(chalk.green(`  Team "${teamToRemove.name}" removed (runtime only).`));
        }

        if (assignedCount > 0) {
          console.log(chalk.dim(`  ${assignedCount} author${assignedCount !== 1 ? 's' : ''} unassigned.`));
        }
        console.log(chalk.dim(`  Remaining teams: ${selectedOrg.teams.map((t) => t.name).join(', ')}`));
        console.log(chalk.dim('\n  Press any key to continue.'));
        await readKey();
        continue;
      }

      // Manage tab: export
      if (action === 'manage_export') {
        process.stdout.write('\x1B[2J\x1B[3J\x1B[H');
        console.log(chalk.bold('Export\n'));

        console.log(`  ${chalk.cyan('1')}  Data (CSV)        ${chalk.dim('contribution records')}`);
        console.log(`  ${chalk.cyan('2')}  Workspace (YAML)  ${chalk.dim('portable repo list')}`);
        console.log(`  ${chalk.dim('Esc')}  Cancel\n`);

        const exportChoice = await readKey();
        if (exportChoice.name === 'escape') { continue; }

        if (exportChoice.name === '1') {
          // ── CSV export ──
          const defaultPath = path.join(homedir(), 'gitradar-export.csv');
          const customPath = await readLine(
            chalk.cyan('  Output path ') + chalk.dim(`(${defaultPath}): `),
          );
          const outPath = expandTilde((customPath?.trim() || defaultPath));

          if (ctx.records.length === 0) {
            console.log(chalk.yellow('\n  No records to export. Collect data first.'));
          } else {
            try {
              const csv = recordsToCsv(ctx.records);
              await writeFile(outPath, csv, 'utf-8');
              console.log(chalk.green(`\n  Exported ${ctx.records.length} records to ${outPath}`));
            } catch (err) {
              console.log(chalk.red(`\n  Error: ${err instanceof Error ? err.message : err}`));
            }
          }
        } else if (exportChoice.name === '2') {
          // ── Workspace YAML export ──
          const defaultPath = path.join(homedir(), 'gitradar-workspace.yml');
          const customPath = await readLine(
            chalk.cyan('  Output path ') + chalk.dim(`(${defaultPath}): `),
          );
          const outPath = expandTilde((customPath?.trim() || defaultPath));

          const portableRepos = ctx.config.repos.map((r) => {
            const portable: Record<string, unknown> = {
              name: r.name ?? r.path.split('/').pop() ?? r.path,
            };
            if (r.group && r.group !== 'default') portable.group = r.group;
            return portable;
          });

          const output: Record<string, unknown> = {
            workspaces: {
              exported: { repos: portableRepos },
            },
          };

          const groups = ctx.config.groups ?? {};
          const tags = ctx.config.tags ?? {};
          if (Object.keys(groups).length > 0) output.groups = groups;
          if (Object.keys(tags).length > 0) output.tags = tags;

          try {
            const yamlOut = yaml.dump(output, {
              indent: 2,
              lineWidth: 120,
              noRefs: true,
              quotingType: '"',
            });
            await writeFile(outPath, yamlOut, 'utf-8');
            console.log(chalk.green(`\n  Workspace exported to ${outPath}`));
            console.log(chalk.dim(`  ${portableRepos.length} repos (paths stripped for portability)`));
          } catch (err) {
            console.log(chalk.red(`\n  Error: ${err instanceof Error ? err.message : err}`));
          }
        } else {
          continue;
        }

        console.log(chalk.dim('\n  Press any key to continue.'));
        await readKey();
        continue;
      }

      // Navigation
      if (action === 'quit') {
        return { type: 'quit' };
      }
      if (action.startsWith('team:')) {
        const teamName = action.slice(5);
        return { type: 'push', view: (c) => teamDetailView(c, teamName) };
      }
    } catch {
      // SIGINT (Ctrl+C)
      return { type: 'quit' };
    }
  }
}
