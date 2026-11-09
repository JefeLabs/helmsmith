/**
 * The dashboard tables must not leak colour codes into a pipe (`gittyup status | …`):
 * chalk already turns itself off when stdout is not a terminal, but cli-table3 colours
 * headers red and borders grey on its own unless its `style` says otherwise.
 */
import chalk, { type ColorSupportLevel } from 'chalk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RepoState } from '../config/schema.js';
import { Dashboard } from './dashboard.js';

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

describe('Dashboard tables on a terminal', () => {
  it('draws headers dim, as written, not in the table library’s default red', () => {
    chalk.level = 1;

    Dashboard.renderOperationResults([{ repo: 'app', status: 'success', message: 'ok' }], 'Merge');

    const text = printed.join('\n');
    expect(text).toContain(`${ESC}[2mRepo`);
    expect(text).not.toContain(`${ESC}[31m`);
  });
});
