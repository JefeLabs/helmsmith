import { simpleGit } from "simple-git";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { UserWeekRepoRecord } from "../types/schema.js";
import type { AuthorMap } from "./author-map.js";
import { resolveAuthor } from "./author-map.js";
import { classifyFile, buildIgnoreMatcher, buildClassifier } from "./classifier.js";
import type { FileType } from "./classifier.js";

// Note: spawn is used with array arguments (no shell interpretation),
// equivalent to simple-git's internal execFile usage. All args are
// constructed from internal code, never from raw user input.

// ── Git Error Classification ──────────────────────────────────────────────

/**
 * Severity of a git error, used to decide whether to swallow or surface it.
 *
 * - `fatal`: The repository is broken / inaccessible — stop and report to user.
 *   Examples: locked index, corrupt object, repo not found, permission denied.
 * - `expected`: A normal condition that doesn't indicate a real problem.
 *   Examples: file not found in history, empty log output, no matching author.
 * - `transient`: Temporary issues that might succeed on retry.
 *   Examples: ENOENT when repo path was moved/unmounted between scans.
 */
export type GitErrorSeverity = 'fatal' | 'expected' | 'transient';

export interface GitErrorInfo {
  severity: GitErrorSeverity;
  /** Short reason suitable for log messages. */
  reason: string;
  /** Original error message for debug output. */
  original: string;
}

const FATAL_PATTERNS: Array<[RegExp, string]> = [
  [/\.git\/index\.lock/i, 'index file is locked (another git process running?)'],
  [/corrupt/i, 'repository appears corrupt'],
  [/not a git repository/i, 'not a git repository'],
  [/permission denied/i, 'permission denied'],
  [/bad revision/i, 'bad revision reference'],
  [/ambiguous argument/i, 'ambiguous argument (check branch/ref names)'],
  [/fatal: bad object/i, 'bad object reference (possible corruption)'],
  [/unable to read tree/i, 'unable to read tree (possible corruption)'],
  [/packed-refs.*lock/i, 'packed-refs locked'],
];

const EXPECTED_PATTERNS: Array<[RegExp, string]> = [
  [/does not have any commits yet/i, 'empty repository'],
  [/unknown revision/i, 'no commits match the given range'],
  [/no such path/i, 'file not found in history'],
  [/bad default revision/i, 'empty repository or no default branch'],
  [/path .* does not exist/i, 'file not found in history'],
];

/**
 * Classify a git error message to determine severity.
 * Fatal errors should be surfaced to the user; expected errors can be silently
 * swallowed; transient errors may warrant a warning.
 */
export function classifyGitError(error: unknown): GitErrorInfo {
  const msg = error instanceof Error ? error.message : String(error);

  for (const [re, reason] of FATAL_PATTERNS) {
    if (re.test(msg)) return { severity: 'fatal', reason, original: msg };
  }

  for (const [re, reason] of EXPECTED_PATTERNS) {
    if (re.test(msg)) return { severity: 'expected', reason, original: msg };
  }

  // ENOENT / EACCES at the OS level (repo path doesn't exist / not accessible)
  if (/ENOENT/.test(msg)) return { severity: 'transient', reason: 'repository path not found', original: msg };
  if (/EACCES/.test(msg)) return { severity: 'fatal', reason: 'permission denied', original: msg };

  // Default: treat unknown errors as transient (log a warning but don't crash)
  return { severity: 'transient', reason: 'unexpected git error', original: msg };
}

export type FileStatus = 'A' | 'M' | 'D' | 'R' | 'C' | 'T' | 'unknown';

/**
 * A single parsed commit from git log output.
 */
export type IntentType = 'feat' | 'fix' | 'refactor' | 'docs' | 'test' | 'chore' | 'other';

export interface ParsedCommit {
  hash: string;
  email: string;
  name: string;
  date: string;
  subject: string;
  intent: IntentType;
  /** Conventional commit scope, e.g. "auth" from "feat(auth): ..." */
  scope?: string;
  /** True if the commit is a breaking change (e.g. "feat!:" or "feat(auth)!:") */
  breaking?: boolean;
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
  /** User-defined classification rules: glob pattern → filetype category. Takes priority over built-in rules. */
  classificationRules?: Record<string, FileType>;
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
 * Parse a conventional commit subject into an intent type, optional scope,
 * and breaking-change flag.
 *
 * Matches patterns like "feat:", "feat(scope):", "fix!:", "feat(auth)!:".
 * Falls back to "other" for non-conventional commits.
 */
const CONVENTIONAL_RE = /^(feat|fix|refactor|docs|test|tests|chore|ci|build|perf|style|revert)(\(([^)]+)\))?([!])?:/i;

