import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DEFAULT_SETTINGS } from '../types/schema.js';
import type { Config, UserWeekRepoRecord } from '../types/schema.js';
import type { ViewContext, NavigationAction, ViewFn } from '../views/types.js';
import { computeWeeksToShow } from '../views/dashboard.js';
import type { KeyEvent } from '../ui/keypress.js';

// ── Mock readKey (replaces @inquirer/prompts select) ────────────────────────
vi.mock('../ui/keypress.js', () => ({
  readKey: vi.fn(),
}));

import { readKey } from '../ui/keypress.js';
const mockedReadKey = vi.mocked(readKey);

/** Helper: create a KeyEvent for a named key */
function key(name: string, ctrl = false): KeyEvent {
  return { raw: name, name, ctrl };
}

// ── Sample Data ─────────────────────────────────────────────────────────────

function makeRecord(overrides: Partial<UserWeekRepoRecord> = {}): UserWeekRepoRecord {
  return {
    member: 'Alice Chen',
    email: 'alice@company.com',
    org: 'Team A',
    orgType: 'core',
    team: 'Platform',
    tag: 'infrastructure',
    week: '2026-W10',
    repo: 'frontend-app',
    group: 'web',
    commits: 10,
    activeDays: 4,
    filetype: {
      app: { files: 5, filesAdded: 0, filesDeleted: 0, insertions: 200, deletions: 50 },
      test: { files: 3, filesAdded: 0, filesDeleted: 0, insertions: 100, deletions: 30 },
      config: { files: 1, filesAdded: 0, filesDeleted: 0, insertions: 20, deletions: 5 },
      storybook: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
      doc: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 },
    },
    ...overrides,
  };
}

function makeSampleConfig(): Config {
  return {
    repos: [
      { path: '~/code/frontend-app', name: 'frontend-app', group: 'web' },
      { path: '~/code/api-server', name: 'api-server', group: 'backend' },
    ],
    orgs: [
      {
        name: 'Team A',
        type: 'core',
        teams: [
          {
            name: 'Platform',
            tag: 'infrastructure',
            members: [
              { name: 'Alice Chen', email: 'alice@company.com', aliases: [] },
              { name: 'Bob Kumar', email: 'bob@company.com', aliases: [] },
            ],
          },
          {
            name: 'Product',
            tag: 'feature',
            members: [
              { name: 'Eva Jones', email: 'eva@company.com', aliases: [] },
            ],
          },
        ],
      },
      {
        name: 'Team B',
        type: 'consultant',
        teams: [
          {
            name: 'Frontend Squad',
            tag: 'feature',
            members: [
              { name: 'Leo Garcia', email: 'leo@consultant.com', aliases: [] },
            ],
          },
        ],
      },
    ],
    groups: {
      web: { label: 'Web' },
      backend: { label: 'Backend' },
    },
    tags: {
      infrastructure: { label: 'Infra' },
      feature: { label: 'Feature' },
    },
    settings: { ...DEFAULT_SETTINGS },
  };
}

