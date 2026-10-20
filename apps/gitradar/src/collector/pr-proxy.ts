import { simpleGit } from 'simple-git';
import type { UserWeekRepoRecord } from '../types/schema.js';
import type { AuthorMap, IdentifierRule, ResolvedAuthor } from './author-map.js';
import { resolveAuthor } from './author-map.js';
import { classifyGitError, getISOWeek, makeEmptyRecord, unassignedAuthor } from './git.js';

/**
 * Git-only merged-PR proxy.
 *
 * Walks the default branch with --first-parent: every commit on that line is either
 * a merge commit (classic PR merge), a squash/rebase commit, or a direct push. We
 * count a commit as a merged PR when it is a merge commit or its subject carries a
 * PR reference. Size is the diff against the first parent, ignore-filtered.
 */
export interface FirstParentCommit {
  hash: string;
  parents: string[];
  email: string;
  name: string;
  date: string;
  subject: string;
  files: Array<{ path: string; insertions: number; deletions: number }>;
}

/** NUL-delimited headers, for the same reason as the main scan (#70). */
const FIRST_PARENT_FORMAT = '--format=%x00%H%x00%P%x00%ae%x00%an%x00%aI%x00%s';
const TIP_FORMAT = '--format=%x00%H%x00%ae%x00%an';
const NUMSTAT_RE = /^(\d+|-)\t(\d+|-)\t(.+)$/;

/** Replace control characters (a `\r` or `\t` smuggled into a name) with spaces. */
function sanitizeField(value: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: that is the point
  return value.replace(/[\x00-\x1f\x7f]/g, ' ').trim();
}

export function parseFirstParentLog(output: string): FirstParentCommit[] {
  const commits: FirstParentCommit[] = [];
  let current: FirstParentCommit | null = null;
  for (const raw of output.split('\n')) {
    const line = raw.trimEnd();
    if (!line) continue;
    if (line.startsWith('\x00')) {
      const f = line.split('\x00');
      const hash = f[1] ?? '';
      const date = (f[5] ?? '').trim();
      if (!/^[0-9a-f]{6,40}$/.test(hash) || Number.isNaN(Date.parse(date))) {
        console.log(
          `  Warning: PR proxy: skipping commit with an unparseable header (${hash || '?'}, date "${date}")`,
        );
        current = null; // and its numstat lines
        continue;
      }
      current = {
        hash,
        parents: (f[2] ?? '').split(' ').filter(Boolean),
        email: sanitizeField(f[3] ?? ''),
        name: sanitizeField(f[4] ?? ''),
        date,
        subject: sanitizeField(f.slice(6).join('\x00')),
        files: [],
      };
      commits.push(current);
      continue;
    }
    const n = NUMSTAT_RE.exec(line);
    if (n && current) {
      current.files.push({
        path: n[3],
        insertions: n[1] === '-' ? 0 : parseInt(n[1], 10),
        deletions: n[2] === '-' ? 0 : parseInt(n[2], 10),
      });
    }
  }
  return commits;
}

