import { simpleGit } from "simple-git";
import type { UserWeekRepoRecord } from "../types/schema.js";
import type { AuthorMap } from "./author-map.js";
import { resolveAuthor } from "./author-map.js";
import { classifyFile, buildIgnoreMatcher } from "./classifier.js";

export type FileStatus = 'A' | 'M' | 'D' | 'R' | 'C' | 'T' | 'unknown';

/**
 * A single parsed commit from git log output.
 */
export interface ParsedCommit {
  hash: string;
  email: string;
  name: string;
  date: string;
  files: { insertions: number; deletions: number; path: string; status: FileStatus }[];
}

/**
 * Options for scanning a single repo.
 */
export interface ScanOptions {
  repoName: string;
  group: string;
  authorMap: AuthorMap;
  recentHashes: Set<string>;
  since?: string;
  /** Chunk first-time scans into N-month windows to bound memory usage. */
  chunkMonths?: number;
  /** Identifier prefix rules for pattern-based author resolution. */
  identifierRules?: Array<{
    prefix: string;
    org: string;
    orgType: "core" | "consultant";
    team: string;
    tag: string;
  }>;
  /** Glob patterns for files to exclude from metrics. Uses defaults if undefined. */
  ignorePatterns?: string[];
}

/**
 * A git author discovered during scanning (before org/team resolution).
 */
export interface RawAuthor {
  email: string;
  name: string;
  commitCount: number;
  lastDate: string;
}

/**
 * Result of scanning a single repo.
 */
export interface ScanResult {
  newRecords: UserWeekRepoRecord[];
  newHashes: string[];
  commitCount: number;
  skippedCount: number;
  /** All unique authors seen in this scan (resolved or not). */
  discoveredAuthors: RawAuthor[];
}

/**
 * Detect whether a line is a commit header (hash|email|name|date).
 * A header line has 4+ pipe-separated parts and the first part is a hex hash.
 */
function isHeaderLine(line: string): boolean {
  const parts = line.split("|");
  return parts.length >= 4 && /^[0-9a-f]{6,40}$/.test(parts[0]);
}

/** Raw diff line: :old_mode new_mode old_hash new_hash STATUS\tpath */
const RAW_DIFF_RE = /^:\d+ \d+ [0-9a-f]+ [0-9a-f]+ ([AMDRC])(\d*)\t(.+)$/;

/** Numstat line: number-or-dash, tab, number-or-dash, tab, path */
const NUMSTAT_RE = /^(\d+|-)\t(\d+|-)\t(.+)$/;

/**
 * Parse git log output produced with:
 *   --format="%H|%ae|%an|%aI" --raw --numstat
 *
 * Each commit block has a header line, followed by raw diff lines
 * (:mode mode hash hash status\tpath) and numstat lines
 * (insertions\tdeletions\tpath), with blank lines between sections.
 * Commits are delimited by their header lines rather than blank lines.
 *
 * Note: --raw is used instead of --name-status because --name-status
 * and --numstat are mutually exclusive on many git versions.
 */
export function parseGitLogOutput(output: string): ParsedCommit[] {
  const commits: ParsedCommit[] = [];
  if (!output.trim()) return commits;

  const lines = output.split("\n");
  let current: ParsedCommit | null = null;
  let statusMap = new Map<string, FileStatus>();

  function pushCurrent() {
    if (current) {
      // Apply collected status to any files that still have 'unknown'
      for (const f of current.files) {
        if (f.status === 'unknown') {
          const s = statusMap.get(f.path);
          if (s) f.status = s;
        }
      }
      commits.push(current);
    }
  }

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip blank lines (they separate sections within a commit, not commits themselves)
    if (trimmed === "") continue;

    // Check if this is a commit header line
    if (isHeaderLine(trimmed)) {
      // Push the previous commit if any
      pushCurrent();

      const parts = trimmed.split("|");
      current = {
        hash: parts[0],
        email: parts[1],
        name: parts.slice(2, -1).join("|"), // name may contain |
        date: parts[parts.length - 1],
        files: [],
      };
      statusMap = new Map();
      continue;
    }

    if (!current) continue;

    // Try raw diff line: :100644 100644 abc123 def456 M\tpath
    const nsMatch = RAW_DIFF_RE.exec(trimmed);
    if (nsMatch) {
      const statusChar = nsMatch[1] as FileStatus;
      const rest = nsMatch[3];
      // For renames/copies, rest is "old\tnew" — map both paths
      if ((statusChar === 'R' || statusChar === 'C') && rest.includes('\t')) {
        const [oldPath, newPath] = rest.split('\t');
        statusMap.set(oldPath, statusChar);
        statusMap.set(newPath, statusChar);
      } else {
        statusMap.set(rest, statusChar);
      }
      continue;
    }

    // Try numstat line: insertions\tdeletions\tpath
    const numMatch = NUMSTAT_RE.exec(trimmed);
    if (numMatch) {
      const ins = numMatch[1] === "-" ? 0 : parseInt(numMatch[1], 10) || 0;
      const del = numMatch[2] === "-" ? 0 : parseInt(numMatch[2], 10) || 0;
      const filePath = trimmed.split("\t").slice(2).join("\t"); // path may contain tabs (rare)

      // For renames in numstat, path is "old => new" or "{old => new}/rest"
      // Try to extract new path for status lookup
      let lookupPath = filePath;
      const arrowIdx = filePath.indexOf(" => ");
      if (arrowIdx !== -1) {
        lookupPath = filePath.slice(arrowIdx + 4);
      }

      const status = statusMap.get(filePath) ?? statusMap.get(lookupPath) ?? 'unknown';
      current.files.push({ insertions: ins, deletions: del, path: filePath, status });
      continue;
    }
  }

  // Push the last commit
  pushCurrent();

  return commits;
}