function makeSampleRecords(): UserWeekRepoRecord[] {
  const weeks = ['2026-W08', '2026-W09', '2026-W10', '2026-W11', '2026-W12'];
  const records: UserWeekRepoRecord[] = [];

  for (const week of weeks) {
    // Alice - Platform
    records.push(makeRecord({ member: 'Alice Chen', team: 'Platform', org: 'Team A', orgType: 'core', tag: 'infrastructure', week, repo: 'frontend-app', commits: 10 + Math.floor(Math.random() * 5) }));
    records.push(makeRecord({ member: 'Alice Chen', team: 'Platform', org: 'Team A', orgType: 'core', tag: 'infrastructure', week, repo: 'api-server', group: 'backend', commits: 5 }));

    // Bob - Platform
    records.push(makeRecord({ member: 'Bob Kumar', email: 'bob@company.com', team: 'Platform', org: 'Team A', orgType: 'core', tag: 'infrastructure', week, repo: 'api-server', group: 'backend', commits: 8 }));

    // Eva - Product
    records.push(makeRecord({ member: 'Eva Jones', email: 'eva@company.com', team: 'Product', org: 'Team A', orgType: 'core', tag: 'feature', week, repo: 'frontend-app', commits: 12, filetype: { app: { files: 8, filesAdded: 0, filesDeleted: 0, insertions: 300, deletions: 80 }, test: { files: 4, filesAdded: 0, filesDeleted: 0, insertions: 120, deletions: 40 }, config: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 }, storybook: { files: 1, filesAdded: 0, filesDeleted: 0, insertions: 30, deletions: 10 }, doc: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 } } }));

    // Leo - Frontend Squad
    records.push(makeRecord({ member: 'Leo Garcia', email: 'leo@consultant.com', team: 'Frontend Squad', org: 'Team B', orgType: 'consultant', tag: 'feature', week, repo: 'frontend-app', commits: 6, filetype: { app: { files: 4, filesAdded: 0, filesDeleted: 0, insertions: 150, deletions: 40 }, test: { files: 2, filesAdded: 0, filesDeleted: 0, insertions: 60, deletions: 20 }, config: { files: 1, filesAdded: 0, filesDeleted: 0, insertions: 10, deletions: 5 }, storybook: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 }, doc: { files: 0, filesAdded: 0, filesDeleted: 0, insertions: 0, deletions: 0 } } }));
  }

  return records;
}

function makeSampleContext(): ViewContext {
  return {
    config: makeSampleConfig(),
    records: makeSampleRecords(),
    currentWeek: '2026-W12',
  };
}

// ── Utility to suppress screen clear and console.log in tests ───────────────
let screenClearCount: number;
let stdoutWriteSpy: ReturnType<typeof vi.spyOn>;
let consoleLogSpy: ReturnType<typeof vi.spyOn>;

const CLEAR_SEQ = '\x1B[2J\x1B[3J\x1B[H';

beforeEach(() => {
  screenClearCount = 0;
  stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation((data: any) => {
    if (typeof data === 'string' && data.includes(CLEAR_SEQ)) {
      screenClearCount++;
    }
    return true;
  });
  consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  // Set terminal size for consistency
  Object.defineProperty(process.stdout, 'rows', { value: 50, configurable: true });
  Object.defineProperty(process.stdout, 'columns', { value: 120, configurable: true });
});

afterEach(() => {
  stdoutWriteSpy.mockRestore();
  consoleLogSpy.mockRestore();
  vi.restoreAllMocks();
});

// ═══════════════════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════════════════

describe('computeWeeksToShow', () => {
  it('returns 2 for very small terminals', () => {
    expect(computeWeeksToShow(32, 2)).toBe(2);
  });

  it('returns 4 for large terminals', () => {
    expect(computeWeeksToShow(80, 2)).toBe(4);
  });

  it('caps at 4', () => {
    expect(computeWeeksToShow(200, 2)).toBe(4);
  });

  it('adjusts for more bars per group', () => {
    // With 5 bars per group, need more rows per week
    const result = computeWeeksToShow(40, 5);
    expect(result).toBeGreaterThanOrEqual(2);
    expect(result).toBeLessThanOrEqual(4);
  });

  it('never goes below 2', () => {
    expect(computeWeeksToShow(20, 10)).toBe(2);
  });

  it('handles typical terminal heights', () => {
    // 40 rows, 2 bars/group: floor((40-30)/(2+1)) = floor(10/3) = 3
    expect(computeWeeksToShow(40, 2)).toBe(3);
  });
});