export interface ParsedIntent {
  intent: IntentType;
  scope?: string;
  breaking: boolean;
}

export function parseIntent(subject: string): IntentType {
  return parseConventionalCommit(subject).intent;
}

export function parseConventionalCommit(subject: string): ParsedIntent {
  const match = CONVENTIONAL_RE.exec(subject.trim());
  if (!match) return { intent: 'other', breaking: false };

  const prefix = match[1].toLowerCase();
  const scope = match[3] || undefined;  // capture group 3 = inner scope text
  const bang = match[4] === '!';

  let intent: IntentType;
  if (prefix === 'tests') intent = 'test';
  else if (prefix === 'ci' || prefix === 'build' || prefix === 'perf' || prefix === 'style' || prefix === 'revert') intent = 'chore';
  else intent = prefix as IntentType;

  return { intent, scope, breaking: bang };
}

/**
 * Detect whether a line is a commit header (hash|email|name|date|subject).
 * A header line has 5+ pipe-separated parts and the first part is a hex hash.
 * Falls back to 4-part headers for backwards compatibility.
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
 *   --format="%H|%ae|%an|%aI|%s" --raw --numstat
 *
 * Each commit block has a header line, followed by raw diff lines
 * (:mode mode hash hash status\tpath) and numstat lines
 * (insertions\tdeletions\tpath), with blank lines between sections.
 * Commits are delimited by their header lines rather than blank lines.
 *
 * The 5th pipe-separated field is the commit subject line, used to
 * detect conventional commit intent (feat, fix, refactor, etc.).
 * Falls back gracefully to "other" if subject is missing (4-field format).
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
      // Format: hash|email|name|date|subject (subject may contain |)
      // Backwards-compatible with old 4-field format (hash|email|name|date)
      const hash = parts[0];
      const email = parts[1];
      let name: string;
      let date: string;
      let subject: string;
      if (parts.length >= 5) {
        // New format: hash|email|name|date|subject...
        name = parts[2];
        date = parts[3];
        subject = parts.slice(4).join("|"); // subject may contain |
      } else {
        // Old format: hash|email|name|date (name may contain |)
        name = parts.slice(2, -1).join("|");
        date = parts[parts.length - 1];
        subject = '';
      }
      const parsed = parseConventionalCommit(subject);
      current = {
        hash,
        email,
        name,
        date,
        subject,
        intent: parsed.intent,
        scope: parsed.scope,
        breaking: parsed.breaking,
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
 * Stateful line-by-line parser for git log output.
 *
 * Instead of collecting the full output into a string and splitting,
 * this parser processes one line at a time and yields complete commits
 * as soon as all their raw-diff and numstat lines have been consumed.
 *
 * Usage:
 *   const parser = new GitLogLineParser();
 *   for each line:
 *     const commit = parser.processLine(line);
 *     if (commit) handle(commit);
 *   const last = parser.flush();
 *   if (last) handle(last);
 */
export class GitLogLineParser {
  private current: ParsedCommit | null = null;
  private statusMap = new Map<string, FileStatus>();

