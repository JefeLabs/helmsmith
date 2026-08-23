import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthorMap } from '../collector/author-map.js';

const mockRaw = vi.fn();
vi.mock('simple-git', () => {
  const factory = vi.fn(() => ({ raw: mockRaw }));
  return { default: factory, simpleGit: factory };
});

const { parseDeletedHunks, parseBlamePorcelain, runRework } = await import(
  '../collector/rework.js'
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

const DIFF = [
  'diff --git a/src/a.ts b/src/a.ts',
  'index 1..2 100644',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -10,3 +10,0 @@ function x() {',
  '-old1',
  '-old2',
  '-old3',
  '@@ -20 +17 @@',
  '-old4',
  '+new4',
  'diff --git a/img.png b/img.png',
  'Binary files a/img.png and b/img.png differ',
  'diff --git a/src/b.ts b/src/b.ts',
  '--- a/src/b.ts',
  '+++ b/src/b.ts',
  '@@ -0,0 +1,2 @@',
  '+added',
  '+added2',
].join('\n');

describe('parseDeletedHunks', () => {
  it('collects deleted ranges per file, ignoring add-only hunks and binaries', () => {
    const hunks = parseDeletedHunks(DIFF);
    expect(hunks.get('src/a.ts')).toEqual([
      { start: 10, count: 3 },
      { start: 20, count: 1 },
    ]);
    expect(hunks.has('src/b.ts')).toBe(false);
    expect(hunks.has('img.png')).toBe(false);
  });
});

describe('parseBlamePorcelain', () => {
  it('yields one {email,name,time} per blamed line', () => {
    const out = [
      'abc123 10 10 2',
      'author Alice',
      'author-mail <alice@co.com>',
      'author-time 1700000000',
      'author-tz +0000',
      '\told1',
      'abc123 11 11',
      '\told2',
      'def456 12 12 1',
      'author Bob',
      'author-mail <bob@co.com>',
      'author-time 1600000000',
      '\told3',
    ].join('\n');
    expect(parseBlamePorcelain(out)).toEqual([
      { email: 'alice@co.com', name: 'Alice', time: 1700000000 },
      { email: 'alice@co.com', name: 'Alice', time: 1700000000 },
      { email: 'bob@co.com', name: 'Bob', time: 1600000000 },
    ]);
  });
});

describe('runRework', () => {
  beforeEach(() => mockRaw.mockReset());

  it('attributes recently-written deleted lines to their original author in the deletion week', async () => {
    const commitTime = Date.parse('2026-02-18T10:00:00Z') / 1000;
    const recent = commitTime - 5 * 86400; // 5 days old → rework
    const old = commitTime - 40 * 86400; // 40 days old → not rework
    mockRaw
      .mockResolvedValueOnce(DIFF) // git diff for C
      .mockResolvedValueOnce(
        [
          // blame src/a.ts lines 10-12 + 20
          'h 10 10 3',
          'author Alice',
          'author-mail <alice@co.com>',
          `author-time ${recent}`,
          '\tl',
          'h 11 11',
          '\tl',
          'h 12 12',
          '\tl',
          'g 20 20 1',
          'author Bob',
          'author-mail <bob@co.com>',
          `author-time ${old}`,
          '\tl',
        ].join('\n'),
      );

    const result = await runRework(
      [
        {
          hash: 'c1',
          authorEmail: 'bob@co.com',
          authorName: 'Bob',
          authorDate: '2026-02-18T10:00:00Z',
          week: '2026-W08',
          files: [
            { path: 'src/a.ts', deletions: 4 },
            { path: 'src/b.ts', deletions: 0 },
          ],
        },
      ],
      {
        repoPath: '/r',
        repoName: 'web',
        group: 'default',
        authorMap: authorMap(),
        windowDays: 21,
        concurrency: 2,
      },
    );

    expect(result.commitsProcessed).toBe(1);
    expect(result.blames).toBe(1);
    expect(result.records).toHaveLength(1);
    const alice = result.records[0];
    expect(alice.member).toBe('Alice');
    expect(alice.week).toBe('2026-W08');
    expect(alice.commits).toBe(0);
    expect(alice.reworkLines).toBe(3);
    expect(alice.reworkSelfLines).toBe(0); // Bob deleted Alice's lines
    expect(mockRaw.mock.calls[0][0]).toEqual(
      expect.arrayContaining(['diff', '-U0', 'c1^', 'c1', '--', 'src/a.ts']),
    );
    expect(mockRaw.mock.calls[1][0]).toEqual(
      expect.arrayContaining([
        'blame',
        '--porcelain',
        '-w',
        '-L',
        '10,12',
        '-L',
        '20,20',
        'c1^',
        '--',
        'src/a.ts',
      ]),
    );
  });

  it('counts self-rework when the deleter is the original author', async () => {
    const t = Date.parse('2026-02-18T10:00:00Z') / 1000 - 86400;
    mockRaw
      .mockResolvedValueOnce('diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1,2 +0,0 @@\n-a\n-b\n')
      .mockResolvedValueOnce(
        [
          'h 1 1 2',
          'author Alice',
          'author-mail <alice@co.com>',
          `author-time ${t}`,
          '\ta',
          'h 2 2',
          '\tb',
        ].join('\n'),
      );
    const result = await runRework(
      [
        {
          hash: 'c2',
          authorEmail: 'alice@co.com',
          authorName: 'Alice',
          authorDate: '2026-02-18T10:00:00Z',
          week: '2026-W08',
          files: [{ path: 'x', deletions: 2 }],
        },
      ],
      {
        repoPath: '/r',
        repoName: 'web',
        group: 'default',
        authorMap: authorMap(),
        windowDays: 21,
        concurrency: 1,
      },
    );
    expect(result.records[0].reworkLines).toBe(2);
    expect(result.records[0].reworkSelfLines).toBe(2);
  });

  it('skips commits with no deleting files and tolerates blame failures', async () => {
    mockRaw
      .mockResolvedValueOnce('diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +0,0 @@\n-a\n')
      .mockRejectedValueOnce(new Error('fatal: no such path'));
    const result = await runRework(
      [
        {
          hash: 'c3',
          authorEmail: 'a@x',
          authorName: 'A',
          authorDate: '2026-02-18T10:00:00Z',
          week: '2026-W08',
          files: [],
        },
        {
          hash: 'c4',
          authorEmail: 'a@x',
          authorName: 'A',
          authorDate: '2026-02-18T10:00:00Z',
          week: '2026-W08',
          files: [{ path: 'x', deletions: 1 }],
        },
      ],
      {
        repoPath: '/r',
        repoName: 'web',
        group: 'default',
        authorMap: authorMap(),
        windowDays: 21,
        concurrency: 1,
      },
    );
    expect(result.commitsProcessed).toBe(1);
    expect(result.records).toEqual([]);
  });
});