describe('Dashboard View', () => {
  it('renders without crashing and returns quit on Q key', async () => {
    const { dashboardView } = await import('../views/dashboard.js');
    const ctx = makeSampleContext();

    mockedReadKey.mockResolvedValueOnce(key('q'));

    const result = await dashboardView(ctx);
    expect(result).toEqual({ type: 'quit' });
    expect(screenClearCount).toBeGreaterThan(0);
    expect(consoleLogSpy).toHaveBeenCalled();
  });

  it('returns push action when pressing numbered team key', async () => {
    const { dashboardView } = await import('../views/dashboard.js');
    const ctx = makeSampleContext();

    // Press '1' to drill into first numbered team (Platform)
    mockedReadKey.mockResolvedValueOnce(key('1'));

    const result = await dashboardView(ctx);
    expect(result.type).toBe('push');
    expect((result as { type: 'push'; view: ViewFn }).view).toBeTypeOf('function');
  });

  it('switches tabs and re-renders then quits', async () => {
    const { dashboardView } = await import('../views/dashboard.js');
    const ctx = makeSampleContext();

    mockedReadKey
      .mockResolvedValueOnce(key('r'))  // switch to repo_activity tab
      .mockResolvedValueOnce(key('q')); // quit

    const result = await dashboardView(ctx);
    expect(result).toEqual({ type: 'quit' });
    expect(screenClearCount).toBe(2);
  });

  it('cycles tabs with Tab key', async () => {
    const { dashboardView } = await import('../views/dashboard.js');
    const ctx = makeSampleContext();

    // Tab → Repo Activity, Tab → Top Performers, Tab → back to Contributions, then quit
    mockedReadKey
      .mockResolvedValueOnce(key('tab'))
      .mockResolvedValueOnce(key('tab'))
      .mockResolvedValueOnce(key('tab'))
      .mockResolvedValueOnce(key('q'));

    const result = await dashboardView(ctx);
    expect(result).toEqual({ type: 'quit' });
    // 4 renders: initial + 3 tab presses (3 tabs cycle back)
    expect(screenClearCount).toBe(4);
  });

  it('drills down from org to team with down arrow', async () => {
    const { dashboardView } = await import('../views/dashboard.js');
    const ctx = makeSampleContext();

    // Press down arrow to drill org → team, then quit
    mockedReadKey
      .mockResolvedValueOnce(key('down'))
      .mockResolvedValueOnce(key('q'));

    const result = await dashboardView(ctx);
    expect(result).toEqual({ type: 'quit' });
    expect(screenClearCount).toBe(2);
  });

  it('changes granularity to month with - key (coarser)', async () => {
    const { dashboardView } = await import('../views/dashboard.js');
    const ctx = makeSampleContext();

    const loggedOutput: string[] = [];
    consoleLogSpy.mockImplementation((...args: any[]) => {
      loggedOutput.push(args.map(String).join(' '));
    });

    // Default is weekly, press - to go coarser (week → month), then quit
    mockedReadKey
      .mockResolvedValueOnce(key('-'))
      .mockResolvedValueOnce(key('q'));

    const result = await dashboardView(ctx);
    expect(result).toEqual({ type: 'quit' });

    const output = loggedOutput.join('\n');
    expect(output).toContain('Contribution by Month');
    expect(output).toContain('6 months');
  });

  it('changes granularity back to week with + key (finer)', async () => {
    const { dashboardView } = await import('../views/dashboard.js');
    const ctx = makeSampleContext();

    const loggedOutput: string[] = [];
    consoleLogSpy.mockImplementation((...args: any[]) => {
      loggedOutput.push(args.map(String).join(' '));
    });

    // - to month, then + back to week, then quit
    mockedReadKey
      .mockResolvedValueOnce(key('-'))   // week → month
      .mockResolvedValueOnce(key('+'))   // month → week
      .mockResolvedValueOnce(key('q'));

    await dashboardView(ctx);

    const output = loggedOutput.join('\n');
    expect(output).toContain('Contribution by Week');
    expect(output).toContain('12 weeks');
  });

  it('extends timeframe with right arrow', async () => {
    const { dashboardView } = await import('../views/dashboard.js');
    const ctx = makeSampleContext();

    const loggedOutput: string[] = [];
    consoleLogSpy.mockImplementation((...args: any[]) => {
      loggedOutput.push(args.map(String).join(' '));
    });

    // Press right arrow to extend (12 → 14 weeks), then quit
    mockedReadKey
      .mockResolvedValueOnce(key('right'))
      .mockResolvedValueOnce(key('q'));

    await dashboardView(ctx);

    const output = loggedOutput.join('\n');
    expect(output).toContain('14 weeks');
  });

  it('shrinks timeframe with left arrow', async () => {
    const { dashboardView } = await import('../views/dashboard.js');
    const ctx = makeSampleContext();

    const loggedOutput: string[] = [];
    consoleLogSpy.mockImplementation((...args: any[]) => {
      loggedOutput.push(args.map(String).join(' '));
    });

    // Press left arrow to shrink (12 → 10 weeks), then quit
    mockedReadKey
      .mockResolvedValueOnce(key('left'))
      .mockResolvedValueOnce(key('q'));

    await dashboardView(ctx);

    const output = loggedOutput.join('\n');
    expect(output).toContain('10 weeks');
  });

  it('toggles detail view with D key', async () => {
    const { dashboardView } = await import('../views/dashboard.js');
    const ctx = makeSampleContext();

    const loggedOutput: string[] = [];
    consoleLogSpy.mockImplementation((...args: any[]) => {
      loggedOutput.push(args.map(String).join(' '));
    });

    // Press D to open submenu, then T for table view, then quit
    mockedReadKey
      .mockResolvedValueOnce(key('d'))  // open detail submenu
      .mockResolvedValueOnce(key('t'))  // choose table
      .mockResolvedValueOnce(key('q'));

    await dashboardView(ctx);

    const output = loggedOutput.join('\n');
    // Detail view shows metric column headers
    expect(output).toContain('Contribution Detail');
    expect(output).toContain('Commits');
    expect(output).toContain('Avg Size');
    expect(output).toContain('+Lines');
    expect(output).toContain('-Lines');
  });

  it('toggles back from detail to chart view', async () => {
    const { dashboardView } = await import('../views/dashboard.js');
    const ctx = makeSampleContext();

    const loggedOutput: string[] = [];
    consoleLogSpy.mockImplementation((...args: any[]) => {
      loggedOutput.push(args.map(String).join(' '));
    });

    // Press D→T for table, then D→Esc back to compact, then quit
    mockedReadKey
      .mockResolvedValueOnce(key('d'))  // open detail submenu
      .mockResolvedValueOnce(key('t'))  // choose table
      .mockResolvedValueOnce(key('d'))  // open detail submenu again
      .mockResolvedValueOnce(key('escape'))  // Esc → back to compact
      .mockResolvedValueOnce(key('q'));

    await dashboardView(ctx);

    const output = loggedOutput.join('\n');
    // After toggling back, chart view with "Contribution by Week" title
    expect(output).toContain('Contribution by Week');
  });

  it('switches to PRs detail view with D→P', async () => {
    const { dashboardView } = await import('../views/dashboard.js');
    const ctx = makeSampleContext();

    const loggedOutput: string[] = [];
    consoleLogSpy.mockImplementation((...args: any[]) => {
      loggedOutput.push(args.map(String).join(' '));
    });

    // Press D to open submenu, then P for PRs view, then quit
    mockedReadKey
      .mockResolvedValueOnce(key('d'))  // open detail submenu
      .mockResolvedValueOnce(key('p'))  // choose PRs
      .mockResolvedValueOnce(key('q'));

    await dashboardView(ctx);

    const output = loggedOutput.join('\n');
    // Submenu should show the PRs option
    expect(output).toContain('PRs');
    // Hotkey bar should show [D] PRs as the active detail mode
    expect(output).toContain('PRs');
  });

  it('toggles per-user mode with U key', async () => {
    const { dashboardView } = await import('../views/dashboard.js');
    const ctx = makeSampleContext();

    const loggedOutput: string[] = [];
    consoleLogSpy.mockImplementation((...args: any[]) => {
      loggedOutput.push(args.map(String).join(' '));
    });

    // Press U to toggle per-user mode, then quit
    mockedReadKey
      .mockResolvedValueOnce(key('u'))  // toggle per-user
      .mockResolvedValueOnce(key('q'));

    await dashboardView(ctx);

    const output = loggedOutput.join('\n');
    // Hotkey bar should show [U] /user when active
    expect(output).toContain('/user');
  });

  it('shows 12 weeks as default window in contributions title', async () => {
    const { dashboardView } = await import('../views/dashboard.js');
    const ctx = makeSampleContext();

    const loggedOutput: string[] = [];
    consoleLogSpy.mockImplementation((...args: any[]) => {
      loggedOutput.push(args.map(String).join(' '));
    });

    mockedReadKey.mockResolvedValueOnce(key('q'));

    await dashboardView(ctx);

    const output = loggedOutput.join('\n');
    expect(output).toContain('12 weeks');
    expect(output).toContain('Contribution by Week');
  });

  it('toggles tag overlay on and off with G key', async () => {
    const { dashboardView } = await import('../views/dashboard.js');
    const ctx = makeSampleContext();

    mockedReadKey
      .mockResolvedValueOnce(key('t'))  // tag overlay on
      .mockResolvedValueOnce(key('t'))  // tag overlay off
      .mockResolvedValueOnce(key('q')); // quit

    const result = await dashboardView(ctx);
    expect(result).toEqual({ type: 'quit' });
    expect(screenClearCount).toBe(3);
  });

  it('handles Ctrl+C gracefully', async () => {
    const { dashboardView } = await import('../views/dashboard.js');
    const ctx = makeSampleContext();

    mockedReadKey.mockRejectedValueOnce(new Error('SIGINT'));

    const result = await dashboardView(ctx);
    expect(result).toEqual({ type: 'quit' });
  });

  it('renders tab bar and active tab content', async () => {
    const { dashboardView } = await import('../views/dashboard.js');
    const ctx = makeSampleContext();

    const loggedOutput: string[] = [];
    consoleLogSpy.mockImplementation((...args: any[]) => {
      loggedOutput.push(args.map(String).join(' '));
    });

    mockedReadKey.mockResolvedValueOnce(key('q'));

    await dashboardView(ctx);

    const output = loggedOutput.join('\n');
    // Tab bar should be visible
    expect(output).toContain('Contributions');
    expect(output).toContain('Repo Activity');
    expect(output).toContain('Top Performers');
    // Default tab is Contributions
    expect(output).toContain('Contribution by Week');
  });
});

