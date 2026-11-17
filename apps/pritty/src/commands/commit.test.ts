import { posix } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { ValidationResult } from '../adapters/index.js';
import type { CommitMessage } from '../ai.js';
import { ConfigSchema } from '../config.js';
import type { GitOps } from '../git.js';
import { parseCommitInput } from './_shared/explicit.js';
import type { PlanCache } from './_shared/plan-cache.js';
import { type CommitDeps, runCommit } from './commit.js';

type Answer = (groups: Record<string, string[]>) => CommitMessage[];

const oneEach: Answer = (groups) =>
  Object.entries(groups)
    .filter(([, files]) => files.length > 0)
    .map(([category, files]) => ({ category, message: `feat: ${category}`, files }));

function memoryCache(): PlanCache & { store: Map<string, CommitMessage[]> } {
  const store = new Map<string, CommitMessage[]>();
  return {
    store,
    read: async (key) => store.get(key),
    write: async (key, plan) => {
      store.clear();
      store.set(
        key,
        plan.map((c) => ({ ...c })),
      );
    },
    clear: async () => {
      store.clear();
    },
  };
}

function fakes(
  o: {
    staged?: string[];
    config?: Record<string, unknown>;
    branch?: string;
    answer?: Answer;
    planCache?: PlanCache;
    failCommits?: number;
    /** Commits that succeed before the `failCommits` failures start. */
    failAfter?: number;
    stdin?: string;
    stdinIsTTY?: boolean;
    cwd?: string;
    /** The ticket the branch names, as resolveTicketContext reports it. */
    ticket?: string;
    /** What the person types at each label question, in order; then Enter. */
    inputs?: string[];
    /** The tracker's answer for a looked-up ticket (default: unreachable, null). */
    lookup?: (ticket: string) => ValidationResult | null;
  } = {},
) {
  const calls: string[] = [];
  const committed: Array<{ message: string; files: string[]; noVerify: boolean }> = [];
  const generated: Array<{ branch?: string; labels?: boolean }> = [];
  /** The questions put to the person through `prompts.input`. */
  const asked: string[] = [];
  const inputs = [...(o.inputs ?? [])];
  const stagedFor: Array<{ pathspecs: string[]; fromDir?: string }> = [];
  let sha = 0;
  let attempts = 0;
  let failures = o.failCommits ?? 0;
  const state = {
    staged: 'tree1' as string | null,
    answer: o.answer ?? oneEach,
    /** The index: a commit takes its files out of it, as git does. */
    files: [...(o.staged ?? ['src/a.ts', 'src/a.test.ts'])],
  };
  const git = {
    getCurrentBranch: async () => o.branch ?? 'feature/x',
    getStaged: async () => [...state.files],
    // The repository root is /repo: a pathspec resolves from fromDir, or from the root without one.
    stagedFor: async (pathspecs: readonly string[], fromDir?: string) => {
      stagedFor.push({ pathspecs: [...pathspecs], ...(fromDir ? { fromDir } : {}) });
      const base = fromDir ? posix.relative('/repo', fromDir) : '';
      return new Map(
        pathspecs.map((p) => {
          const spec = posix.join(base, p).replace(/\/$/, '');
          return [p, state.files.filter((f) => f === spec || f.startsWith(`${spec}/`))];
        }),
      );
    },
    getStagedDiff: async () => '+a',
    stagedState: async () => state.staged,
    commit: async (message: string, files?: string[], opts?: { noVerify?: boolean }) => {
      calls.push('commit');
      if (attempts++ >= (o.failAfter ?? 0) && failures > 0) {
        failures--;
        throw new Error('pre-commit hook refused');
      }
      committed.push({ message, files: files ?? [], noVerify: Boolean(opts?.noVerify) });
      const done = new Set(files ?? state.files);
      state.files = state.files.filter((f) => !done.has(f));
    },
    headSha: async () => `sha${++sha}`,
  } as unknown as GitOps;
  const out: string[] = [];
  const err: string[] = [];
  const deps: CommitDeps = {
    git,
    config: ConfigSchema.parse(o.config ?? {}),
    ai: {
      generateCommitMessages: async (groups, _diff, _config, _ticket, context) => {
        calls.push('generate');
        generated.push({ branch: context?.branch, labels: context?.labels });
        return state.answer(groups);
      },
    },
    ticket: async () => {
      calls.push('ticket');
      return o.ticket ? { ticket: o.ticket } : undefined;
    },
    prompts: {
      confirm: async () => {
        calls.push('confirm');
        return true;
      },
      editor: async (d) => d.default ?? '',
      input: async (q) => {
        calls.push('input');
        asked.push(q.message);
        return inputs.shift() ?? '';
      },
    },
    lookupTicket: async (_config, ticket) => {
      calls.push(`lookup ${ticket}`);
      return o.lookup ? o.lookup(ticket) : null;
    },
    io: { out: (l) => out.push(l), err: (l) => err.push(l) },
    ...(o.planCache ? { planCache: o.planCache } : {}),
    readStdin: async () => {
      calls.push('readStdin');
      return o.stdin ?? '';
    },
    stdinIsTTY: o.stdinIsTTY ?? false,
    cwd: o.cwd ?? '/repo',
  };
  return { deps, calls, committed, generated, stagedFor, asked, out, err, state };
}

const subjects = (committed: Array<{ message: string }>): string[] =>
  committed.map((c) => c.message.split('\n')[0]!);