/**
 * Convert an ISO date string to ISO week format: "YYYY-Www"
 * e.g., "2026-02-25T10:00:00Z" → "2026-W09"
 */
export function getISOWeek(dateStr: string): string {
  const d = new Date(dateStr);
  const utc = new Date(
    Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())
  );
  const dayOfWeek = utc.getUTCDay() || 7; // Make Sunday = 7
  utc.setUTCDate(utc.getUTCDate() + 4 - dayOfWeek); // Set to nearest Thursday

  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(
    ((utc.getTime() - yearStart.getTime()) / 86400000 + 1) / 7
  );

  return `${utc.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

/**
 * Create an empty filetype metrics structure.
 */
function emptyFiletype(): UserWeekRepoRecord["filetype"] {
  return {
    app: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
    test: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
    config: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
    storybook: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
    doc: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
  };
}

/**
 * A date range for chunked scanning.
 */
export interface DateRange {
  since: string;  // YYYY-MM-DD
  until: string;  // YYYY-MM-DD
}

/**
 * Generate non-overlapping date ranges from startDate to endDate,
 * each spanning `months` calendar months. Oldest-first.
 */
export function generateDateChunks(
  startDate: Date,
  endDate: Date,
  months: number,
): DateRange[] {
  const chunks: DateRange[] = [];
  // Use UTC throughout to avoid local-timezone drift with setMonth
  const cursor = new Date(Date.UTC(
    startDate.getUTCFullYear(),
    startDate.getUTCMonth(),
    startDate.getUTCDate(),
  ));

  while (cursor < endDate) {
    const chunkSince = cursor.toISOString().slice(0, 10);
    cursor.setUTCMonth(cursor.getUTCMonth() + months);
    const chunkUntil = cursor >= endDate
      ? endDate.toISOString().slice(0, 10)
      : cursor.toISOString().slice(0, 10);
    chunks.push({ since: chunkSince, until: chunkUntil });
  }

  return chunks;
}

/**
 * Build the list of date ranges to scan.
 *
 * - Incremental scans (since is set): single open-ended range, no chunking.
 * - First-time scans with chunkMonths: generate N-month windows from 10 years
 *   ago to now. Empty windows are cheap (git returns instantly).
 * - First-time scans without chunkMonths: single open-ended range (original behavior).
 */
function buildScanRanges(
  since: string | undefined,
  chunkMonths: number | undefined,
): Array<{ since?: string; until?: string }> {
  if (since || !chunkMonths) {
    return [{ since }];
  }

  const endDate = new Date();
  const startDate = new Date();
  startDate.setUTCFullYear(startDate.getUTCFullYear() - 10);
  return generateDateChunks(startDate, endDate, chunkMonths);
}

/**
 * Process a batch of parsed commits into the shared accumulator maps.
 * Returns the count of skipped (deduped) commits.
 * Also collects all unique authors into rawAuthorsMap (resolved or not).
 */
function processCommitBatch(
  commits: ParsedCommit[],
  repoName: string,
  group: string,
  authorMap: AuthorMap,
  recentHashes: Set<string>,
  recordMap: Map<string, UserWeekRepoRecord>,
  activeDaysMap: Map<string, Set<string>>,
  newHashes: string[],
  rawAuthorsMap: Map<string, RawAuthor>,
  identifierRules?: ScanOptions["identifierRules"],
  shouldIgnore?: (filePath: string) => boolean,
): number {
  let skipped = 0;

  for (const commit of commits) {
    if (recentHashes.has(commit.hash)) {
      skipped++;
      continue;
    }

    newHashes.push(commit.hash);

    // Track every author we see (for discovery)
    const authorKey = commit.email.toLowerCase();
    const existing = rawAuthorsMap.get(authorKey);
    if (existing) {
      existing.commitCount++;
      if (commit.date > existing.lastDate) {
        existing.lastDate = commit.date;
        existing.name = commit.name; // keep most recent name
      }
    } else {
      rawAuthorsMap.set(authorKey, {
        email: commit.email,
        name: commit.name,
        commitCount: 1,
        lastDate: commit.date,
      });
    }

    const author = resolveAuthor(authorMap, commit.email, commit.name, identifierRules) ?? {
      member: commit.name,
      email: commit.email,
      org: 'unassigned',
      orgType: 'core' as const,
      team: 'unassigned',
      tag: 'default',
    };

    const week = getISOWeek(commit.date);
    const dateDay = commit.date.slice(0, 10);
    const key = `${author.member}::${week}::${repoName}`;

    if (!activeDaysMap.has(key)) {
      activeDaysMap.set(key, new Set());
    }
    activeDaysMap.get(key)!.add(dateDay);

    if (!recordMap.has(key)) {
      recordMap.set(key, {
        member: author.member,
        email: author.email,
        org: author.org,
        orgType: author.orgType,
        team: author.team,
        tag: author.tag,
        week,
        repo: repoName,
        group,
        commits: 0,
        activeDays: 0,
        filetype: emptyFiletype(),
      });
    }

    const record = recordMap.get(key)!;
    record.commits += 1;

    for (const file of commit.files) {
      if (shouldIgnore?.(file.path)) continue;
      const category = classifyFile(file.path);
      record.filetype[category].files += 1;
      if (file.status === 'A') record.filetype[category].filesAdded += 1;
      if (file.status === 'D') record.filetype[category].filesDeleted += 1;
      record.filetype[category].insertions += file.insertions;
      record.filetype[category].deletions += file.deletions;
    }
  }

  return skipped;
}

/**
 * Scan a git repository and produce UserWeekRepoRecords.
 *
 * Uses simple-git to run:
 *   git log --since=... --raw --numstat --no-merges --format="%H|%ae|%an|%aI"
 *
 * When `chunkMonths` is set and this is a first-time scan (no `since`),
 * the date range is split into N-month windows so that only one chunk's
 * raw git output is in memory at a time.
 *
 * Deduplicates against recentHashes, resolves authors, classifies files,
 * and accumulates metrics into per-member/week/repo records.
 */
export async function scanRepo(
  repoPath: string,
  options: ScanOptions
): Promise<ScanResult> {
  const { repoName, group, authorMap, recentHashes, since, chunkMonths, identifierRules, ignorePatterns } = options;

  const shouldIgnore = buildIgnoreMatcher(ignorePatterns);
  const git = simpleGit(repoPath);
  const ranges = buildScanRanges(since, chunkMonths);

  // Shared state across all chunks — the recordMap is small (bounded by
  // members × weeks), so it's safe to keep in memory. Only the raw git
  // output string is freed between chunks.
  const recordMap = new Map<string, UserWeekRepoRecord>();
  const activeDaysMap = new Map<string, Set<string>>();
  const rawAuthorsMap = new Map<string, RawAuthor>();
  const newHashes: string[] = [];
  let totalCommitCount = 0;
  let skippedCount = 0;

  for (const range of ranges) {
    const args = ["log", "--raw", "--numstat", "--no-merges", "--format=%H|%ae|%an|%aI"];
    if (range.since) args.splice(1, 0, `--since=${range.since}`);
    if (range.until) args.splice(1, 0, `--until=${range.until}`);

    let output: string;
    try {
      output = await git.raw(args);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.log(`  Warning: git error in ${repoName}: ${msg}`);
      if (ranges.length === 1) {
        return { newRecords: [], newHashes: [], commitCount: 0, skippedCount: 0, discoveredAuthors: [] };
      }
      continue; // skip this chunk, try next
    }

    const commits = parseGitLogOutput(output);
    totalCommitCount += commits.length;

    skippedCount += processCommitBatch(
      commits, repoName, group, authorMap, recentHashes,
      recordMap, activeDaysMap, newHashes, rawAuthorsMap, identifierRules,
      shouldIgnore,
    );
    // `output` and `commits` go out of scope here → eligible for GC
  }

  // Finalize activeDays from the tracked sets
  for (const [key, days] of activeDaysMap) {
    const record = recordMap.get(key);
    if (record) {
      record.activeDays = Math.min(days.size, 7);
    }
  }

  return {
    newRecords: Array.from(recordMap.values()),
    newHashes,
    commitCount: totalCommitCount,
    skippedCount,
    discoveredAuthors: Array.from(rawAuthorsMap.values()),
  };
}

/**
 * Calculate code churn rate for a specific author in a time period.
 *
 * "Churn" = lines changed in files that were also modified within the
 * instability window (default 21 days) prior to each commit.
 * A high churn rate suggests code instability or rework.
 *
 * Returns a percentage (0-100). Samples up to `maxCommits` to bound performance.
 *
 * Note: Uses simple-git (which internally uses execFile, not shell exec)
 * for all git operations. Author email is passed as a git argument, not
 * interpolated into a shell command.
 */
export async function calculateChurnRate(
  repoPath: string,
  authorEmail: string,
  since: string,
  until: string,
  instabilityWindowDays = 21,
  maxCommits = 50,
): Promise<number> {
  const git = simpleGit(repoPath);

  // Get author's commits in the period
  let logOutput: string;
  try {
    logOutput = await git.raw([
      "log",
      `--since=${since}`,
      `--until=${until}`,
      `--author=${authorEmail}`,
      "--no-merges",
      "--format=%H",
      "--numstat",
    ]);
  } catch {
    return 0;
  }

  if (!logOutput.trim()) return 0;

  // Parse into commit hashes + their files with line counts
  const commitFiles = parseChurnLog(logOutput);

  // Sample if too many commits
  const sampled = commitFiles.length > maxCommits
    ? sampleEvenly(commitFiles, maxCommits)
    : commitFiles;

  let totalLines = 0;
  let churnLines = 0;

  for (const { hash, files } of sampled) {
    // Get the commit date for this commit
    let dateStr: string;
    try {
      dateStr = (await git.raw(["log", "-1", "--format=%aI", hash])).trim();
    } catch {
      continue;
    }

    const commitDate = new Date(dateStr);
    const windowStart = new Date(commitDate);
    windowStart.setDate(windowStart.getDate() - instabilityWindowDays);
    const windowSince = windowStart.toISOString().slice(0, 10);
    const windowUntil = commitDate.toISOString().slice(0, 10);

    for (const file of files) {
      const lines = file.insertions + file.deletions;
      totalLines += lines;

      // Check if this file was modified by anyone in the instability window
      try {
        const priorLog = await git.raw([
          "log",
          `--since=${windowSince}`,
          `--until=${windowUntil}`,
          "--format=%H",
          "--",
          file.path,
        ]);
        // If there are prior commits to this file (excluding current commit)
        const priorHashes = priorLog.trim().split("\n").filter((h) => h && h !== hash);
        if (priorHashes.length > 0) {
          churnLines += lines;
        }
      } catch {
        // File may not exist in git history at this point
      }
    }
  }

  if (totalLines === 0) return 0;
  return Math.round((churnLines / totalLines) * 100);
}

// ── Churn helpers ──────────────────────────────────────────────────────────

export interface ChurnCommit {
  hash: string;
  files: Array<{ path: string; insertions: number; deletions: number }>;
}

/**
 * Parse a simplified git log output (hash + numstat) into commit-file pairs.
 */
export function parseChurnLog(output: string): ChurnCommit[] {
  const commits: ChurnCommit[] = [];
  let current: ChurnCommit | null = null;

  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Hash line (40 hex chars)
    if (/^[0-9a-f]{40}$/.test(trimmed)) {
      if (current) commits.push(current);
      current = { hash: trimmed, files: [] };
      continue;
    }

    // Numstat line
    if (current) {
      const match = NUMSTAT_RE.exec(trimmed);
      if (match) {
        const ins = match[1] === "-" ? 0 : parseInt(match[1], 10) || 0;
        const del = match[2] === "-" ? 0 : parseInt(match[2], 10) || 0;
        const path = trimmed.split("\t").slice(2).join("\t");
        current.files.push({ path, insertions: ins, deletions: del });
      }
    }
  }

  if (current) commits.push(current);
  return commits;
}

/**
 * Evenly sample N items from an array.
 */
export function sampleEvenly<T>(arr: T[], n: number): T[] {
  if (n >= arr.length) return arr;
  const step = arr.length / n;
  const result: T[] = [];
  for (let i = 0; i < n; i++) {
    result.push(arr[Math.floor(i * step)]);
  }
  return result;
}