describe('Team Detail View', () => {
  it('renders without crashing and returns pop on B key', async () => {
    const { teamDetailView } = await import('../views/team-detail.js');
    const ctx = makeSampleContext();

    mockedReadKey.mockResolvedValueOnce(key('b'));

    const result = await teamDetailView(ctx, 'Platform');
    expect(result).toEqual({ type: 'pop' });
    expect(screenClearCount).toBeGreaterThan(0);
  });

  it('returns quit on Q key', async () => {
    const { teamDetailView } = await import('../views/team-detail.js');
    const ctx = makeSampleContext();

    mockedReadKey.mockResolvedValueOnce(key('q'));

    const result = await teamDetailView(ctx, 'Platform');
    expect(result).toEqual({ type: 'quit' });
  });

  it('returns push action when pressing numbered member key', async () => {
    const { teamDetailView } = await import('../views/team-detail.js');
    const ctx = makeSampleContext();

    // Press '1' for first member in the sorted list
    mockedReadKey.mockResolvedValueOnce(key('1'));

    const result = await teamDetailView(ctx, 'Platform');
    expect(result.type).toBe('push');
    expect((result as { type: 'push'; view: ViewFn }).view).toBeTypeOf('function');
  });

  it('handles Ctrl+C gracefully', async () => {
    const { teamDetailView } = await import('../views/team-detail.js');
    const ctx = makeSampleContext();

    mockedReadKey.mockRejectedValueOnce(new Error('SIGINT'));

    const result = await teamDetailView(ctx, 'Platform');
    expect(result).toEqual({ type: 'quit' });
  });

  it('renders team banner, member bars, tables', async () => {
    const { teamDetailView } = await import('../views/team-detail.js');
    const ctx = makeSampleContext();

    const loggedOutput: string[] = [];
    consoleLogSpy.mockImplementation((...args: any[]) => {
      loggedOutput.push(args.map(String).join(' '));
    });

    mockedReadKey.mockResolvedValueOnce(key('b'));

    await teamDetailView(ctx, 'Platform');

    const output = loggedOutput.join('\n');
    expect(output).toContain('PLATFORM');
    expect(output).toContain('File Type by Member');
    expect(output).toContain('Member Activity');
    expect(output).toContain('Members');
  });

  it('handles team with no data gracefully', async () => {
    const { teamDetailView } = await import('../views/team-detail.js');
    const ctx = makeSampleContext();
    ctx.records = []; // No records

    mockedReadKey.mockResolvedValueOnce(key('b'));

    const result = await teamDetailView(ctx, 'Platform');
    expect(result).toEqual({ type: 'pop' });
  });
});