describe('runCommit --json', () => {
  it('prints one JSON line with the commits made, everything else on stderr, and asks nothing', async () => {
    const f = fakes();
    const result = await runCommit({ json: true }, f.deps);
    expect(f.out).toHaveLength(1);
    const line = JSON.parse(f.out[0]!);
    expect(line).toEqual({
      dryRun: false,
      commits: [
        {
          category: 'app',
          message: 'feat: app',
          type: 'feat',
          description: 'app',
          files: ['src/a.ts'],
          sha: 'sha1',
        },
        {
          category: 'test',
          message: 'feat: test',
          type: 'feat',
          description: 'test',
          files: ['src/a.test.ts'],
          sha: 'sha2',
        },
      ],
    });
    expect(f.err.length).toBeGreaterThan(0);
    expect(f.calls).not.toContain('confirm');
    expect(result?.commits).toHaveLength(2);
  });

  it('splits each subject into type, scope and description, with no label while commitLabels is off', async () => {
    const f = fakes({
      answer: (groups) =>
        Object.entries(groups)
          .filter(([, files]) => files.length > 0)
          .map(([category, files]) => ({
            category,
            message: `fix(api): ${category} thing`,
            files,
          })),
    });
    await runCommit({ json: true }, f.deps);
    const { commits } = JSON.parse(f.out[0]!);
    expect(commits).toHaveLength(2);
    for (const c of commits) {
      expect(c).toMatchObject({ type: 'fix', scope: 'api' });
      expect(c.description).toBe(`${c.category} thing`);
      expect(c).not.toHaveProperty('label');
    }
  });

  it('under --dry-run --json reports the plan and commits nothing', async () => {
    const f = fakes();
    await runCommit({ json: true, dryRun: true }, f.deps);
    const line = JSON.parse(f.out[0]!);
    expect(line.dryRun).toBe(true);
    expect(line.commits.map((c: { sha?: string }) => c.sha)).toEqual([undefined, undefined]);
    expect(f.calls).not.toContain('commit');
  });

  it('with nothing staged prints { commits: [] }', async () => {
    const f = fakes({ staged: [] });
    await runCommit({ json: true }, f.deps);
    expect(JSON.parse(f.out[0]!)).toEqual({ dryRun: false, commits: [] });
  });
});

describe('runCommit commit order', () => {
  it('commits code before tests and tests before stories, whatever order the model returns', async () => {
    const f = fakes({
      staged: ['src/a.ts', 'src/a.test.ts', 'src/A.stories.tsx', 'package.json'],
      answer: (groups) => oneEach(groups).reverse(),
    });
    await runCommit({ json: true }, f.deps);
    expect(subjects(f.committed)).toEqual([
      'feat: config',
      'feat: app',
      'feat: test',
      'feat: storybook',
    ]);
  });
});

describe('runCommit on a fix/ branch', () => {
  const staged = [
    'src/a.ts',
    'src/a.test.ts',
    'package.json',
    '.github/workflows/ci.yml',
    'notes/report.md',
  ];
  const answer: Answer = () => [
    { category: 'app', message: 'feat(phone): add kenya to supported phone countries', files: [] },
    { category: 'test', message: 'test(phone): cover kenya', files: [] },
    { category: 'config', message: 'chore(deps): bump jefeui to 2.8.14', files: [] },
    { category: 'infra', message: 'build(ci): pin node 24', files: [] },
    { category: 'unknown', message: 'docs(issues): mark the report fixed', files: [] },
  ];

  it('types feat, build and chore commits `fix`, keeping scope and subject, and leaves test and docs alone', async () => {
    const f = fakes({ branch: 'fix/family/my-profile--phone-kenya', staged, answer });
    await runCommit({ json: true }, f.deps);
    expect(subjects(f.committed)).toEqual([
      'fix(ci): pin node 24',
      'fix(deps): bump jefeui to 2.8.14',
      'fix(phone): add kenya to supported phone countries',
      'docs(issues): mark the report fixed',
      'test(phone): cover kenya',
    ]);
  });

  it('shows the same types in the dry run', async () => {
    const f = fakes({ branch: 'fix/family/my-profile--phone-kenya', staged, answer });
    await runCommit({ json: true, dryRun: true }, f.deps);
    const line = JSON.parse(f.out[0]!) as { commits: Array<{ message: string }> };
    expect(line.commits.map((c) => c.message)).toContain(
      'fix(phone): add kenya to supported phone countries',
    );
  });

  it('leaves the model’s types alone on any other branch', async () => {
    for (const branch of ['feature/x', 'chore/platform/auth--pin', 'main']) {
      const f = fakes({ branch, staged, answer });
      await runCommit({ json: true }, f.deps);
      expect(subjects(f.committed).map((s) => s.split(':')[0])).toEqual([
        'build(ci)',
        'chore(deps)',
        'feat(phone)',
        'docs(issues)',
        'test(phone)',
      ]);
    }
  });

  it('tells the model the branch name', async () => {
    const f = fakes({ branch: 'fix/family/my-profile--phone-kenya' });
    await runCommit({ json: true, dryRun: true }, f.deps);
    expect(f.generated).toEqual([{ branch: 'fix/family/my-profile--phone-kenya', labels: false }]);
  });
});

describe('runCommit --trailer', () => {
  it('adds each trailer to every commit, after the configured ones', async () => {
    const f = fakes({ config: { commitTrailers: ['Co-Authored-By: A <a@x>'] } });
    await runCommit({ json: true, trailer: ['Refs: plan-5 T9'] }, f.deps);
    for (const c of f.committed) {
      expect(c.message.endsWith('\n\nCo-Authored-By: A <a@x>\nRefs: plan-5 T9')).toBe(true);
    }
    expect(f.committed).toHaveLength(2);
  });

  it('refuses a line that is not `Token: value`, before asking the model or committing', async () => {
    const f = fakes();
    await expect(runCommit({ json: true, trailer: ['plan-5 T9'] }, f.deps)).rejects.toThrow(
      /--trailer/,
    );
    expect(f.calls).toEqual([]);
  });
});

