import type { FiletypeMetrics, UserWeekRepoRecord } from '../types/schema.js';

// Re-export types from sqlite-store (canonical definition)
export type {
  FiletypeRollup,
  RolledUp,
  RollupFilters,
  RollupGroupBy,
} from '../store/sqlite-store.js';
export { queryRollup } from '../store/sqlite-store.js';

// Import for local use
import type { RolledUp } from '../store/sqlite-store.js';

const FILETYPE_KEYS = ['app', 'test', 'config', 'storybook', 'doc'] as const;

function emptyRolledUp(): RolledUp {
  return {
    commits: 0,
    insertions: 0,
    deletions: 0,
    netLines: 0,
    filesChanged: 0,
    filesAdded: 0,
    filesDeleted: 0,
    activeDays: 0,
    activeMembers: 0,
    breakingChanges: 0,
    prsMergedGit: 0,
    prSizes: [],
    reworkLines: 0,
    reworkSelfLines: 0,
    filetype: {
      app: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
      test: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
      config: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
      storybook: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
      doc: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
    },
  };
}

/**
 * In-memory rollup: group records by an arbitrary key function and sum all metrics.
 *
 * Use this when operating on pre-loaded records (e.g. test fixtures, pre-filtered
 * arrays). For production paths reading from SQLite, prefer `queryRollup()` which
 * pushes filtering and aggregation into SQL for O(1) memory and indexed performance.
 */
export function rollup(
  records: UserWeekRepoRecord[],
  groupBy: (r: UserWeekRepoRecord) => string,
): Map<string, RolledUp> {
  const result = new Map<string, RolledUp>();
  const memberSets = new Map<string, Set<string>>();
  // Per group → per member-week → union of weekday masks (+ legacy counts).
  // Records are stored per (member, week, repo); a day spent in three repos
  // is still one day, so days are unioned per member-week, not summed.
  const dayTrackers = new Map<string, Map<string, ActiveDayTracker>>();

  for (const r of records) {
    const key = groupBy(r);

    let agg = result.get(key);
    if (!agg) {
      agg = emptyRolledUp();
      result.set(key, agg);
      memberSets.set(key, new Set());
      dayTrackers.set(key, new Map());
    }

    const members = memberSets.get(key)!;
    members.add(r.member);

    const trackers = dayTrackers.get(key)!;
    const memberWeek = `${r.member}::${r.week}`;
    let tracker = trackers.get(memberWeek);
    if (!tracker) {
      tracker = { mask: 0, legacyDays: 0 };
      trackers.set(memberWeek, tracker);
    }
    if (r.activeDayMask) tracker.mask |= r.activeDayMask;
    else tracker.legacyDays += r.activeDays;

    agg.commits += r.commits;
    agg.breakingChanges += r.breakingChanges ?? 0;
    agg.prsMergedGit += r.prsMergedGit ?? 0;
    if (r.prSizes?.length) agg.prSizes.push(...r.prSizes);
    agg.reworkLines += r.reworkLines ?? 0;
    agg.reworkSelfLines += r.reworkSelfLines ?? 0;

    for (const ft of FILETYPE_KEYS) {
      const src: FiletypeMetrics = r.filetype[ft];
      const dst = agg.filetype[ft];
      dst.files += src.files;
      dst.filesAdded += src.filesAdded;
      dst.filesDeleted += src.filesDeleted;
      dst.insertions += src.insertions;
      dst.deletions += src.deletions;
    }

    // Compute derived totals
    agg.insertions = 0;
    agg.deletions = 0;
    agg.filesChanged = 0;
    agg.filesAdded = 0;
    agg.filesDeleted = 0;
    for (const ft of FILETYPE_KEYS) {
      agg.insertions += agg.filetype[ft].insertions;
      agg.deletions += agg.filetype[ft].deletions;
      agg.filesChanged += agg.filetype[ft].files;
      agg.filesAdded += agg.filetype[ft].filesAdded;
      agg.filesDeleted += agg.filetype[ft].filesDeleted;
    }
    agg.netLines = agg.insertions - agg.deletions;
    agg.activeMembers = members.size;
  }

  for (const [key, trackers] of dayTrackers) {
    let days = 0;
    for (const t of trackers.values()) days += activeDaysFromTracker(t);
    result.get(key)!.activeDays = days;
  }

  return result;
}

interface ActiveDayTracker {
  /** OR of activeDayMask across repos for one member-week. */
  mask: number;
  /** Sum of activeDays from records that predate the mask (best effort). */
  legacyDays: number;
}

/** Distinct days for one member-week: popcount(mask) + legacy count, capped at 7. */
function activeDaysFromTracker(t: ActiveDayTracker): number {
  let bits = 0;
  for (let m = t.mask; m; m >>= 1) bits += m & 1;
  return Math.min(bits + t.legacyDays, 7);
}
