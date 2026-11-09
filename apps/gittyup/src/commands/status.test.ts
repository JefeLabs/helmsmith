import { describe, expect, it } from 'vitest';
import type { RepoState } from '../config/schema.js';
import { toStatusDocument } from './status.js';

const SHA = `0123abcd${'0'.repeat(32)}`;

const healthy: RepoState = {
  name: 'app',
  group: 'web',
  path: '/w/app',
  currentBranch: 'main',
  hasUnresolved: false,
  branches: {
    dev: {
      branch: 'develop',
      ahead: null,
      behind: null,
      tracking: false,
      trackingBranch: 'origin/develop',
      hasConflicts: false,
      isDirty: false,
      lastCommit: '0123abcd',
      lastCommitSha: SHA,
      lastCommitDate: '2026-01-01T00:00:00Z',
    },
  },
};

const gone: RepoState = {
  name: 'gone',
  group: 'web',
  path: '/nope',
  currentBranch: 'error',
  branches: {},
  hasUnresolved: false,
  error: 'Repo path not found: /nope (gone)',
};

const ctx = {
  manifest: { path: '/w/gittyup.yaml', exists: true },
  fetch: null,
  now: new Date('2026-11-07T00:00:00Z'),
};

describe('toStatusDocument', () => {
  it('maps branch state honestly and nulls what is unknown', () => {
    expect(toStatusDocument([healthy, gone], ctx)).toStrictEqual({
      generatedAt: '2026-11-07T00:00:00.000Z',
      manifest: { path: '/w/gittyup.yaml', exists: true },
      fetch: null,
      repos: [
        {
          name: 'app',
          group: 'web',
          path: '/w/app',
          currentBranch: 'main',
          hasUnresolved: false,
          branches: {
            dev: {
              branch: 'develop',
              trackingBranch: 'origin/develop',
              tracking: false,
              ahead: null,
              behind: null,
              isDirty: false,
              hasConflicts: false,
              lastCommit: { sha: SHA, date: '2026-01-01T00:00:00Z' },
            },
          },
        },
        {
          name: 'gone',
          group: 'web',
          path: '/nope',
          currentBranch: null,
          hasUnresolved: false,
          error: 'Repo path not found: /nope (gone)',
          branches: {},
        },
      ],
      summary: { repos: 2, withConflicts: 0, withErrors: 1 },
    });
  });

  it('reports an unreadable branch as an error with unknowns null, not false', () => {
    const unreadable: RepoState = {
      ...healthy,
      branches: {
        staging: {
          branch: 'staging',
          ahead: null,
          behind: null,
          tracking: false,
          hasConflicts: false,
          isDirty: false,
          lastCommit: 'error',
          lastCommitSha: null,
          lastCommitDate: 'error',
          error: "fatal: ambiguous argument 'staging': unknown revision",
        },
      },
    };

    const row = toStatusDocument([unreadable], ctx).repos[0]?.branches.staging;

    expect(row).toStrictEqual({
      branch: 'staging',
      trackingBranch: null,
      tracking: false,
      ahead: null,
      behind: null,
      isDirty: null,
      hasConflicts: null,
      lastCommit: null,
      error: "fatal: ambiguous argument 'staging': unknown revision",
    });
  });

  it('reports fetch outcomes as ok/error rows', () => {
    const doc = toStatusDocument([], {
      ...ctx,
      fetch: [
        { repo: 'app', success: false, error: 'boom' },
        { repo: 'x', success: true },
      ],
    });
    expect(doc.fetch).toStrictEqual([
      { repo: 'app', ok: false, error: 'boom' },
      { repo: 'x', ok: true },
    ]);
  });
});