const PR_SUBJECT_RES = [
  /\(#\d+\)\s*$/, // GitHub squash: "feat: x (#42)"
  /^Merge pull request #\d+/, // GitHub merge commit subject
  /\(!\d+\)\s*$/, // GitLab squash: "fix: y (!9)"
  /See merge request .*!\d+/, // GitLab merge commit body-in-subject
];

export function isPullRequest(c: Pick<FirstParentCommit, 'parents' | 'subject'>): boolean {
  if (c.parents.length >= 2) return true;
  return PR_SUBJECT_RES.some((re) => re.test(c.subject));
}

export async function resolveDefaultBranch(repoPath: string): Promise<string | null> {
  const git = simpleGit(repoPath);
  try {
    const ref = (await git.raw(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])).trim();
    const name = ref.replace(/^origin\//, '');
    // Git allows a ref component to start with `-`; such a name reaching `git log` as a bare
    // argument is parsed as an option (#71). Refuse it and fall back to main/master.
    if (name.startsWith('-')) {
      console.log(
        `  Warning: ${repoPath}: origin/HEAD points at "${name}", which looks like an option; ignoring it`,
      );
    } else if (name) {
      return name;
    }
  } catch {
    // fall through
  }
  for (const candidate of ['main', 'master']) {
    try {
      // No `--quiet`: under simple-git, a non-zero exit with empty stderr (which `--quiet`
      // guarantees for a missing ref) does not reject the promise — it resolves with empty
      // stdout instead. Without `--quiet`, a missing ref writes to stderr and simple-git
      // rejects as expected; a present ref prints its SHA on stdout, which we require to be
      // non-empty so a spurious resolve can't be mistaken for a real match.
      const out = (await git.raw(['rev-parse', '--verify', `refs/heads/${candidate}`])).trim();
      if (out) return candidate;
    } catch {
      // try next
    }
  }
  return null;
}

export interface PrProxyOptions {
  repoPath: string;
  repoName: string;
  group: string;
  authorMap: AuthorMap;
  identifierRules?: IdentifierRule[];
  recentPrHashes: Set<string>;
  since?: string;
  shouldIgnore: (filePath: string) => boolean;
}

export interface PrProxyResult {
  records: UserWeekRepoRecord[];
  newPrHashes: string[];
  prCount: number;
  branch: string | null;
}

export async function runPrProxy(opts: PrProxyOptions): Promise<PrProxyResult> {
  const empty: PrProxyResult = { records: [], newPrHashes: [], prCount: 0, branch: null };
  const branch = await resolveDefaultBranch(opts.repoPath);
  if (!branch) return empty;

  const git = simpleGit(opts.repoPath);

  // Resolve the branch to a commit SHA first, and hand git log only that SHA behind
  // `--end-of-options`, so no ref name is ever parsed as an option (#71).
  let sha: string;
  try {
    sha = (
      await git.raw(['rev-parse', '--verify', '--end-of-options', `${branch}^{commit}`])
    ).trim();
  } catch (error) {
    const err = classifyGitError(error);
    if (err.severity === 'fatal')
      console.error(`  PR proxy error (${opts.repoName}): ${err.reason}`);
    return { ...empty, branch };
  }
  if (!/^[0-9a-f]{40}$/.test(sha)) {
    console.log(
      `  Warning: PR proxy (${opts.repoName}): "${branch}" did not resolve to a commit; skipping`,
    );
    return { ...empty, branch };
  }

  const args = ['log', '--first-parent', '-m', FIRST_PARENT_FORMAT, '--numstat'];
  if (opts.since) args.push(`--since=${opts.since}`);
  args.push('--end-of-options', sha);
  let output: string;
  try {
    output = await git.raw(args);
  } catch (error) {
    const err = classifyGitError(error);
    if (err.severity === 'fatal')
      console.error(`  PR proxy error (${opts.repoName}): ${err.reason}`);
    return { ...empty, branch };
  }

  const commits = parseFirstParentLog(output).filter((c) => !opts.recentPrHashes.has(c.hash));
  const prs = commits.filter(isPullRequest);

  // Merge commits: the PR author is whoever authored the second parent's tip.
  const tipAuthors = new Map<string, { email: string; name: string }>();
  const tips = [...new Set(prs.filter((c) => c.parents.length >= 2).map((c) => c.parents[1]))];
  if (tips.length > 0) {
    try {
      const out = await git.raw(['log', '--no-walk', TIP_FORMAT, '--end-of-options', ...tips]);
      for (const line of out.split('\n')) {
        const [, hash, email, name] = line.trimEnd().split('\x00');
        if (hash)
          tipAuthors.set(hash, {
            email: sanitizeField(email ?? ''),
            name: sanitizeField(name ?? ''),
          });
      }
    } catch (error) {
      const err = classifyGitError(error);
      if (err.severity === 'fatal')
        console.error(`  PR proxy tip lookup (${opts.repoName}): ${err.reason}`);
    }
  }

  const byKey = new Map<string, UserWeekRepoRecord>();
  for (const c of prs) {
    const who = c.parents.length >= 2 ? (tipAuthors.get(c.parents[1]) ?? c) : c;
    const author: ResolvedAuthor =
      resolveAuthor(opts.authorMap, who.email, who.name, opts.identifierRules) ??
      unassignedAuthor(who.name, who.email);
    const week = getISOWeek(c.date);
    const key = `${author.member}::${week}::${opts.repoName}`;
    let rec = byKey.get(key);
    if (!rec) {
      rec = makeEmptyRecord(author, week, opts.repoName, opts.group);
      rec.prsMergedGit = 0;
      rec.prSizes = [];
      byKey.set(key, rec);
    }
    const size = c.files
      .filter((f) => !opts.shouldIgnore(f.path))
      .reduce((s, f) => s + f.insertions + f.deletions, 0);
    rec.prsMergedGit = (rec.prsMergedGit ?? 0) + 1;
    rec.prSizes!.push(size);
  }

  return {
    records: [...byKey.values()],
    newPrHashes: commits.map((c) => c.hash),
    prCount: prs.length,
    branch,
  };
}