describe('runCommit --type', () => {
  const answer: Answer = () => [
    { category: 'app', message: 'feat(phone): add kenya', files: [] },
    { category: 'test', message: 'test(phone): cover kenya', files: [] },
  ];

  it('sets the type of the code commits, keeping scope and subject; the test commit keeps its own', async () => {
    const f = fakes({ answer });
    await runCommit({ json: true, type: 'fix' }, f.deps);
    expect(subjects(f.committed)).toEqual(['fix(phone): add kenya', 'test(phone): cover kenya']);
  });

  it('wins over the fix/ branch rule', async () => {
    const f = fakes({ answer, branch: 'fix/org/network--table-sort' });
    await runCommit({ json: true, type: 'refactor' }, f.deps);
    expect(subjects(f.committed)[0]).toBe('refactor(phone): add kenya');
  });

  it('refuses a type outside the conventional list, before asking the model', async () => {
    const f = fakes({ answer });
    await expect(runCommit({ json: true, type: 'feature' }, f.deps)).rejects.toThrow(/--type/);
    expect(f.calls).toEqual([]);
  });

  it('refuses under a commit style without types', async () => {
    const f = fakes({ answer });
    await expect(
      runCommit({ json: true, type: 'fix', commitStyle: 'simple' }, f.deps),
    ).rejects.toThrow(/--type/);
  });
});

describe('runCommit --scope', () => {
  const answer: Answer = () => [
    { category: 'app', message: 'feat(globaldirectory)!: drop the zip filter', files: [] },
    { category: 'test', message: 'test: cover the search', files: [] },
  ];

  it('sets the scope of every commit, test included, keeping type, `!` and subject', async () => {
    const f = fakes({ answer });
    await runCommit({ json: true, scope: 'org/global' }, f.deps);
    expect(subjects(f.committed)).toEqual([
      'feat(org/global)!: drop the zip filter',
      'test(org/global): cover the search',
    ]);
  });

  it('takes one, two or three levels', async () => {
    for (const scope of ['network', 'org/network', 'org/network/directory']) {
      const f = fakes({ answer });
      await runCommit({ json: true, scope }, f.deps);
      expect(subjects(f.committed)[1]).toBe(`test(${scope}): cover the search`);
    }
  });

  it('refuses anything but one to three lowercase segments, before asking the model', async () => {
    for (const scope of [
      'Org/Global',
      'org/network/directory/search',
      'org//global',
      'org global',
    ]) {
      const f = fakes({ answer });
      await expect(runCommit({ json: true, scope }, f.deps)).rejects.toThrow(/--scope/);
      expect(f.calls).toEqual([]);
    }
  });

  it('keeps a subject that is not conventional as written, and says so', async () => {
    const f = fakes({
      answer: (groups) =>
        Object.entries(groups)
          .filter(([, files]) => files.length > 0)
          .map(([category, files]) => ({ category, message: `Update ${category}`, files })),
    });
    await runCommit({ json: true, scope: 'org/global' }, f.deps);
    expect(subjects(f.committed)).toEqual(['Update app', 'Update test']);
    expect(f.err.join('\n')).toMatch(/not a conventional subject/);
  });
});

describe('runCommit --no-verify', () => {
  it('passes noVerify to every git commit when asked, and not otherwise', async () => {
    const f = fakes();
    await runCommit({ json: true, noVerify: true }, f.deps);
    expect(f.committed.map((c) => c.noVerify)).toEqual([true, true]);

    const g = fakes();
    await runCommit({ json: true }, g.deps);
    expect(g.committed.map((c) => c.noVerify)).toEqual([false, false]);
  });
});

describe('runCommit reuses the reviewed plan', () => {
  const draft =
    (word: string): Answer =>
    (groups) =>
      oneEach(groups).map((c) => ({
        ...c,
        message: `${c.message} ${word}`,
        body: `Refs #1 ${word}`,
      }));

  it('commits the dry run’s messages when the staged state has not changed, without asking the model again', async () => {
    const f = fakes({ planCache: memoryCache(), answer: draft('reviewed') });
    await runCommit({ json: true, dryRun: true }, f.deps);
    f.state.answer = draft('redrafted');
    await runCommit({ json: true }, f.deps);

    expect(f.calls.filter((c) => c === 'generate')).toHaveLength(1);
    expect(f.committed.map((c) => c.message.split('\n\n'))).toEqual([
      ['feat: app reviewed', 'Refs #1 reviewed'],
      ['feat: test reviewed', 'Refs #1 reviewed'],
    ]);
    expect(JSON.parse(f.out[1]!)).toMatchObject({ dryRun: false, reusedPlan: true });
  });

  it('asks the model again when the staged state changed after the dry run', async () => {
    const f = fakes({ planCache: memoryCache(), answer: draft('reviewed') });
    await runCommit({ json: true, dryRun: true }, f.deps);
    f.state.answer = draft('redrafted');
    f.state.staged = 'tree2';
    await runCommit({ json: true }, f.deps);

    expect(f.calls.filter((c) => c === 'generate')).toHaveLength(2);
    expect(f.committed[0]!.message).toContain('redrafted');
    expect(JSON.parse(f.out[1]!).reusedPlan).toBeUndefined();
  });

  it('asks the model again on a second dry run, so a fresh draft is one dry run away', async () => {
    const f = fakes({ planCache: memoryCache(), answer: draft('first') });
    await runCommit({ json: true, dryRun: true }, f.deps);
    f.state.answer = draft('second');
    await runCommit({ json: true, dryRun: true }, f.deps);
    await runCommit({ json: true }, f.deps);

    expect(f.calls.filter((c) => c === 'generate')).toHaveLength(2);
    expect(f.committed[0]!.message).toContain('second');
  });

  it('forgets the plan once its commits are made', async () => {
    const cache = memoryCache();
    const f = fakes({ planCache: cache });
    await runCommit({ json: true, dryRun: true }, f.deps);
    await runCommit({ json: true }, f.deps);
    expect(cache.store.size).toBe(0);
  });

  it('keeps the plan when a commit is refused, so the retry commits the same messages', async () => {
    const f = fakes({ planCache: memoryCache(), answer: draft('first'), failCommits: 1 });
    await expect(runCommit({ json: true }, f.deps)).rejects.toThrow(/refused/);
    f.state.answer = draft('second');
    await runCommit({ json: true, noVerify: true }, f.deps);

    expect(f.calls.filter((c) => c === 'generate')).toHaveLength(1);
    expect(subjects(f.committed)).toEqual(['feat: app first', 'feat: test first']);
  });

  it('does not cache when the staged state cannot be read (an unmerged index)', async () => {
    const f = fakes({ planCache: memoryCache() });
    f.state.staged = null;
    await runCommit({ json: true, dryRun: true }, f.deps);
    await runCommit({ json: true }, f.deps);
    expect(f.calls.filter((c) => c === 'generate')).toHaveLength(2);
  });
});

