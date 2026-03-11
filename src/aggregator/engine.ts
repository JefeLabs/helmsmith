import type { UserWeekRepoRecord, FiletypeMetrics } from "../types/schema.js";

// Re-export types from sqlite-store (canonical definition)
export type { FiletypeRollup, RolledUp, RollupGroupBy, RollupFilters } from "../store/sqlite-store.js";
export { queryRollup } from "../store/sqlite-store.js";

// Import for local use
import type { RolledUp } from "../store/sqlite-store.js";

const FILETYPE_KEYS = ["app", "test", "config", "storybook", "doc"] as const;

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

  for (const r of records) {
    const key = groupBy(r);

    let agg = result.get(key);
    if (!agg) {
      agg = emptyRolledUp();
      result.set(key, agg);
      memberSets.set(key, new Set());
    }

    const members = memberSets.get(key)!;
    members.add(r.member);

    agg.commits += r.commits;
    agg.activeDays += r.activeDays;

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

  return result;
}