describe('Member Detail View', () => {
  it('renders without crashing and returns pop on B key', async () => {
    const { memberDetailView } = await import('../views/member-detail.js');
    const ctx = makeSampleContext();

    mockedReadKey.mockResolvedValueOnce(key('b'));

    const result = await memberDetailView(ctx, 'Alice Chen', 'Platform');
    expect(result).toEqual({ type: 'pop' });
    expect(screenClearCount).toBeGreaterThan(0);
  });

  it('returns quit on Q key', async () => {
    const { memberDetailView } = await import('../views/member-detail.js');
    const ctx = makeSampleContext();

    mockedReadKey.mockResolvedValueOnce(key('q'));

    const result = await memberDetailView(ctx, 'Alice Chen', 'Platform');
    expect(result).toEqual({ type: 'quit' });
  });

  it('handles Ctrl+C gracefully', async () => {
    const { memberDetailView } = await import('../views/member-detail.js');
    const ctx = makeSampleContext();

    mockedReadKey.mockRejectedValueOnce(new Error('SIGINT'));

    const result = await memberDetailView(ctx, 'Alice Chen', 'Platform');
    expect(result).toEqual({ type: 'quit' });
  });

  it('renders member banner, charts, and summary', async () => {
    const { memberDetailView } = await import('../views/member-detail.js');
    const ctx = makeSampleContext();

    const loggedOutput: string[] = [];
    consoleLogSpy.mockImplementation((...args: any[]) => {
      loggedOutput.push(args.map(String).join(' '));
    });

    mockedReadKey.mockResolvedValueOnce(key('b'));

    await memberDetailView(ctx, 'Alice Chen', 'Platform');

    const output = loggedOutput.join('\n');
    expect(output).toContain('ALICE CHEN');
    expect(output).toContain('File Type by Week');
    expect(output).toContain('Activity (12 weeks)');
    expect(output).toContain('12w Summary');
  });

  it('renders with no data gracefully', async () => {
    const { memberDetailView } = await import('../views/member-detail.js');
    const ctx = makeSampleContext();
    ctx.records = [];

    mockedReadKey.mockResolvedValueOnce(key('b'));

    const result = await memberDetailView(ctx, 'Alice Chen', 'Platform');
    expect(result).toEqual({ type: 'pop' });
  });
});