describe('runCommit grouping by change', () => {
  const staged = ['src/a.ts', 'src/b.ts', 'src/a.test.ts', 'src/b.test.ts'];
  const split: Answer = () => [
    { change: 'b', category: 'test', message: 'test: b', files: ['src/b.test.ts'] },
    { change: 'a', category: 'app', message: 'feat: a', files: ['src/a.ts'] },
    { change: 'b', category: 'app', message: 'feat: b', files: ['src/b.ts'] },
    { change: 'a', category: 'test', message: 'test: a', files: ['src/a.test.ts'] },
  ];

  it("commits each change's code then its tests, change by change, each with only its files", async () => {
    const f = fakes({ staged, answer: split });
    await runCommit({ json: true }, f.deps);
    expect(f.committed.map((c) => c.files)).toEqual([
      ['src/b.ts'],
      ['src/b.test.ts'],
      ['src/a.ts'],
      ['src/a.test.ts'],
    ]);
    const line = JSON.parse(f.out[0]!);
    expect(line.commits.map((c: { change?: string }) => c.change)).toEqual(['b', 'b', 'a', 'a']);
  });

  it('refuses a bad split and commits nothing', async () => {
    // Dropping a whole entry would leave `test` with one step, which takes the full list;
    // a split step that lists a file the other step already has is the bad split.
    const f = fakes({
      staged,
      answer: (g) =>
        split(g).map((c) => (c.message === 'test: b' ? { ...c, files: ['src/a.test.ts'] } : c)),
    });
    await expect(runCommit({ json: true }, f.deps)).rejects.toThrow(/commitGrouping/);
    expect(f.calls).not.toContain('commit');
  });

  it("with commitGrouping category, sends today's plan and refuses a split", async () => {
    const f = fakes({ staged, answer: split, config: { commitGrouping: 'category' } });
    await expect(runCommit({ json: true }, f.deps)).rejects.toThrow(/more than once/);
    expect(f.calls).not.toContain('commit');
  });

  it('does not reuse a plan kept under the other grouping', async () => {
    const cache = memoryCache();
    const f1 = fakes({ staged, config: { commitGrouping: 'category' }, planCache: cache });
    await runCommit({ json: true, dryRun: true }, f1.deps);
    expect(cache.store.size).toBe(1);
    const f2 = fakes({ staged, answer: split, planCache: cache });
    await runCommit({ json: true }, f2.deps);
    expect(f2.calls).toContain('generate');
    expect(f2.committed).toHaveLength(4);
  });

  it("keeps a split commit's change and files when its message is edited", async () => {
    const f = fakes({ staged, answer: split });
    f.deps.prompts.editor = async () => 'feat: edited';
    const result = await runCommit({}, f.deps);
    expect(f.committed[0]?.message.startsWith('feat: edited')).toBe(true);
    expect(f.committed[0]?.files).toEqual(['src/b.ts']);
    expect(result?.commits[0]?.change).toBe('b');
  });

  it('shows each change with its commits and their files, indented under it', async () => {
    const f = fakes({ staged, answer: split });
    await runCommit({ json: true, dryRun: true }, f.deps);
    // biome-ignore lint/suspicious/noControlCharactersInRegex: strips ANSI colour codes
    const text = f.err.join('\n').replace(/\x1b\[[0-9;]*m/g, '');
    expect(text).toMatch(/^ {2}b\n {4}app {2}\(1 files\)\n {6}feat: b\n {6}src\/b\.ts$/m);
    expect(text).toMatch(/^ {2}a\n {4}app {2}\(1 files\)\n {6}feat: a\n {6}src\/a\.ts$/m);
  });

  it('labels edit prompts with the change and category', async () => {
    const f = fakes({ staged, answer: split });
    const asked: string[] = [];
    f.deps.prompts.confirm = async (o) => {
      asked.push(o.message);
      return false;
    };
    await runCommit({}, f.deps);
    expect(asked).toContain('Edit message for b · app?');
  });
});

// biome-ignore lint/suspicious/noControlCharactersInRegex: strips ANSI colour codes
const plain = (lines: string[]): string => lines.join('\n').replace(/\x1b\[[0-9;]*m/g, '');

/** A JSON body: the code commit listed after its test, to show pritty orders them. */
const twoCommits = JSON.stringify({
  commits: [
    {
      label: 'wedmodd-23444',
      type: 'test',
      scope: 'api',
      description: 'cover 404',
      files: ['src/a.test.ts'],
    },
    {
      label: 'wedmodd-23444',
      type: 'fix',
      scope: 'api',
      description: 'handle 404',
      files: ['src/a.ts'],
    },
  ],
});

describe('runCommit --message (args)', () => {
  const args = { message: 'handle 404', type: 'fix', scope: 'api' };

  it('makes one commit from the flags, with the normalised label, only the listed files and no model call', async () => {
    const f = fakes();
    await runCommit({ ...args, label: 'abc 1', paths: ['src/a.ts'] }, f.deps);
    expect(f.committed).toHaveLength(1);
    expect(subjects(f.committed)).toEqual(['ABC-1 fix(api): handle 404']);
    expect(f.committed[0]!.files).toEqual(['src/a.ts']);
    expect(f.calls).not.toContain('generate');
    expect(f.calls).not.toContain('ticket');
  });

  it('resolves paths after -- from the current directory, like git add', async () => {
    const f = fakes({ staged: ['apps/x/src/a.ts', 'src/a.ts'], cwd: '/repo/apps/x' });
    await runCommit({ ...args, paths: ['src/a.ts'], json: true }, f.deps);
    expect(f.stagedFor).toEqual([{ pathspecs: ['src/a.ts'], fromDir: '/repo/apps/x' }]);
    expect(f.committed.map((c) => c.files)).toEqual([['apps/x/src/a.ts']]);
  });

  it('adds --body and the trailers after the subject', async () => {
    const f = fakes({
      staged: ['src/a.ts'],
      config: { commitTrailers: ['Co-Authored-By: A <a@x>'] },
    });
    await runCommit(
      { ...args, body: 'The handler threw.', trailer: ['Refs: T7'], json: true },
      f.deps,
    );
    expect(f.committed[0]!.message).toBe(
      'fix(api): handle 404\n\nThe handler threw.\n\nCo-Authored-By: A <a@x>\nRefs: T7',
    );
  });

  it('under --dry-run --json prints one line with the plan and commits nothing', async () => {
    const f = fakes({ staged: ['src/a.ts'] });
    await runCommit({ ...args, dryRun: true, json: true }, f.deps);
    expect(f.out).toHaveLength(1);
    expect(JSON.parse(f.out[0]!)).toEqual({
      dryRun: true,
      commits: [
        {
          category: 'app',
          message: 'fix(api): handle 404',
          type: 'fix',
          scope: 'api',
          description: 'handle 404',
          files: ['src/a.ts'],
        },
      ],
    });
    expect(f.calls).not.toContain('commit');
  });

  it('keeps the given type on a fix/ branch and keeps no plan', async () => {
    const cache = memoryCache();
    const f = fakes({ staged: ['src/a.ts'], branch: 'fix/api/not-found', planCache: cache });
    await runCommit({ ...args, type: 'feat', dryRun: true, json: true }, f.deps);
    expect(JSON.parse(f.out[0]!).commits[0].message).toBe('feat(api): handle 404');
    expect(cache.store.size).toBe(0);
  });

  it('refuses without a label when the repository sets commitLabels, and commits nothing', async () => {
    const f = fakes({ staged: ['src/a.ts'], config: { commitLabels: true } });
    await expect(runCommit({ ...args, json: true }, f.deps)).rejects.toThrow(/--label is required/);
    expect(f.calls).not.toContain('commit');
  });

  it('refuses --message without --type and --scope, naming both', async () => {
    const f = fakes({ staged: ['src/a.ts'] });
    const run = runCommit({ message: 'handle 404', json: true }, f.deps);
    await expect(run).rejects.toThrow(/--type.*\n.*--scope/);
    expect(f.calls).not.toContain('commit');
  });

  it('refuses a commit style without `type(scope):` subjects, from the flag or the config', async () => {
    const cases: Array<[Record<string, unknown>, Record<string, unknown>]> = [
      [{ commitStyle: 'simple' }, {}],
      [{}, { commitStyle: 'gitmoji' }],
    ];
    for (const [flags, config] of cases) {
      const f = fakes({ staged: ['src/a.ts'], config });
      await expect(runCommit({ ...args, ...flags, json: true }, f.deps)).rejects.toThrow(
        /conventional or angular/,
      );
      expect(f.calls).toEqual([]);
    }
  });

  it('warns on stderr about a subject over 72 characters, and still commits', async () => {
    const f = fakes({ staged: ['src/a.ts'] });
    const message = 'handle the not found answer from the upstream directory service gracefully';
    await runCommit({ ...args, message, json: true }, f.deps);
    expect(plain(f.err)).toMatch(/subject is \d+ characters/);
    expect(f.committed).toHaveLength(1);
  });

  it('shows the labelled subject in the plan and in the committed line', async () => {
    const f = fakes({ staged: ['src/a.ts'] });
    await runCommit({ ...args, label: 'ABC-1' }, f.deps);
    const text = plain(f.out);
    expect(text).toMatch(
      /^ {2}ABC-1\n {4}app {2}\(1 files\)\n {6}ABC-1 fix\(api\): handle 404\n {6}src\/a\.ts$/m,
    );
    expect(text).toMatch(/✓ committed app: ABC-1 fix\(api\): handle 404 \(sha1\)/);
  });

  it('lists on stderr the staged files it left uncommitted', async () => {
    const f = fakes({ staged: ['src/a.ts', 'src/old.ts'] });
    await runCommit({ ...args, paths: ['src/a.ts'] }, f.deps);
    const err = plain(f.err).split('\n');
    const at = err.findIndex((l) => /left staged/.test(l));
    expect(at).toBeGreaterThanOrEqual(0);
    expect(err.slice(at + 1)).toEqual(['  src/old.ts']);
    expect(plain(f.out)).not.toMatch(/left staged/);
  });

  it('says nothing about leftovers when every staged file was committed', async () => {
    const f = fakes({ staged: ['src/a.ts'] });
    await runCommit({ ...args, json: true }, f.deps);
    expect(plain(f.err)).not.toMatch(/left staged/);
  });
});

describe('runCommit --input=json', () => {
  it('commits the body’s commits in planned order, code before tests, with labelled subjects in the outcome', async () => {
    const f = fakes({ stdin: twoCommits });
    await runCommit({ input: 'json', json: true }, f.deps);
    expect(subjects(f.committed)).toEqual([
      'WEDMODD-23444 fix(api): handle 404',
      'WEDMODD-23444 test(api): cover 404',
    ]);
    expect(f.committed.map((c) => c.files)).toEqual([['src/a.ts'], ['src/a.test.ts']]);
    const line = JSON.parse(f.out[0]!);
    expect(line.commits.map((c: { message: string }) => c.message)).toEqual(subjects(f.committed));
    expect(line.commits[0]).toEqual({
      category: 'app',
      message: 'WEDMODD-23444 fix(api): handle 404',
      label: 'WEDMODD-23444',
      type: 'fix',
      scope: 'api',
      description: 'handle 404',
      files: ['src/a.ts'],
      sha: 'sha1',
    });
    expect(f.calls).not.toContain('generate');
    expect(f.calls).not.toContain('ticket');
  });

  it('shows the plan grouped by label', async () => {
    const f = fakes({ stdin: twoCommits });
    await runCommit({ input: 'json', dryRun: true }, f.deps);
    expect(plain(f.out)).toMatch(
      /^ {2}WEDMODD-23444\n {4}app {2}\(1 files\)\n {6}WEDMODD-23444 fix\(api\): handle 404\n {6}src\/a\.ts\n {4}test/m,
    );
  });

  it('stops at a commit git refuses, naming it and the commits already made; stdout stays empty', async () => {
    const f = fakes({ stdin: twoCommits, failCommits: 1, failAfter: 1 });
    await expect(runCommit({ input: 'json', json: true }, f.deps)).rejects.toThrow(/refused/);
    const err = plain(f.err);
    expect(err).toMatch(
      /✗ failed to commit WEDMODD-23444 test\(api\): cover 404: pre-commit hook refused; already committed: sha1 WEDMODD-23444 fix\(api\): handle 404/,
    );
    expect(f.out).toEqual([]);
  });

  it('carries each commit body in the dry run outcome, so feeding it back keeps the body', async () => {
    const body = JSON.stringify({
      commits: [
        {
          type: 'fix',
          scope: 'api',
          description: 'handle 404',
          body: 'why it changed',
          files: ['src/a.ts'],
        },
      ],
    });
    const f = fakes({ stdin: body });
    await runCommit({ input: 'json', dryRun: true, json: true }, f.deps);
    expect(f.out).toHaveLength(1);
    const line = JSON.parse(f.out[0]!);
    expect(line.commits[0]).toMatchObject({
      message: 'fix(api): handle 404',
      body: 'why it changed',
    });

    expect(parseCommitInput(f.out[0]!)).toEqual([
      {
        type: 'fix',
        scope: 'api',
        description: 'handle 404',
        body: 'why it changed',
        paths: ['src/a.ts'],
      },
    ]);
  });

  it('reports the body of a committed commit, from args or the model, and no body key when a commit has none', async () => {
    const f = fakes({ staged: ['src/a.ts'] });
    await runCommit(
      { message: 'handle 404', type: 'fix', scope: 'api', body: 'why it changed', json: true },
      f.deps,
    );
    expect(JSON.parse(f.out[0]!).commits[0].body).toBe('why it changed');

    const g = fakes({ staged: ['src/a.ts'] });
    await runCommit({ message: 'handle 404', type: 'fix', scope: 'api', json: true }, g.deps);
    expect(JSON.parse(g.out[0]!).commits[0]).not.toHaveProperty('body');

    const m = fakes({
      staged: ['src/a.ts'],
      answer: (groups) => oneEach(groups).map((c) => ({ ...c, body: 'the model says why' })),
    });
    await runCommit({ json: true }, m.deps);
    expect(JSON.parse(m.out[0]!).commits[0].body).toBe('the model says why');
  });

  it('reads `files` from the repository root, from any directory, so a dry run fed back makes the same commits', async () => {
    const staged = ['apps/x/src/a.ts', 'apps/x/src/a.test.ts'];
    const body = JSON.stringify({
      commits: [
        { type: 'fix', scope: 'x', description: 'handle 404', files: ['apps/x/src/a.ts'] },
        { type: 'test', scope: 'x', description: 'cover 404', files: ['apps/x/src/a.test.ts'] },
      ],
    });
    const dry = fakes({ staged, cwd: '/repo/apps/x', stdin: body });
    await runCommit({ input: 'json', dryRun: true, json: true }, dry.deps);
    expect(JSON.parse(dry.out[0]!).commits.map((c: { files: string[] }) => c.files)).toEqual([
      ['apps/x/src/a.ts'],
      ['apps/x/src/a.test.ts'],
    ]);

    const f = fakes({ staged, cwd: '/repo/apps/x', stdin: dry.out[0]! });
    await runCommit({ input: 'json', json: true }, f.deps);
    expect(f.stagedFor.map((c) => c.fromDir)).toEqual([undefined]);
    expect(f.committed.map((c) => c.files)).toEqual([
      ['apps/x/src/a.ts'],
      ['apps/x/src/a.test.ts'],
    ]);
  });

  it('runs unattended without --json: no confirm prompt, since stdin is the body', async () => {
    const f = fakes({ stdin: twoCommits });
    f.deps.prompts.confirm = async () => {
      throw new Error('This step needs a terminal');
    };
    const result = await runCommit({ input: 'json' }, f.deps);
    expect(f.committed).toHaveLength(2);
    expect(result?.commits.map((c) => c.sha)).toEqual(['sha1', 'sha2']);
  });

  it('refuses an empty stdin with the stdin message', async () => {
    const f = fakes({ stdin: '' });
    await expect(runCommit({ input: 'json', json: true }, f.deps)).rejects.toThrow(
      /expected a JSON document on stdin/,
    );
    expect(f.calls).not.toContain('commit');
  });
});

describe('runCommit input selection', () => {
  it('refuses --message together with --input', async () => {
    const f = fakes({ stdin: twoCommits });
    await expect(
      runCommit({ input: 'json', message: 'x', type: 'fix', scope: 'api' }, f.deps),
    ).rejects.toThrow('pass --message or --input, not both');
    expect(f.calls).toEqual([]);
  });

  it('refuses --input=json at once when stdin is a terminal, without reading it', async () => {
    const f = fakes({ stdin: twoCommits, stdinIsTTY: true });
    await expect(runCommit({ input: 'json' }, f.deps)).rejects.toThrow(
      /expected a JSON document on stdin/,
    );
    expect(f.calls).toEqual([]);
  });

  it('refuses an --input format other than json', async () => {
    const f = fakes({ stdin: twoCommits });
    await expect(runCommit({ input: 'yaml' }, f.deps)).rejects.toThrow(/--input must be json/);
    expect(f.calls).toEqual([]);
  });

  it('refuses the per-commit flags with --input=json: the body carries them', async () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ label: 'ABC-1' }, '--label'],
      [{ type: 'fix' }, '--type'],
      [{ scope: 'api' }, '--scope'],
      [{ body: 'why' }, '--body'],
      [{ paths: ['src/a.ts'] }, 'paths after --'],
    ];
    for (const [o, flag] of cases) {
      const f = fakes({ stdin: twoCommits });
      await expect(runCommit({ input: 'json', ...o }, f.deps)).rejects.toThrow(flag);
      expect(f.calls).toEqual([]);
    }
  });

  it('refuses --body and paths without --message', async () => {
    for (const o of [{ body: 'why' }, { paths: ['src/a.ts'] }]) {
      const f = fakes();
      await expect(runCommit(o, f.deps)).rejects.toThrow(/--message/);
      expect(f.calls).toEqual([]);
    }
  });

  it('accepts --label on an interactive run', async () => {
    const f = fakes();
    await runCommit({ label: 'ABC-1', json: true }, f.deps);
    expect(f.calls).toContain('generate');
    expect(f.committed).toHaveLength(2);
  });
});