  /**
   * Feed a single line to the parser.
   * Returns a completed ParsedCommit when a new header line is encountered
   * (which finalizes the previous commit), or null if still accumulating.
   */
  processLine(line: string): ParsedCommit | null {
    const trimmed = line.trim();
    if (trimmed === "") return null;

    if (isHeaderLine(trimmed)) {
      const completed = this.finalizeCurrent();

      const parts = trimmed.split("|");
      const hash = parts[0];
      const email = parts[1];
      let name: string;
      let date: string;
      let subject: string;
      if (parts.length >= 5) {
        name = parts[2];
        date = parts[3];
        subject = parts.slice(4).join("|");
      } else {
        name = parts.slice(2, -1).join("|");
        date = parts[parts.length - 1];
        subject = '';
      }
      const parsed = parseConventionalCommit(subject);
      this.current = {
        hash, email, name, date, subject,
        intent: parsed.intent,
        scope: parsed.scope,
        breaking: parsed.breaking,
        files: [],
      };
      this.statusMap = new Map();
      return completed;
    }

    if (!this.current) return null;

    // Raw diff line
    const rawMatch = RAW_DIFF_RE.exec(trimmed);
    if (rawMatch) {
      const statusChar = rawMatch[1] as FileStatus;
      const rest = rawMatch[3];
      if ((statusChar === 'R' || statusChar === 'C') && rest.includes('\t')) {
        const [oldPath, newPath] = rest.split('\t');
        this.statusMap.set(oldPath, statusChar);
        this.statusMap.set(newPath, statusChar);
      } else {
        this.statusMap.set(rest, statusChar);
      }
      return null;
    }

    // Numstat line
    const numMatch = NUMSTAT_RE.exec(trimmed);
    if (numMatch) {
      const ins = numMatch[1] === "-" ? 0 : parseInt(numMatch[1], 10) || 0;
      const del = numMatch[2] === "-" ? 0 : parseInt(numMatch[2], 10) || 0;
      const filePath = trimmed.split("\t").slice(2).join("\t");

      let lookupPath = filePath;
      const arrowIdx = filePath.indexOf(" => ");
      if (arrowIdx !== -1) {
        lookupPath = filePath.slice(arrowIdx + 4);
      }

      const status = this.statusMap.get(filePath) ?? this.statusMap.get(lookupPath) ?? 'unknown';
      this.current.files.push({ insertions: ins, deletions: del, path: filePath, status });
    }

    return null;
  }

  /** Flush the last accumulated commit (call after all lines are consumed). */
  flush(): ParsedCommit | null {
    return this.finalizeCurrent();
  }

  private finalizeCurrent(): ParsedCommit | null {
    if (!this.current) return null;
    for (const f of this.current.files) {
      if (f.status === 'unknown') {
        const s = this.statusMap.get(f.path);
        if (s) f.status = s;
      }
    }
    const completed = this.current;
    this.current = null;
    return completed;
  }
}

/**
 * Spawn `git log` as a child process and stream its stdout line by line.
 * Returns the total commit count and skipped count after processing all output.
 *
 * Each complete commit is immediately fed to processCommitBatch (single-element array)
 * so memory usage is bounded to one commit at a time rather than the full output.
 */
async function streamGitLog(
  repoPath: string,
  args: string[],
  batchArgs: {
    repoName: string;
    group: string;
    authorMap: AuthorMap;
    recentHashes: Set<string>;
    recordMap: Map<string, UserWeekRepoRecord>;
    activeDaysMap: Map<string, Set<string>>;
    newHashes: string[];
    rawAuthorsMap: Map<string, RawAuthor>;
    identifierRules?: ScanOptions["identifierRules"];
    shouldIgnore?: (filePath: string) => boolean;
    classify?: (filePath: string) => FileType;
  },
): Promise<{ commitCount: number; skippedCount: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd: repoPath, stdio: ["ignore", "pipe", "pipe"] });

    const parser = new GitLogLineParser();
    let commitCount = 0;
    let skippedCount = 0;
    const stderrChunks: Buffer[] = [];

    const handleCommit = (commit: ParsedCommit) => {
      commitCount++;
      skippedCount += processCommitBatch(
        [commit],
        batchArgs.repoName,
        batchArgs.group,
        batchArgs.authorMap,
        batchArgs.recentHashes,
        batchArgs.recordMap,
        batchArgs.activeDaysMap,
        batchArgs.newHashes,
        batchArgs.rawAuthorsMap,
        batchArgs.identifierRules,
        batchArgs.shouldIgnore,
        batchArgs.classify,
      );
    };

    const rl = createInterface({ input: child.stdout!, crlfDelay: Infinity });

    rl.on("line", (line) => {
      const commit = parser.processLine(line);
      if (commit) handleCommit(commit);
    });

    child.stderr!.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });

    child.on("error", (err) => {
      rl.close();
      reject(err);
    });

    child.on("close", (code) => {
      // Flush the last commit from the parser
      const last = parser.flush();
      if (last) handleCommit(last);

      if (code !== 0 && commitCount === 0) {
        const stderr = Buffer.concat(stderrChunks).toString().trim();
        reject(new Error(stderr || `git log exited with code ${code}`));
      } else {
        resolve({ commitCount, skippedCount });
      }
    });
  });
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
 * Create an empty intent metrics structure.
 */