describe('Trends View', () => {
  it('renders without crashing and returns pop on B key', async () => {
    const { trendsView } = await import('../views/trends.js');
    const ctx = makeSampleContext();

    mockedReadKey.mockResolvedValueOnce(key('b'));

    const result = await trendsView(ctx);
    expect(result).toEqual({ type: 'pop' });
    expect(screenClearCount).toBeGreaterThan(0);
  });

  it('returns quit on Q key', async () => {
    const { trendsView } = await import('../views/trends.js');
    const ctx = makeSampleContext();

    mockedReadKey.mockResolvedValueOnce(key('q'));

    const result = await trendsView(ctx);
    expect(result).toEqual({ type: 'quit' });
  });

  it('re-renders on expand mode changes then goes back', async () => {
    const { trendsView } = await import('../views/trends.js');
    const ctx = makeSampleContext();

    mockedReadKey
      .mockResolvedValueOnce(key('e'))  // expand by team
      .mockResolvedValueOnce(key('g'))  // expand by tag
      .mockResolvedValueOnce(key('b')); // back

    const result = await trendsView(ctx);
    expect(result).toEqual({ type: 'pop' });
    expect(screenClearCount).toBe(3);
  });

  it('handles Ctrl+C gracefully', async () => {
    const { trendsView } = await import('../views/trends.js');
    const ctx = makeSampleContext();

    mockedReadKey.mockRejectedValueOnce(new Error('SIGINT'));

    const result = await trendsView(ctx);
    expect(result).toEqual({ type: 'quit' });
  });

  it('renders all four sections', async () => {
    const { trendsView } = await import('../views/trends.js');
    const ctx = makeSampleContext();

    const loggedOutput: string[] = [];
    consoleLogSpy.mockImplementation((...args: any[]) => {
      loggedOutput.push(args.map(String).join(' '));
    });

    mockedReadKey.mockResolvedValueOnce(key('b'));

    await trendsView(ctx);

    const output = loggedOutput.join('\n');
    expect(output).toContain('TRENDS');
    expect(output).toContain('Commits/week');
    expect(output).toContain('File Type Breakdown');
    expect(output).toContain('Avg Output per Person');
    expect(output).toContain('Test Ratio');
  });

  it('handles collapse to org after team expand', async () => {
    const { trendsView } = await import('../views/trends.js');
    const ctx = makeSampleContext();

    mockedReadKey
      .mockResolvedValueOnce(key('e'))  // expand by team
      .mockResolvedValueOnce(key('o'))  // collapse to org
      .mockResolvedValueOnce(key('q')); // quit

    const result = await trendsView(ctx);
    expect(result).toEqual({ type: 'quit' });
  });
});