describe('runCommit shows what it commits', () => {
  /** A kept plan that carries its label, as a dry run with labels leaves it: read whatever the key. */
  const keptPlan = (): PlanCache => ({
    read: async () => [
      { category: 'app', label: 'ABC-1', message: 'Update app', files: ['src/a.ts'] },
    ],
    write: async () => undefined,
    clear: async () => undefined,
  });

  it('prints the labelled subject in the plan and the committed line, and takes the label from the plan', async () => {
    const f = fakes({ staged: ['src/a.ts'], planCache: keptPlan() });
    await runCommit({}, f.deps);
    const text = plain(f.out);
    expect(text).toMatch(/^ {4}ABC-1 Update app$/m);
    expect(text).toMatch(/✓ committed app: ABC-1 Update app \(sha1\)/);

    const g = fakes({ staged: ['src/a.ts'], planCache: keptPlan() });
    await runCommit({ json: true }, g.deps);
    expect(JSON.parse(g.out[0]!).commits[0]).toMatchObject({
      message: 'ABC-1 Update app',
      label: 'ABC-1',
    });
  });
});

describe('runCommit ignores a label in the model’s answer', () => {
  /** The model answers with a `label` key of its own: pritty labels commits, the model never does. */
  const stray: Answer = (groups) =>
    oneEach(groups).map((c) => ({ ...c, change: 'login', label: 'oops label' }));

  it('with commitLabels off, commits unlabelled subjects', async () => {
    const f = fakes({ answer: stray });
    await runCommit({ json: true }, f.deps);
    expect(subjects(f.committed)).toEqual(['feat: app', 'feat: test']);
    const { commits } = JSON.parse(f.out[0]!);
    expect(commits[0]).toMatchObject({ message: 'feat: app', type: 'feat', description: 'app' });
    expect(commits[0]).not.toHaveProperty('label');
  });

  it("with commitLabels on, labels from the model's change name", async () => {
    const f = fakes({ answer: stray, config: { commitLabels: true } });
    await runCommit({ json: true }, f.deps);
    expect(subjects(f.committed)).toEqual(['LOGIN feat: app', 'LOGIN feat: test']);
  });

  it('with --label, puts that label on every subject', async () => {
    const f = fakes({ answer: stray });
    await runCommit({ json: true, label: 'abc-1' }, f.deps);
    expect(subjects(f.committed)).toEqual(['ABC-1 feat: app', 'ABC-1 feat: test']);
  });
});

