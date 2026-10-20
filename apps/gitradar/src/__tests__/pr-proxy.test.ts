import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthorMap } from '../collector/author-map.js';

const mockRaw = vi.fn();
vi.mock('simple-git', () => {
  const factory = vi.fn(() => ({ raw: mockRaw }));
  return { default: factory, simpleGit: factory };
});

const { parseFirstParentLog, isPullRequest, resolveDefaultBranch, runPrProxy } = await import(
  '../collector/pr-proxy.js'
);

function authorMap(): AuthorMap {
  const m: AuthorMap = new Map();
  const alice = {
    member: 'Alice',
    email: 'alice@co.com',
    org: 'Acme',
    orgType: 'core' as const,
    team: 'FE',
    tag: 'default',
  };
  const bob = {
    member: 'Bob',
    email: 'bob@co.com',
    org: 'Acme',
    orgType: 'core' as const,
    team: 'FE',
    tag: 'default',
  };
  m.set('alice@co.com', alice);
  m.set('alice', alice);
  m.set('bob@co.com', bob);
  m.set('bob', bob);
  return m;
}

const H = (...f: string[]) => `\x00${f.join('\x00')}`;
const LOG = [
  // merge commit: two parents; author is the merger (Bob); PR author is second parent tip (Alice)
  H(
    'aaaaaa1',
    'p1 p2',
    'bob@co.com',
    'Bob',
    '2026-02-18T10:00:00Z',
    'Merge pull request #12 from acme/feat',
  ),
  '100\t20\tsrc/a.ts',
  '500\t500\tpackage-lock.json',
  '',
  // squash commit with (#N) suffix
  H('bbbbbb2', 'p3', 'alice@co.com', 'Alice', '2026-02-19T10:00:00Z', 'feat: thing (#13)'),
  '30\t0\tsrc/b.ts',
  '',
  // direct push, not a PR
  H('cccccc3', 'p4', 'alice@co.com', 'Alice', '2026-02-19T12:00:00Z', 'fix typo'),
  '1\t1\tREADME.md',
].join('\n');

describe('parseFirstParentLog', () => {
  it('parses hash, parents, author, date, subject and numstat files', () => {
    const commits = parseFirstParentLog(LOG);
    expect(commits).toHaveLength(3);
    expect(commits[0].parents).toEqual(['p1', 'p2']);
    expect(commits[0].subject).toBe('Merge pull request #12 from acme/feat');
    expect(commits[0].files).toEqual([
      { path: 'src/a.ts', insertions: 100, deletions: 20 },
      { path: 'package-lock.json', insertions: 500, deletions: 500 },
    ]);
    expect(commits[1].parents).toEqual(['p3']);
  });
  it('handles subjects containing pipes and binary numstat dashes', () => {
    const [c] = parseFirstParentLog(
      `${H('dddddd4', 'p9', 'a@x', 'A', '2026-01-01T00:00:00Z', 'a | b (#1)')}\n-\t-\timg.png`,
    );
    expect(c.subject).toBe('a | b (#1)');
    expect(c.files).toEqual([{ path: 'img.png', insertions: 0, deletions: 0 }]);
  });
});

describe('parseFirstParentLog with hostile data (#70)', () => {
  it('keeps a | in the author name inside the name field', () => {
    const [c] = parseFirstParentLog(
      H(
        'eeeeee5',
        'p1',
        'jane@example.com',
        'Jane Doe | Acme Contractors',
        '2026-01-01T00:00:00Z',
        'x (#2)',
      ),
    );
    expect(c.email).toBe('jane@example.com');
    expect(c.name).toBe('Jane Doe | Acme Contractors');
    expect(c.date).toBe('2026-01-01T00:00:00Z');
  });

  it('drops a commit whose date does not parse so no NaN week is ever stored', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const commits = parseFirstParentLog(
      [
        H('ffffff6', 'p1', 'a@x', 'A', 'garbage', 'feat: a (#3)'),
        '1\t0\ta.ts',
        H('aaaaaa7', 'p2', 'b@x', 'B', '2026-01-02T00:00:00Z', 'feat: b (#4)'),
        '2\t0\tb.ts',
      ].join('\n'),
    );
    expect(commits.map((c) => c.hash)).toEqual(['aaaaaa7']);
    expect(commits[0].files).toEqual([{ path: 'b.ts', insertions: 2, deletions: 0 }]);
    log.mockRestore();
  });

  it('ignores a header whose hash is not hex', () => {
    expect(parseFirstParentLog(H('zzz', 'p1', 'a@x', 'A', '2026-01-01T00:00:00Z', 'x'))).toEqual(
      [],
    );
  });
});