describe('Data Transform Helpers', () => {
  it('dashboard renders contributions tab with week labels', async () => {
    const ctx = makeSampleContext();

    const loggedOutput: string[] = [];
    consoleLogSpy.mockImplementation((...args: any[]) => {
      loggedOutput.push(args.map(String).join(' '));
    });

    const { dashboardView } = await import('../views/dashboard.js');
    mockedReadKey.mockResolvedValueOnce(key('q'));
    await dashboardView(ctx);

    const output = loggedOutput.join('\n');
    // Should contain week labels (W10, W11, W12 by default for last 3 weeks)
    expect(output).toContain('W');
  });

  it('team detail builds member bars with correct headcount', async () => {
    const { teamDetailView } = await import('../views/team-detail.js');
    const ctx = makeSampleContext();

    const loggedOutput: string[] = [];
    consoleLogSpy.mockImplementation((...args: any[]) => {
      loggedOutput.push(args.map(String).join(' '));
    });

    mockedReadKey.mockResolvedValueOnce(key('b'));
    await teamDetailView(ctx, 'Platform');

    const output = loggedOutput.join('\n');
    // Platform has 2 members, headcount shown as (1) for per-member bars
    expect(output).toContain('Alice Chen');
    expect(output).toContain('Bob Kumar');
  });

  it('member detail computes 12w summary', async () => {
    const { memberDetailView } = await import('../views/member-detail.js');
    const ctx = makeSampleContext();

    const loggedOutput: string[] = [];
    consoleLogSpy.mockImplementation((...args: any[]) => {
      loggedOutput.push(args.map(String).join(' '));
    });

    mockedReadKey.mockResolvedValueOnce(key('b'));
    await memberDetailView(ctx, 'Alice Chen', 'Platform');

    const output = loggedOutput.join('\n');
    expect(output).toContain('12w Summary');
    expect(output).toContain('commits/wk');
    expect(output).toContain('+lines/wk');
    expect(output).toContain('test ratio');
  });
});

