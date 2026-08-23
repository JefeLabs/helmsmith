/**
 * Manage → Export → Data (CSV) in the TUI must produce the same file as
 * `gitradar data export-csv`: bots excluded and the configured segment_min_n
 * applied.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Config, UserWeekRepoRecord } from '../types/schema.js';
import { DEFAULT_SETTINGS } from '../types/schema.js';
import type { KeyEvent } from '../ui/keypress.js';
import type { ViewContext } from '../views/types.js';

vi.mock('../ui/keypress.js', () => ({
  readKey: vi.fn(),
  readKeyWithTimeout: vi.fn(),
}));

vi.mock('../ui/readline.js', () => ({
  readLine: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  writeFile: vi.fn(async () => {}),
}));

const { readKey } = await import('../ui/keypress.js');
const { readLine } = await import('../ui/readline.js');
const { writeFile } = await import('node:fs/promises');
const mockedReadKey = vi.mocked(readKey);
const mockedReadLine = vi.mocked(readLine);
const mockedWriteFile = vi.mocked(writeFile);

function key(name: string): KeyEvent {
  return { raw: name, name, ctrl: false };
}

function makeRecord(overrides: Partial<UserWeekRepoRecord> = {}): UserWeekRepoRecord {
  return {
    member: 'alice',
    email: 'alice@example.com',
    org: 'Acme',
    orgType: 'core',
    team: 'Platform',
    tag: 'default',
    week: '2026-W10',
    repo: 'web',
    group: 'default',
    commits: 3,
    activeDays: 2,
    filetype: {
      app: { files: 2, filesAdded: 0, filesDeleted: 0, insertions: 80, deletions: 20 },
      test: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
      config: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
      storybook: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
      doc: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
    },
    ...overrides,
  };
}

function makeConfig(settings: Partial<Config['settings']> = {}): Config {
  return {
    repos: [{ path: '~/code/web', name: 'web', group: 'default' }],
    orgs: [
      {
        name: 'Acme',
        type: 'core',
        teams: [{ name: 'Platform', tag: 'default', members: [] }],
      },
    ],
    groups: {},
    tags: {},
    settings: { ...DEFAULT_SETTINGS, ...settings },
  };
}

/** Ten real contributors (so a cohort of 10 clears the default min-N of 8). */
function cohort(): UserWeekRepoRecord[] {
  return Array.from({ length: 10 }, (_, i) =>
    makeRecord({
      member: `mem${String(i).padStart(2, '0')}`,
      email: `mem${i}@example.com`,
      filetype: {
        app: {
          files: 1,
          filesAdded: 0,
          filesDeleted: 0,
          insertions: (10 - i) * 100,
          deletions: 0,
        },
        test: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
        config: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
        storybook: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
        doc: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
      },
    }),
  );
}

/** Drive the TUI: Manage tab → Export → Data (CSV) → path → dismiss → quit. */
async function runCsvExport(ctx: ViewContext): Promise<string> {
  const { dashboardView } = await import('../views/dashboard.js');
  mockedReadKey
    .mockResolvedValueOnce(key('m')) // → Manage tab
    .mockResolvedValueOnce(key('e')) // → Export menu
    .mockResolvedValueOnce(key('1')) // → Data (CSV)
    .mockResolvedValueOnce(key('return')) // dismiss "press any key"
    .mockResolvedValueOnce(key('q')); // quit
  mockedReadLine.mockResolvedValueOnce('/tmp/gitradar-tui-export.csv');

  const result = await dashboardView(ctx);
  expect(result).toEqual({ type: 'quit' });
  expect(mockedWriteFile).toHaveBeenCalledTimes(1);
  return mockedWriteFile.mock.calls[0][1] as string;
}

describe('TUI Manage → Export → Data (CSV)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    Object.defineProperty(process.stdout, 'rows', { value: 50, configurable: true });
    Object.defineProperty(process.stdout, 'columns', { value: 120, configurable: true });
  });

  it('excludes bot authors named by bot_patterns', async () => {
    const records = [
      ...cohort(),
      makeRecord({ member: 'dependabot[bot]', email: 'noreply@github.com' }),
    ];
    const csv = await runCsvExport({
      config: makeConfig({ bot_patterns: ['dependabot'] }),
      records,
      currentWeek: '2026-W10',
    });

    expect(csv).toContain('mem00');
    expect(csv).not.toContain('dependabot');
  });

  it('honours the configured segment_min_n', async () => {
    // A cohort of 10 clears the default min-N of 8 and would be labelled, but
    // segment_min_n: 20 must suppress every high/low label.
    const csv = await runCsvExport({
      config: makeConfig({ segment_min_n: 20 }),
      records: cohort(),
      currentWeek: '2026-W10',
    });

    const segments = csv
      .trim()
      .split('\n')
      .slice(1)
      .map((line) => line.split(',').pop());
    expect(new Set(segments)).toEqual(new Set(['middle']));
  });

  it('labels segments when the cohort clears the default min-N', async () => {
    const csv = await runCsvExport({
      config: makeConfig(),
      records: cohort(),
      currentWeek: '2026-W10',
    });

    const segments = csv
      .trim()
      .split('\n')
      .slice(1)
      .map((line) => line.split(',').pop());
    expect(new Set(segments)).toEqual(new Set(['high', 'middle', 'low']));
  });
});