function emptyIntent(): NonNullable<UserWeekRepoRecord["intent"]> {
  return { feat: 0, fix: 0, refactor: 0, docs: 0, test: 0, chore: 0, other: 0 };
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
  classify?: (filePath: string) => FileType,
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
        intent: emptyIntent(),
        breakingChanges: 0,
        scopes: [],
        filetype: emptyFiletype(),
      });
    }

    const record = recordMap.get(key)!;
    record.commits += 1;

    // Accumulate intent from conventional commit prefix
    if (record.intent) {
      record.intent[commit.intent] = (record.intent[commit.intent] ?? 0) + 1;
    }

    // Accumulate breaking changes and scopes
    if (commit.breaking) {
      record.breakingChanges = (record.breakingChanges ?? 0) + 1;
    }
    if (commit.scope && !record.scopes?.includes(commit.scope)) {
      (record.scopes ??= []).push(commit.scope);
    }

    const classifyFn = classify ?? classifyFile;
    for (const file of commit.files) {
      if (shouldIgnore?.(file.path)) continue;
      const category = classifyFn(file.path);
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
 * Spawns `git log` as a child process and streams its stdout line by line,
 * processing each commit as soon as its lines are complete. This keeps
 * memory usage proportional to the accumulator maps (bounded by team size ×
 * weeks) rather than the full git output string.
 *
 * When `chunkMonths` is set and this is a first-time scan (no `since`),
 * the date range is split into N-month windows.
 *
 * Deduplicates against recentHashes, resolves authors, classifies files,
 * and accumulates metrics into per-member/week/repo records.
 */
export async function scanRepo(
  repoPath: string,
  options: ScanOptions
): Promise<ScanResult> {
  const { repoName, group, authorMap, recentHashes, since, chunkMonths, identifierRules, ignorePatterns, classificationRules } = options;

  const shouldIgnore = buildIgnoreMatcher(ignorePatterns);
  const classify = buildClassifier(classificationRules);
  const ranges = buildScanRanges(since, chunkMonths);

  // Shared state across all chunks — the recordMap is small (bounded by
  // members × weeks), so it's safe to keep in memory.
  const recordMap = new Map<string, UserWeekRepoRecord>();
  const activeDaysMap = new Map<string, Set<string>>();
  const rawAuthorsMap = new Map<string, RawAuthor>();
  const newHashes: string[] = [];
  let totalCommitCount = 0;
  let skippedCount = 0;

  const batchArgs = {
    repoName, group, authorMap, recentHashes,
    recordMap, activeDaysMap, newHashes, rawAuthorsMap,
    identifierRules, shouldIgnore, classify,
  };

  for (const range of ranges) {
    const args = ["log", "--raw", "--numstat", "--no-merges", "--format=%H|%ae|%an|%aI|%s"];
    if (range.since) args.splice(1, 0, `--since=${range.since}`);
    if (range.until) args.splice(1, 0, `--until=${range.until}`);

    try {
      const result = await streamGitLog(repoPath, args, batchArgs);
      totalCommitCount += result.commitCount;
      skippedCount += result.skippedCount;
    } catch (error) {
      const gitErr = classifyGitError(error);
      if (gitErr.severity === 'fatal') {
        console.error(`  Error: ${repoName}: ${gitErr.reason}`);
        return { newRecords: [], newHashes: [], commitCount: 0, skippedCount: 0, discoveredAuthors: [] };
      }
      if (gitErr.severity === 'transient') {
        console.log(`  Warning: git error in ${repoName}: ${gitErr.reason}`);
      }
      // 'expected' errors are silently skipped (e.g. empty repo, no commits in range)
      if (ranges.length === 1) {
        return { newRecords: [], newHashes: [], commitCount: 0, skippedCount: 0, discoveredAuthors: [] };
      }
      continue; // skip this chunk, try next
    }
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
  } catch (error) {
    const gitErr = classifyGitError(error);
    if (gitErr.severity === 'fatal') {
      console.error(`  Churn error (${authorEmail}): ${gitErr.reason}`);
    }
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
    } catch (error) {
      const gitErr = classifyGitError(error);
      if (gitErr.severity === 'fatal') {
        console.error(`  Churn error (commit ${hash.slice(0, 8)}): ${gitErr.reason}`);
      }
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
      } catch (error) {
        // File may not exist in git history at this point — expected.
        // Only log if it's a real problem.
        const gitErr = classifyGitError(error);
        if (gitErr.severity === 'fatal') {
          console.error(`  Churn error (file ${file.path}): ${gitErr.reason}`);
        }
      }
    }
  }

  if (totalLines === 0) return 0;
  return Math.round((churnLines / totalLines) * 100);
}