describe('isPullRequest', () => {
  it('is true for merge commits and PR-referencing subjects only', () => {
    expect(isPullRequest({ parents: ['a', 'b'], subject: 'anything' })).toBe(true);
    expect(isPullRequest({ parents: ['a'], subject: 'feat: x (#42)' })).toBe(true);
    expect(isPullRequest({ parents: ['a'], subject: 'Merge pull request #7 from x/y' })).toBe(true);
    expect(isPullRequest({ parents: ['a'], subject: 'fix: y (!9)' })).toBe(true);
    expect(isPullRequest({ parents: ['a'], subject: 'See merge request acme/app!9' })).toBe(true);
    expect(isPullRequest({ parents: ['a'], subject: 'fix typo' })).toBe(false);
    expect(isPullRequest({ parents: ['a'], subject: 'bump #42 deps' })).toBe(false);
  });
});

describe('resolveDefaultBranch', () => {
  beforeEach(() => vi.resetAllMocks());
  it('prefers origin/HEAD, then main, then master, else null', async () => {
    mockRaw.mockResolvedValueOnce('origin/develop\n');
    expect(await resolveDefaultBranch('/r')).toBe('develop');

    mockRaw.mockRejectedValueOnce(
      new Error('fatal: ref refs/remotes/origin/HEAD is not a symbolic ref'),
    );
    mockRaw.mockResolvedValueOnce('abc123\n'); // rev-parse --verify main ok (prints the SHA)
    expect(await resolveDefaultBranch('/r')).toBe('main');

    mockRaw.mockRejectedValueOnce(new Error('no HEAD'));
    mockRaw.mockRejectedValueOnce(new Error('fatal: Needed a single revision')); // no main
    mockRaw.mockResolvedValueOnce('def456\n'); // master ok
    expect(await resolveDefaultBranch('/r')).toBe('master');

    mockRaw.mockRejectedValueOnce(new Error('no HEAD'));
    mockRaw.mockRejectedValueOnce(new Error('no main'));
    mockRaw.mockRejectedValueOnce(new Error('no master'));
    expect(await resolveDefaultBranch('/r')).toBeNull();
  });

  it('does not trust a rev-parse call that resolves with empty stdout (simple-git quirk under --quiet)', async () => {
    // Regression: `git rev-parse --verify --quiet <missing-ref>` exits non-zero with empty
    // stderr, and simple-git's error detection (`exitCode && stdErr.length`) treats that as a
    // *resolved* promise with empty stdout rather than a rejection. A missing `main` must still
    // fall through to `master`, not be mistaken for a match.
    mockRaw.mockRejectedValueOnce(new Error('no HEAD')); // no origin/HEAD
    mockRaw.mockResolvedValueOnce(''); // rev-parse --verify main "succeeds" with empty stdout
    mockRaw.mockResolvedValueOnce('def456\n'); // master ok
    expect(await resolveDefaultBranch('/r')).toBe('master');
  });
});