describe('runCommit labels on the model path', () => {
  const labelsOn = { commitLabels: true };
  const QUESTION =
    "Label for these commits (Jira ticket or effort name, Enter for the model's names):";
  const named =
    (change: string): Answer =>
    (groups) =>
      oneEach(groups).map((c) => ({ ...c, change }));
  const generations = (calls: string[]) => calls.filter((c) => c === 'generate').length;

  it('asks for a label when attended with no ticket, and puts the answer on every subject', async () => {
    const f = fakes({ config: labelsOn, inputs: ['wedmodd-23444'] });
    await runCommit({}, f.deps);
    expect(f.asked).toEqual([QUESTION]);
    expect(subjects(f.committed)).toEqual(['WEDMODD-23444 feat: app', 'WEDMODD-23444 feat: test']);
    expect(f.generated[0]?.labels).toBe(false);
  });

  it("takes the model's change name when the answer is blank", async () => {
    const f = fakes({ config: labelsOn, inputs: [''], answer: named('login rate limit') });
    await runCommit({}, f.deps);
    expect(f.asked).toEqual([QUESTION]);
    expect(subjects(f.committed)).toEqual([
      'LOGIN-RATE-LIMIT feat: app',
      'LOGIN-RATE-LIMIT feat: test',
    ]);
    expect(f.generated[0]?.labels).toBe(true);
  });

  it('never asks when unattended, and labels from the model', async () => {
    for (const options of [{ json: true }, { autoApprove: true }]) {
      const f = fakes({ config: labelsOn, answer: named('login rate limit') });
      await runCommit(options, f.deps);
      expect(f.calls).not.toContain('input');
      expect(subjects(f.committed)).toEqual([
        'LOGIN-RATE-LIMIT feat: app',
        'LOGIN-RATE-LIMIT feat: test',
      ]);
    }
  });

  it("gives every commit of a category-grouped plan the model's one name for the run", async () => {
    const f = fakes({
      config: { ...labelsOn, commitGrouping: 'category' },
      answer: named('login rate limit'),
    });
    await runCommit({ json: true }, f.deps);
    expect(f.generated[0]?.labels).toBe(true);
    const { commits } = JSON.parse(f.out[0]!);
    expect(commits.map((c: { message: string }) => c.message)).toEqual([
      'LOGIN-RATE-LIMIT feat: app',
      'LOGIN-RATE-LIMIT feat: test',
    ]);
    expect(commits[0]).toMatchObject({ label: 'LOGIN-RATE-LIMIT', type: 'feat' });
    expect(commits[0]).not.toHaveProperty('change');
  });

  it('labels every commit with the detected ticket and asks nothing', async () => {
    const f = fakes({ config: labelsOn, ticket: 'ABC-9', answer: named('login rate limit') });
    await runCommit({}, f.deps);
    expect(f.calls).not.toContain('input');
    expect(subjects(f.committed)).toEqual(['ABC-9 feat: app', 'ABC-9 feat: test']);
    expect(f.generated[0]?.labels).toBe(false);
  });

  it('puts --label on every subject, ahead of the ticket, without asking', async () => {
    const f = fakes({ config: labelsOn, ticket: 'ABC-9' });
    await runCommit({ label: 'wedmodd 1' }, f.deps);
    expect(f.calls).not.toContain('input');
    expect(subjects(f.committed)).toEqual(['WEDMODD-1 feat: app', 'WEDMODD-1 feat: test']);
  });

  it('with commitLabels off, asks nothing and leaves the subjects unlabelled', async () => {
    const f = fakes({ ticket: 'ABC-9', answer: named('login rate limit') });
    await runCommit({}, f.deps);
    expect(f.calls).not.toContain('input');
    expect(subjects(f.committed)).toEqual(['feat: app', 'feat: test']);
    expect(f.generated[0]?.labels).toBe(false);
  });

  it('with commitLabels off, still puts --label on every subject', async () => {
    const f = fakes({ answer: named('login rate limit') });
    await runCommit({ label: 'foo' }, f.deps);
    expect(f.calls).not.toContain('input');
    expect(subjects(f.committed)).toEqual(['FOO feat: app', 'FOO feat: test']);
  });

  it('explains an answer it cannot use and asks again', async () => {
    const f = fakes({ config: labelsOn, inputs: ['status/logging', 'status logging'] });
    await runCommit({}, f.deps);
    expect(f.asked).toEqual([QUESTION, QUESTION]);
    expect(plain(f.out)).toMatch(/can hold only letters, digits and single hyphens \(found "\/"\)/);
    expect(subjects(f.committed)).toEqual([
      'STATUS-LOGGING feat: app',
      'STATUS-LOGGING feat: test',
    ]);
  });

  it('refuses a --label it cannot use, or a style without types, before anything runs', async () => {
    for (const options of [
      { label: 'a_b' },
      { label: 'ABC-1', commitStyle: 'simple' },
      { label: 'ABC-1', commitStyle: 'gitmoji' },
    ]) {
      const f = fakes({ config: labelsOn });
      await expect(runCommit({ ...options, json: true }, f.deps)).rejects.toThrow(/--label/);
      expect(f.calls).toEqual([]);
    }
  });

  it('commits the labels a dry run showed, without asking again', async () => {
    const f = fakes({ config: labelsOn, inputs: ['abc-1'], planCache: memoryCache() });
    await runCommit({ dryRun: true }, f.deps);
    await runCommit({}, f.deps);
    expect(f.asked).toHaveLength(1);
    expect(generations(f.calls)).toBe(1);
    expect(subjects(f.committed)).toEqual(['ABC-1 feat: app', 'ABC-1 feat: test']);
  });

  it('does not reuse a dry run made with another --label', async () => {
    const f = fakes({ config: labelsOn, answer: named('login'), planCache: memoryCache() });
    await runCommit({ json: true, dryRun: true }, f.deps);
    await runCommit({ json: true, label: 'abc-1' }, f.deps);
    expect(generations(f.calls)).toBe(2);
    expect(subjects(f.committed)).toEqual(['ABC-1 feat: app', 'ABC-1 feat: test']);
  });

  describe('a ticket-shaped answer', () => {
    const tracked = (ticket: Record<string, unknown> = {}) => ({
      ...labelsOn,
      ticket: { pattern: 'WEDMODD-\\d+', validation: { type: 'jira-cli' }, ...ticket },
    });

    it('is looked up; a ticket the tracker does not know is a warning', async () => {
      const f = fakes({
        config: tracked(),
        inputs: ['wedmodd-23444'],
        lookup: () => ({ exists: false }),
      });
      await runCommit({}, f.deps);
      expect(f.calls).toContain('lookup WEDMODD-23444');
      expect(plain(f.out)).toMatch(/WEDMODD-23444 not found in jira-cli; proceeding anyway/);
      expect(subjects(f.committed)[0]).toBe('WEDMODD-23444 feat: app');
    });

    it('is refused when the tracker does not know it under validateStrict, before the model is asked', async () => {
      const f = fakes({
        config: tracked({ validateStrict: true }),
        inputs: ['wedmodd-23444'],
        lookup: () => ({ exists: false, error: 'no such issue' }),
      });
      await expect(runCommit({}, f.deps)).rejects.toThrow(
        /WEDMODD-23444 not found in jira-cli: no such issue/,
      );
      expect(f.calls).not.toContain('generate');
      expect(f.committed).toEqual([]);
    });

    it('is used as typed when the tracker cannot be reached', async () => {
      const f = fakes({ config: tracked({ validateStrict: true }), inputs: ['wedmodd-23444'] });
      await runCommit({}, f.deps);
      expect(plain(f.out)).toMatch(/couldn't verify WEDMODD-23444 via jira-cli/);
      expect(subjects(f.committed)[0]).toBe('WEDMODD-23444 feat: app');
    });

    it('is not looked up when it does not match the ticket pattern', async () => {
      const f = fakes({ config: tracked(), inputs: ['status logging'] });
      await runCommit({}, f.deps);
      expect(f.calls.filter((c) => c.startsWith('lookup'))).toEqual([]);
      expect(subjects(f.committed)[0]).toBe('STATUS-LOGGING feat: app');
    });
  });
});
