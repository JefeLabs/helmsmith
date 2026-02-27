import { readFile, writeFile, rename } from "node:fs/promises";
import type {
  CommitsByFiletype,
  UserWeekRepoRecord,
} from "../types/schema.js";
import { getCommitsPath, ensureDataDir } from "./paths.js";

/**
 * Load commits data from disk, or return an empty default if the file
 * does not exist or cannot be parsed.
 */
export async function loadCommitsData(): Promise<CommitsByFiletype> {
  try {
    const raw = await readFile(getCommitsPath(), "utf-8");
    return JSON.parse(raw) as CommitsByFiletype;
  } catch {
    return {
      version: 1,
      lastUpdated: new Date().toISOString(),
      records: [],
    };
  }
}

/**
 * Atomically save commits data to disk.
 * Updates the lastUpdated timestamp before writing.
 */
export async function saveCommitsData(
  data: CommitsByFiletype
): Promise<void> {
  await ensureDataDir();
  const updated: CommitsByFiletype = {
    ...data,
    lastUpdated: new Date().toISOString(),
  };
  const filePath = getCommitsPath();
  const tmpPath = filePath + ".tmp";
  await writeFile(tmpPath, JSON.stringify(updated, null, 2), "utf-8");
  await rename(tmpPath, filePath);
}

/**
 * Build a composite key for deduplication: "member::week::repo"
 */
function recordKey(r: UserWeekRepoRecord): string {
  return `${r.member}::${r.week}::${r.repo}`;
}

/**
 * Merge incoming records into existing ones.
 * Records with the same key (member::week::repo) have their metrics summed.
 * activeDays is capped at 7.
 * Returns a new array; inputs are not mutated.
 */
export function mergeRecords(
  existing: UserWeekRepoRecord[],
  incoming: UserWeekRepoRecord[]
): UserWeekRepoRecord[] {
  const map = new Map<string, UserWeekRepoRecord>();

  for (const record of existing) {
    const key = recordKey(record);
    map.set(key, { ...record });
  }

  for (const record of incoming) {
    const key = recordKey(record);
    const prev = map.get(key);
    if (prev) {
      map.set(key, {
        ...prev,
        commits: prev.commits + record.commits,
        activeDays: Math.min(prev.activeDays + record.activeDays, 7),
        filetype: {
          app: {
            files: prev.filetype.app.files + record.filetype.app.files,
            filesAdded: (prev.filetype.app.filesAdded ?? 0) + (record.filetype.app.filesAdded ?? 0),
            filesDeleted: (prev.filetype.app.filesDeleted ?? 0) + (record.filetype.app.filesDeleted ?? 0),
            insertions:
              prev.filetype.app.insertions + record.filetype.app.insertions,
            deletions:
              prev.filetype.app.deletions + record.filetype.app.deletions,
          },
          test: {
            files: prev.filetype.test.files + record.filetype.test.files,
            filesAdded: (prev.filetype.test.filesAdded ?? 0) + (record.filetype.test.filesAdded ?? 0),
            filesDeleted: (prev.filetype.test.filesDeleted ?? 0) + (record.filetype.test.filesDeleted ?? 0),
            insertions:
              prev.filetype.test.insertions + record.filetype.test.insertions,
            deletions:
              prev.filetype.test.deletions + record.filetype.test.deletions,
          },
          config: {
            files: prev.filetype.config.files + record.filetype.config.files,
            filesAdded: (prev.filetype.config.filesAdded ?? 0) + (record.filetype.config.filesAdded ?? 0),
            filesDeleted: (prev.filetype.config.filesDeleted ?? 0) + (record.filetype.config.filesDeleted ?? 0),
            insertions:
              prev.filetype.config.insertions +
              record.filetype.config.insertions,
            deletions:
              prev.filetype.config.deletions + record.filetype.config.deletions,
          },
          storybook: {
            files:
              prev.filetype.storybook.files + record.filetype.storybook.files,
            filesAdded: (prev.filetype.storybook.filesAdded ?? 0) + (record.filetype.storybook.filesAdded ?? 0),
            filesDeleted: (prev.filetype.storybook.filesDeleted ?? 0) + (record.filetype.storybook.filesDeleted ?? 0),
            insertions:
              prev.filetype.storybook.insertions +
              record.filetype.storybook.insertions,
            deletions:
              prev.filetype.storybook.deletions +
              record.filetype.storybook.deletions,
          },
        },
      });
    } else {
      map.set(key, { ...record });
    }
  }

  return Array.from(map.values());
}

/**
 * Filter out records whose week is older than the cutoff.
 * weeksBack is the number of weeks to keep (e.g. 12 keeps the last 12 weeks).
 * Returns a new array; input is not mutated.
 */
export function pruneOldRecords(
  records: UserWeekRepoRecord[],
  weeksBack: number
): UserWeekRepoRecord[] {
  const now = new Date();
  // Calculate the cutoff date: weeksBack weeks ago from today
  const cutoffDate = new Date(
    now.getTime() - weeksBack * 7 * 24 * 60 * 60 * 1000
  );

  // Convert cutoff to ISO week format for comparison
  const cutoffWeek = toISOWeek(cutoffDate);

  return records.filter((r) => r.week >= cutoffWeek);
}

/**
 * Convert a Date to an ISO week string like "2026-W08".
 */
function toISOWeek(date: Date): string {
  // Get the Thursday of the current week (ISO weeks start on Monday)
  const d = new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
  );
  const dayOfWeek = d.getUTCDay() || 7; // Make Sunday = 7
  d.setUTCDate(d.getUTCDate() + 4 - dayOfWeek); // Set to nearest Thursday

  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(
    ((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7
  );

  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

/**
 * Returns true if the data exceeds size thresholds that warrant auto-pruning:
 * - More than 100,000 records, OR
 * - Estimated JSON size > 50MB
 */
export function shouldAutoPrune(data: CommitsByFiletype): boolean {
  if (data.records.length > 100_000) return true;
  const estimatedSize = JSON.stringify(data).length;
  return estimatedSize > 50 * 1024 * 1024;
}

/**
 * Compute summary statistics about the commits data store.
 */
export function getStoreStats(data: CommitsByFiletype): {
  recordCount: number;
  orgCount: number;
  teamCount: number;
  oldestWeek: string | undefined;
  newestWeek: string | undefined;
} {
  const orgs = new Set<string>();
  const teams = new Set<string>();
  let oldestWeek: string | undefined;
  let newestWeek: string | undefined;

  for (const r of data.records) {
    orgs.add(r.org);
    teams.add(r.team);

    if (!oldestWeek || r.week < oldestWeek) oldestWeek = r.week;
    if (!newestWeek || r.week > newestWeek) newestWeek = r.week;
  }

  return {
    recordCount: data.records.length,
    orgCount: orgs.size,
    teamCount: teams.size,
    oldestWeek,
    newestWeek,
  };
}
