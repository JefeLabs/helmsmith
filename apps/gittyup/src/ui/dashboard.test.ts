/**
 * The dashboard tables must not leak colour codes into a pipe (`gittyup status | …`):
 * chalk already turns itself off when stdout is not a terminal, but cli-table3 colours
 * headers red and borders grey on its own unless its `style` says otherwise.
 */
import chalk, { type ColorSupportLevel } from 'chalk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RepoBranchState, RepoState } from '../config/schema.js';
import { branchStatusCell, Dashboard } from './dashboard.js';

let printed: string[];
let savedLevel: ColorSupportLevel;

beforeEach(() => {
  printed = [];
  savedLevel = chalk.level;
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    printed.push(args.join(' '));
  });
});

afterEach(() => {
  chalk.level = savedLevel;
  vi.restoreAllMocks();
});

const state: RepoState = {
  name: 'app',
  group: 'web',
  path: '/w/app',
  currentBranch: 'main',
  hasUnresolved: false,
  branches: {
    dev: {
      branch: 'develop',
      ahead: 0,
      behind: 0,
      hasConflicts: false,
      isDirty: false,
      lastCommit: '0123abcd',
      lastCommitDate: '2026-01-01T00:00:00Z',
    },
  },
};

const ESC = '\x1b';

describe('Dashboard tables in a pipe (no colour)', () => {
  it('the status table prints no escape codes', () => {
    chalk.level = 0;

    Dashboard.render([state]);

    expect(printed.join('\n')).not.toContain(ESC);
  });

  it('the operation results table prints no escape codes', () => {
    chalk.level = 0;

    Dashboard.renderOperationResults([{ repo: 'app', status: 'success', message: 'ok' }], 'Merge');

    expect(printed.join('\n')).not.toContain(ESC);
  });
});

describe('branchStatusCell', () => {
  const inSync: RepoBranchState = {
    branch: 'main',
    ahead: 0,
    behind: 0,
    tracking: true,
    local: true,
    hasConflicts: false,
    isDirty: false,
    lastCommit: '0123abcd',
    lastCommitSha: `0123abcd${'0'.repeat(32)}`,
    lastCommitDate: '2026-01-01T00:00:00Z',
    trackingBranch: 'origin/main',
  };

  it('never shows ✓ for a branch that could not be read', () => {
    chalk.level = 0;
    const unreadable: RepoBranchState = {
      ...inSync,
      branch: 'develop',
      ahead: null,
      behind: null,
      tracking: false,
      local: false,
      lastCommit: 'error',
      lastCommitSha: null,
      lastCommitDate: 'error',
      trackingBranch: 'origin/develop',
      error: "no branch 'develop' locally or at origin/develop",
    };

    expect(branchStatusCell(unreadable)).not.toContain('✓');
  });

  it('tells a remote-only branch apart from a local one that is in sync', () => {
    chalk.level = 0;
    const remoteOnly: RepoBranchState = {
      ...inSync,
      branch: 'staging',
      ahead: null,
      behind: null,
      local: false,
      trackingBranch: 'origin/staging',
    };

    expect(branchStatusCell(remoteOnly)).not.toBe(branchStatusCell(inSync));
  });
});

describe('Dashboard rows for unreadable branches', () => {
  it('shows no "error" placeholder in the Last Commit column', () => {
    chalk.level = 0;
    const s: RepoState = {
      ...state,
      branches: {
        dev: {
          ...state.branches.dev,
          local: false,
          tracking: false,
          lastCommit: 'error',
          lastCommitSha: null,
          lastCommitDate: 'error',
          error: "no branch 'develop' locally or at origin/develop",
        },
      },
    };

    Dashboard.render([s]);

    const row = printed
      .join('\n')
      .split('\n')
      .find((l) => l.includes('dev (develop)'));
    expect(row).toBeDefined();
    expect(row).not.toMatch(/│\s*error\s*$/);
  });
});

describe('Dashboard tables on a terminal', () => {
  it('draws headers dim, as written, not in the table library’s default red', () => {
    chalk.level = 1;

    Dashboard.renderOperationResults([{ repo: 'app', status: 'success', message: 'ok' }], 'Merge');

    const text = printed.join('\n');
    expect(text).toContain(`${ESC}[2mRepo`);
    expect(text).not.toContain(`${ESC}[31m`);
  });
});
