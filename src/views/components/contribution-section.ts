import chalk from 'chalk';
import type { ViewContext } from '../types.js';
import type { UserWeekRepoRecord, EnrichmentStore } from '../../types/schema.js';
import type { ProductivityExtensions } from '../../types/schema.js';
import type { HBarGroup, HBar, DetailLayer } from '../../ui/grouped-hbar-chart.js';
import { renderGroupedHBarChart } from '../../ui/grouped-hbar-chart.js';
import { renderTable } from '../../ui/table.js';
import { rollup } from '../../aggregator/engine.js';
import { testPct as computeTestPctCanonical } from '../../aggregator/metrics.js';
import { filterRecords } from '../../aggregator/filters.js';
import { SEGMENT_DEFS, SEGMENT_INDICATORS } from '../../ui/constants.js';
import { calculateSegments, type Segment } from '../../aggregator/segments.js';
import { fmt } from '../../ui/format.js';

// ── Types ────────────────────────────────────────────────────────────────────

export type DrillLevel = 'org' | 'team' | 'user';
export type ContribGranularity = 'week' | 'month' | 'quarter' | 'year';

export interface TimeBucket {
  label: string;
  weeks: string[];
}

// ── Enrichment helpers ───────────────────────────────────────────────────────

const defaultEnrichment: ProductivityExtensions = {
  prs_opened: 0, prs_merged: 0, avg_cycle_hrs: 0, reviews_given: 0, churn_rate_pct: 0,
  pr_feature: 0, pr_fix: 0, pr_bugfix: 0, pr_chore: 0, pr_hotfix: 0, pr_other: 0,
};

function getEnrichment(store: EnrichmentStore, key: string): ProductivityExtensions {
  return store.enrichments[key] ?? defaultEnrichment;
}

/** Compute test% — delegates to the canonical metrics module. */
export function computeTestPct(agg: { filetype: { app: { insertions: number; deletions: number }; test: { insertions: number; deletions: number } } }): number {
  return computeTestPctCanonical(agg.filetype);
}

// ── Enrichment aggregation helper ────────────────────────────────────────────

export interface AggregatedEnrichments {
  prsOpened: number;
  prsMerged: number;
  reviewsGiven: number;
  avgCycleHrs: number;
  churnRatePct: number;
}

export function aggregateEnrichments(
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

export function buildContributionGroups(
  records: UserWeekRepoRecord[],
  buckets: TimeBucket[],
  drillLevel: DrillLevel,
  tagOverlay: boolean,
  config: ViewContext['config'],
  enrichments?: EnrichmentStore,
  classifyPerception?: (history: number[]) => string,
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
  if (classifyPerception) {
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
export function buildContributionGroupsByEntity(
  records: UserWeekRepoRecord[],
  buckets: TimeBucket[],
  drillLevel: DrillLevel,
  tagOverlay: boolean,
  config: ViewContext['config'],
  enrichments?: EnrichmentStore,
  classifyPerception?: (history: number[]) => string,
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
  if (classifyPerception) {
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
  }

  return groups;
}

// ── Contributions detail data ────────────────────────────────────────────────

export function buildContributionDetailRows(
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
export function buildContributionDetailRowsByEntity(
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

export function renderContributionsDetailTab(
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

export function renderContributionsTab(
  ctx: ViewContext,
  drillLevel: DrillLevel,
  tagOverlay: boolean,
  pivotEntity: boolean,
  buckets: TimeBucket[],
  granularity: ContribGranularity,
  rangeLabel: string,
  termCols: number,
  legend: string,
  classifyPerception: (history: number[]) => string,
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
    ? buildContributionGroupsByEntity(recs, buckets, drillLevel, tagOverlay, ctx.config, enrichments, classifyPerception)
    : buildContributionGroups(recs, buckets, drillLevel, tagOverlay, ctx.config, enrichments, classifyPerception);

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
    const segThresholds = { high: ctx.config.settings.segment_high_pct ?? 20, low: ctx.config.settings.segment_low_pct ?? 20 };
    const segMap = calculateSegments(memberTotals, segThresholds);
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
    const segThresholds = { high: ctx.config.settings.segment_high_pct ?? 20, low: ctx.config.settings.segment_low_pct ?? 20 };
    const segMap = calculateSegments(entityTotals, segThresholds);
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