/**
 * Fast churn heuristic: estimates churn rate using only 2 git log calls.
 *
 * Strategy: Get all commits by author in the period, then get all commits
 * by anyone in the instability window. Count how many of the author's
 * file-changes overlap with files that were recently modified.
 *
 * Much faster than calculateChurnRate (2 git calls vs N×M), with
 * slightly less precision (doesn't track exact per-commit window).
 *
 * Filters instability-window commits by intent: chore and docs commits
 * are excluded so that formatting fixes or README edits don't inflate
 * the churn metric.
 */
export async function calculateFastChurnRate(
  repoPath: string,
  authorEmail: string,
  since: string,
  until: string,
  instabilityWindowDays = 21,
): Promise<number> {
  const git = simpleGit(repoPath);

  // 1. Get all commits by author in period with file changes
  let authorOutput: string;
  try {
    authorOutput = await git.raw([
      "log",
      `--since=${since}`,
      `--until=${until}`,
      `--author=${authorEmail}`,
      "--no-merges",
      "--format=%H",
      "--numstat",
    ]);
  } catch (error) {
    const gitErr = classifyGitError(error);
    if (gitErr.severity === 'fatal') {
      console.error(`  Fast churn error (${authorEmail}): ${gitErr.reason}`);
    }
    return 0;
  }

  if (!authorOutput.trim()) return 0;

  const authorCommits = parseChurnLog(authorOutput);
  if (authorCommits.length === 0) return 0;

  // 2. Get all file modifications by anyone in the extended window
  //    (instability window before the period start).
  //    Include subject so we can filter out low-signal intents.
  const windowStart = new Date(since);
  windowStart.setDate(windowStart.getDate() - instabilityWindowDays);
  const windowSince = windowStart.toISOString().slice(0, 10);

  let allOutput: string;
  try {
    allOutput = await git.raw([
      "log",
      `--since=${windowSince}`,
      `--until=${until}`,
      "--no-merges",
      "--format=%H|%s",
      "--name-only",
    ]);
  } catch (error) {
    const gitErr = classifyGitError(error);
    if (gitErr.severity === 'fatal') {
      console.error(`  Fast churn error (instability window): ${gitErr.reason}`);
    }
    return 0;
  }

  // Build a set of files modified in the window (excluding current author's
  // commits AND excluding chore/docs commits that don't indicate real instability)
  const authorHashes = new Set(authorCommits.map((c) => c.hash));
  const recentlyModified = new Set<string>();
  let currentHash: string | null = null;
  let skipCurrentCommit = false;

  for (const line of allOutput.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Header line: hash|subject
    const pipeIdx = trimmed.indexOf("|");
    if (pipeIdx >= 40 && /^[0-9a-f]{40}$/.test(trimmed.slice(0, 40))) {
      currentHash = trimmed.slice(0, 40);
      const subject = trimmed.slice(pipeIdx + 1);
      const intent = parseIntent(subject);
      skipCurrentCommit = authorHashes.has(currentHash) || intent === "chore" || intent === "docs";
      continue;
    }

    if (currentHash && !skipCurrentCommit) {
      recentlyModified.add(trimmed.toLowerCase());
    }
  }

  // 3. Count churn: author's lines in files that were recently modified by others
  let totalLines = 0;
  let churnLines = 0;

  for (const commit of authorCommits) {
    for (const file of commit.files) {
      const lines = file.insertions + file.deletions;
      totalLines += lines;
      if (recentlyModified.has(file.path.toLowerCase())) {
        churnLines += lines;
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