describe('runPrProxy', () => {
  beforeEach(() => vi.resetAllMocks());

  it('attributes merges to the second-parent author, sizes exclude ignored files, skips direct pushes', async () => {
    mockRaw
      .mockResolvedValueOnce('origin/main\n') // symbolic-ref
      .mockResolvedValueOnce('1234567890abcdef1234567890abcdef12345678\n') // rev-parse main^{commit}
      .mockResolvedValueOnce(LOG) // first-parent log
      .mockResolvedValueOnce(`${H('p2', 'alice@co.com', 'Alice')}\n`); // batched tip lookup for p2

    const result = await runPrProxy({
      repoPath: '/r',
      repoName: 'web',
      group: 'default',
      authorMap: authorMap(),
      recentPrHashes: new Set(),
      shouldIgnore: (p) => p.endsWith('package-lock.json'),
    });

    expect(result.branch).toBe('main');
    expect(result.prCount).toBe(2);
    expect(result.newPrHashes).toEqual(['aaaaaa1', 'bbbbbb2', 'cccccc3']);
    expect(result.records).toHaveLength(1); // both PRs are Alice, 2026-W08, web
    const rec = result.records[0];
    expect(rec.member).toBe('Alice');
    expect(rec.week).toBe('2026-W08');
    expect(rec.commits).toBe(0);
    expect(rec.prsMergedGit).toBe(2);
    expect(rec.prSizes).toEqual([120, 30]);
    // the tip lookup was batched with --no-walk
    expect(mockRaw.mock.calls[3][0]).toEqual(expect.arrayContaining(['log', '--no-walk', 'p2']));
  });

  it('skips hashes already in recentPrHashes and passes --since', async () => {
    mockRaw
      .mockResolvedValueOnce('origin/main\n')
      .mockResolvedValueOnce('1234567890abcdef1234567890abcdef12345678\n')
      .mockResolvedValueOnce(LOG)
      .mockResolvedValueOnce(`${H('p2', 'alice@co.com', 'Alice')}\n`);
    const result = await runPrProxy({
      repoPath: '/r',
      repoName: 'web',
      group: 'default',
      authorMap: authorMap(),
      recentPrHashes: new Set(['aaaaaa1']),
      since: '2026-02-01',
      shouldIgnore: () => false,
    });
    expect(result.prCount).toBe(1);
    expect(result.newPrHashes).toEqual(['bbbbbb2', 'cccccc3']);
    expect(mockRaw.mock.calls[2][0]).toEqual(expect.arrayContaining(['--since=2026-02-01']));
  });

  it('returns an empty result with branch null when no default branch exists', async () => {
    mockRaw.mockRejectedValue(new Error('nope'));
    const result = await runPrProxy({
      repoPath: '/r',
      repoName: 'web',
      group: 'default',
      authorMap: authorMap(),
      recentPrHashes: new Set(),
      shouldIgnore: () => false,
    });
    expect(result).toEqual({ records: [], newPrHashes: [], prCount: 0, branch: null });
  });

  it('walks only commits reachable from the tip but not from sinceRef, and reports the tip (#79)', async () => {
    const sha = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    mockRaw
      .mockResolvedValueOnce('origin/main\n') // symbolic-ref
      .mockResolvedValueOnce(`${sha}\n`) // rev-parse
      .mockResolvedValueOnce('') // merge-base --is-ancestor: exit 0
      .mockResolvedValueOnce(LOG) // first-parent log
      .mockResolvedValueOnce(`${H('p2', 'alice@co.com', 'Alice')}\n`);
    const result = await runPrProxy({
      repoPath: '/r',
      repoName: 'web',
      group: 'default',
      authorMap: authorMap(),
      recentPrHashes: new Set(),
      sinceRef: 'cccccccccccccccccccccccccccccccccccccccc',
      shouldIgnore: () => false,
    });
    expect(mockRaw.mock.calls[2][0]).toEqual([
      'merge-base',
      '--is-ancestor',
      'cccccccccccccccccccccccccccccccccccccccc',
      sha,
    ]);
    const log = mockRaw.mock.calls[3][0] as string[];
    expect(log.slice(-3)).toEqual([
      '--end-of-options',
      sha,
      '^cccccccccccccccccccccccccccccccccccccccc',
    ]);
    expect(log.some((a) => a.startsWith('--since='))).toBe(false);
    expect(result.tip).toBe(sha);
  });

  it('re-walks the whole first-parent line when sinceRef is not an ancestor of the tip (#79)', async () => {
    const sha = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    mockRaw
      .mockResolvedValueOnce('origin/main\n')
      .mockResolvedValueOnce(`${sha}\n`)
      .mockRejectedValueOnce(new Error('exit 1')) // not an ancestor
      .mockResolvedValueOnce(LOG)
      .mockResolvedValueOnce(`${H('p2', 'alice@co.com', 'Alice')}\n`);
    const result = await runPrProxy({
      repoPath: '/r',
      repoName: 'web',
      group: 'default',
      authorMap: authorMap(),
      recentPrHashes: new Set(['aaaaaa1']),
      sinceRef: 'cccccccccccccccccccccccccccccccccccccccc',
      shouldIgnore: () => false,
    });
    const log = mockRaw.mock.calls[3][0] as string[];
    expect(log.slice(-2)).toEqual(['--end-of-options', sha]);
    expect(result.prCount).toBe(1); // aaaaaa1 deduped by hash
    expect(result.tip).toBe(sha);
  });

  it('resolves the branch to a SHA and puts --end-of-options before every revision (#71)', async () => {
    const sha = '1234567890abcdef1234567890abcdef12345678';
    mockRaw
      .mockResolvedValueOnce('origin/main\n') // symbolic-ref
      .mockResolvedValueOnce(`${sha}\n`) // rev-parse
      .mockResolvedValueOnce(LOG) // first-parent log
      .mockResolvedValueOnce(`${H('p2', 'alice@co.com', 'Alice')}\n`); // tip lookup
    await runPrProxy({
      repoPath: '/r',
      repoName: 'web',
      group: 'default',
      authorMap: authorMap(),
      recentPrHashes: new Set(),
      since: '2026-02-01',
      shouldIgnore: () => false,
    });

    const revParse = mockRaw.mock.calls[1][0] as string[];
    expect(revParse.slice(0, 3)).toEqual(['rev-parse', '--verify', '--end-of-options']);
    expect(revParse[3]).toBe('main^{commit}');

    const log = mockRaw.mock.calls[2][0] as string[];
    expect(log).toContain('--format=%x00%H%x00%P%x00%ae%x00%an%x00%aI%x00%s'); // NUL-delimited (#70)
    expect(log).not.toContain('main');
    expect(log.indexOf('--end-of-options')).toBeGreaterThan(-1);
    expect(log.indexOf('--end-of-options')).toBe(log.length - 2);
    expect(log[log.length - 1]).toBe(sha);
    expect(log.indexOf('--since=2026-02-01')).toBeLessThan(log.indexOf('--end-of-options'));

    const tips = mockRaw.mock.calls[3][0] as string[];
    expect(tips.indexOf('--end-of-options')).toBeLessThan(tips.indexOf('p2'));
  });

  it('refuses an option-like default branch with a warning and never runs git log (#71)', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockRaw
      .mockResolvedValueOnce('origin/--output=/tmp/pwned\n') // hostile origin/HEAD
      .mockRejectedValueOnce(new Error('no main'))
      .mockRejectedValueOnce(new Error('no master'));
    const result = await runPrProxy({
      repoPath: '/r',
      repoName: 'web',
      group: 'default',
      authorMap: authorMap(),
      recentPrHashes: new Set(),
      shouldIgnore: () => false,
    });
    expect(result).toEqual({ records: [], newPrHashes: [], prCount: 0, branch: null });
    expect(mockRaw.mock.calls.map((c) => (c[0] as string[])[0])).not.toContain('log');
    expect(log.mock.calls.flat().join('\n')).toMatch(/--output=\/tmp\/pwned/);
    log.mockRestore();
  });

  it('skips the repo with a warning when the branch does not resolve to a 40-hex SHA (#71)', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockRaw.mockResolvedValueOnce('origin/main\n').mockResolvedValueOnce('not-a-sha\n');
    const result = await runPrProxy({
      repoPath: '/r',
      repoName: 'web',
      group: 'default',
      authorMap: authorMap(),
      recentPrHashes: new Set(),
      shouldIgnore: () => false,
    });
    expect(result).toEqual({ records: [], newPrHashes: [], prCount: 0, branch: 'main' });
    expect(mockRaw.mock.calls.map((c) => (c[0] as string[])[0])).not.toContain('log');
    log.mockRestore();
  });
});