describe('Navigation Actions', () => {
  it('dashboard team selection returns correct view function', async () => {
    const { dashboardView } = await import('../views/dashboard.js');
    const ctx = makeSampleContext();

    // Press '1' for first numbered team
    mockedReadKey.mockResolvedValueOnce(key('1'));
    const result = await dashboardView(ctx);

    expect(result.type).toBe('push');
    if (result.type === 'push') {
      expect(result.view).toBeTypeOf('function');
    }
  });

  it('team detail member selection returns correct view function', async () => {
    const { teamDetailView } = await import('../views/team-detail.js');
    const ctx = makeSampleContext();

    // Press '1' for first member
    mockedReadKey.mockResolvedValueOnce(key('1'));
    const result = await teamDetailView(ctx, 'Platform');

    expect(result.type).toBe('push');
    if (result.type === 'push') {
      expect(result.view).toBeTypeOf('function');
    }
  });

  it('back from team detail returns pop', async () => {
    const { teamDetailView } = await import('../views/team-detail.js');
    const ctx = makeSampleContext();

    mockedReadKey.mockResolvedValueOnce(key('b'));
    const result = await teamDetailView(ctx, 'Platform');
    expect(result).toEqual({ type: 'pop' });
  });

  it('back from member detail returns pop', async () => {
    const { memberDetailView } = await import('../views/member-detail.js');
    const ctx = makeSampleContext();

    mockedReadKey.mockResolvedValueOnce(key('b'));
    const result = await memberDetailView(ctx, 'Alice Chen', 'Platform');
    expect(result).toEqual({ type: 'pop' });
  });

  it('back from trends returns pop', async () => {
    const { trendsView } = await import('../views/trends.js');
    const ctx = makeSampleContext();

    mockedReadKey.mockResolvedValueOnce(key('b'));
    const result = await trendsView(ctx);
    expect(result).toEqual({ type: 'pop' });
  });
});

describe('ViewContext types', () => {
  it('ViewContext has required properties', () => {
    const ctx = makeSampleContext();
    expect(ctx.config).toBeDefined();
    expect(ctx.records).toBeInstanceOf(Array);
    expect(ctx.currentWeek).toMatch(/^\d{4}-W\d{2}$/);
  });

  it('NavigationAction types are valid', () => {
    const quit: NavigationAction = { type: 'quit' };
    const pop: NavigationAction = { type: 'pop' };
    const push: NavigationAction = { type: 'push', view: async () => ({ type: 'quit' }) };
    const replace: NavigationAction = { type: 'replace', view: async () => ({ type: 'quit' }) };

    expect(quit.type).toBe('quit');
    expect(pop.type).toBe('pop');
    expect(push.type).toBe('push');
    expect(replace.type).toBe('replace');
  });
});

describe('Empty data handling', () => {
  it('dashboard renders without crashing with empty records', async () => {
    const { dashboardView } = await import('../views/dashboard.js');
    const ctx = makeSampleContext();
    ctx.records = [];

    mockedReadKey.mockResolvedValueOnce(key('q'));
    const result = await dashboardView(ctx);
    expect(result).toEqual({ type: 'quit' });
  });

  it('trends renders without crashing with empty records', async () => {
    const { trendsView } = await import('../views/trends.js');
    const ctx = makeSampleContext();
    ctx.records = [];

    mockedReadKey.mockResolvedValueOnce(key('b'));
    const result = await trendsView(ctx);
    expect(result).toEqual({ type: 'pop' });
  });

  it('team detail renders without crashing with empty records', async () => {
    const { teamDetailView } = await import('../views/team-detail.js');
    const ctx = makeSampleContext();
    ctx.records = [];

    mockedReadKey.mockResolvedValueOnce(key('b'));
    const result = await teamDetailView(ctx, 'Platform');
    expect(result).toEqual({ type: 'pop' });
  });

  it('member detail renders without crashing with empty records', async () => {
    const { memberDetailView } = await import('../views/member-detail.js');
    const ctx = makeSampleContext();
    ctx.records = [];

    mockedReadKey.mockResolvedValueOnce(key('b'));
    const result = await memberDetailView(ctx, 'Alice Chen', 'Platform');
    expect(result).toEqual({ type: 'pop' });
  });
});
