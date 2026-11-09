import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CompareRow } from '../config/index.js';

// lookupPrs talks to GitHub through GitHubClient; fake the client, keep the logic real.
const gh = {
  getRepoOwner: vi.fn(),
  findExistingPR: vi.fn(),
};
vi.mock('../github/index.js', () => ({
  GitHubClient: { create: vi.fn(async () => gh) },
}));

const { lookupPrs, toCompareDocument } = await import('./compare.js');

const side = { lastCommitDate: '2026-11-01T00:00:00Z', author: 'a', sinceDays: 6, commitCount: 3 };
function row(name: string, over: Partial<CompareRow> = {}): CompareRow {
  return {
    repo: {
      name,
      group: 'web',
      path: `/w/${name}`,
      remote: 'origin',
      url: `https://github.com/acme/${name}`,
      branches: {},
      tags: [],
    } as CompareRow['repo'],
    hasConflicts: false,
    left: side,
    right: side,
    pr: null,
    ...over,
  };
}
const ctx = {
  left: 'dev',
  right: 'prod',
  checkConflicts: true,
  cache: { hit: false, ageMs: null },
  prLookup: { ran: true },
  prs: undefined,
};

describe('toCompareDocument: hasConflicts is only a boolean when the check ran', () => {
  it('is null, and not counted clean, when one side of the comparison is missing', () => {
    const doc = toCompareDocument([row('api', { right: null })], ctx);

    expect(doc.repos[0]?.hasConflicts).toBeNull();
    expect(doc.summary.clean).toBe(0);
  });

  it('is null on a row that failed to compare', () => {
    const doc = toCompareDocument([row('api', { left: null, right: null, error: 'boom' })], ctx);

    expect(doc.repos[0]?.hasConflicts).toBeNull();
  });

  it('stays false, and counts clean, when both sides exist and the check found nothing', () => {
    const doc = toCompareDocument([row('api')], ctx);

    expect(doc.repos[0]?.hasConflicts).toBe(false);
    expect(doc.summary.clean).toBe(1);
  });
});

describe('PR lookup failures are reported per repo, not read as "no PR"', () => {
  beforeEach(() => {
    gh.getRepoOwner.mockReset();
    gh.findExistingPR.mockReset();
  });

  it('lookupPrs returns the failing repo and its error', async () => {
    gh.getRepoOwner.mockImplementation(async (url: string) => ({
      owner: 'acme',
      repo: url.split('/').pop(),
    }));
    gh.findExistingPR.mockImplementation(async (_o: string, repo: string) => {
      if (repo === 'web') throw new Error('Bad credentials');
      return null;
    });

    const out = await lookupPrs([row('api'), row('web')], 'dev', 'prod');

    expect(out.errors.get('web')).toBe('Bad credentials');
    expect(out.errors.has('api')).toBe(false);
  });

  it('toCompareDocument puts the repo’s prError next to pr: null', () => {
    const doc = toCompareDocument([row('api'), row('web')], {
      ...ctx,
      prs: new Map(),
      prErrors: new Map([['web', 'Bad credentials']]),
    });

    expect(doc.repos[1]).toMatchObject({ name: 'web', pr: null, prError: 'Bad credentials' });
    expect(doc.repos[0]).not.toHaveProperty('prError');
  });
});
