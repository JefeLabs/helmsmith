import pLimit from 'p-limit';
import { simpleGit } from 'simple-git';
import type { UserWeekRepoRecord } from '../types/schema.js';
import type { AuthorMap, IdentifierRule } from './author-map.js';
import { resolveAuthor } from './author-map.js';
import { classifyGitError, makeEmptyRecord, unassignedAuthor } from './git.js';

/**
 * Blame-based rework: for every line a commit deletes, ask `git blame` on the parent
 * who wrote it and when. Lines younger than `windowDays` count as rework against
 * their ORIGINAL author in the week of the deletion (and as self-rework when the
 * deleter is that author). This is "code that didn't survive", not "busy files".
 */
export interface ReworkInput {
  hash: string;
  authorEmail: string;
  authorName: string;
  authorDate: string;
  week: string;
  files: Array<{ path: string; deletions: number }>;
}

export interface ReworkOptions {
  repoPath: string;
  repoName: string;
  group: string;
  authorMap: AuthorMap;
  identifierRules?: IdentifierRule[];
  windowDays: number;
  concurrency: number;
}

export interface ReworkResult {
  records: UserWeekRepoRecord[];
  commitsProcessed: number;
  blames: number;
}

const FILE_RE = /^diff --git a\/(.+?) b\/(.+)$/;
const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@/;

/** Deleted line ranges (old-file numbering) per path from a `-U0` diff. */
export function parseDeletedHunks(
  diff: string,
): Map<string, Array<{ start: number; count: number }>> {
  const result = new Map<string, Array<{ start: number; count: number }>>();
  let file: string | null = null;
  for (const line of diff.split('\n')) {
    const f = FILE_RE.exec(line);
    if (f) {
      file = f[2];
      continue;
    }
    const h = HUNK_RE.exec(line);
    if (h && file) {
      const count = h[2] === undefined ? 1 : parseInt(h[2], 10);
      if (count > 0) {
        const list = result.get(file) ?? [];
        list.push({ start: parseInt(h[1], 10), count });
        result.set(file, list);
      }
    }
  }
  return result;
}

/** One {email,name,time} per line of `git blame --porcelain` output. */
export function parseBlamePorcelain(
  out: string,
): Array<{ email: string; name: string; time: number }> {
  const byCommit = new Map<string, { email: string; name: string; time: number }>();
  const lines: Array<{ email: string; name: string; time: number }> = [];
  let current: string | null = null;
  let pending: { email?: string; name?: string; time?: number } = {};
  for (const line of out.split('\n')) {
    // Header: "<hash> <origLine> <finalLine> [<numLines>]". The hash is normally a 40-char
    // hex sha, but matched loosely here (alnum, any length) — metadata lines like
    // "author-time 1700000000" can't match since the hyphen breaks the token before the
    // required space+digits, so there's no ambiguity.
    const header = /^([0-9a-zA-Z]+) (\d+) (\d+)(?: \d+)?$/.exec(line);
    if (header) {
      current = header[1];
      pending = {};
      continue;
    }
    // Must be checked before "author-mail"/"author-time" — the space (vs. hyphen) after
    // "author" disambiguates it from those metadata lines.
    if (line.startsWith('author ')) {
      pending.name = line.slice(7).trim();
      continue;
    }
    if (line.startsWith('author-mail ')) {
      pending.email = line.slice(12).trim().replace(/^<|>$/g, '');
      continue;
    }
    if (line.startsWith('author-time ')) {
      pending.time = parseInt(line.slice(12), 10);
      continue;
    }
    if (line.startsWith('\t') && current) {
      if (pending.email !== undefined && pending.time !== undefined) {
        byCommit.set(current, {
          email: pending.email,
          name: pending.name ?? '',
          time: pending.time,
        });
      }
      const meta = byCommit.get(current);
      if (meta) lines.push(meta);
    }
  }
  return lines;
}

export async function runRework(inputs: ReworkInput[], opts: ReworkOptions): Promise<ReworkResult> {
  const git = simpleGit(opts.repoPath);
  const limit = pLimit(Math.max(1, opts.concurrency));
  const byKey = new Map<string, UserWeekRepoRecord>();
  let commitsProcessed = 0;
  let blames = 0;
  const windowSec = opts.windowDays * 86400;

  const bump = (email: string, name: string, week: string, self: boolean) => {
    const author =
      resolveAuthor(opts.authorMap, email, name, opts.identifierRules) ??
      unassignedAuthor(name || email, email);
    const key = `${author.member}::${week}::${opts.repoName}`;
    let rec = byKey.get(key);
    if (!rec) {
      rec = makeEmptyRecord(author, week, opts.repoName, opts.group);
      rec.reworkLines = 0;
      rec.reworkSelfLines = 0;
      byKey.set(key, rec);
    }
    rec.reworkLines = (rec.reworkLines ?? 0) + 1;
    if (self) rec.reworkSelfLines = (rec.reworkSelfLines ?? 0) + 1;
  };

  await Promise.all(
    inputs.map((c) =>
      limit(async () => {
        const paths = c.files.filter((f) => f.deletions > 0).map((f) => f.path);
        if (paths.length === 0) return;
        commitsProcessed++;
        let diff: string;
        try {
          diff = await git.raw([
            'diff',
            '-U0',
            '--no-color',
            '--diff-filter=MD',
            `${c.hash}^`,
            c.hash,
            '--',
            ...paths,
          ]);
        } catch (error) {
          const err = classifyGitError(error);
          if (err.severity === 'fatal')
            console.error(`  Rework diff error (${c.hash.slice(0, 8)}): ${err.reason}`);
          return; // root commits and missing parents land here
        }
        const commitSec = Date.parse(c.authorDate) / 1000;
        const deleter =
          resolveAuthor(opts.authorMap, c.authorEmail, c.authorName, opts.identifierRules)
            ?.member ?? c.authorName;
        for (const [path, ranges] of parseDeletedHunks(diff)) {
          const args = ['blame', '--porcelain', '-w'];
          for (const r of ranges) args.push('-L', `${r.start},${r.start + r.count - 1}`);
          args.push(`${c.hash}^`, '--', path);
          let out: string;
          try {
            out = await git.raw(args);
            blames++;
          } catch (error) {
            const err = classifyGitError(error);
            if (err.severity === 'fatal')
              console.error(`  Rework blame error (${path}): ${err.reason}`);
            continue;
          }
          for (const line of parseBlamePorcelain(out)) {
            if (commitSec - line.time > windowSec) continue;
            const origMember = resolveAuthor(
              opts.authorMap,
              line.email,
              line.name,
              opts.identifierRules,
            )?.member;
            bump(line.email, line.name, c.week, origMember !== undefined && origMember === deleter);
          }
        }
      }),
    ),
  );

  return { records: [...byKey.values()], commitsProcessed, blames };
}
