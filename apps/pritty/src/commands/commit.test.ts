import { describe, expect, it } from 'vitest';
import type { CommitMessage } from '../ai.js';
import { ConfigSchema } from '../config.js';
import type { GitOps } from '../git.js';
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
  } = {},
) {
  const calls: string[] = [];
  const committed: Array<{ message: string; files: string[]; noVerify: boolean }> = [];
  const generated: Array<{ branch?: string }> = [];
  let sha = 0;
  let failures = o.failCommits ?? 0;
  const state = { staged: 'tree1' as string | null, answer: o.answer ?? oneEach };
  const git = {
    getCurrentBranch: async () => o.branch ?? 'feature/x',
    getStaged: async () => o.staged ?? ['src/a.ts', 'src/a.test.ts'],
    getStagedDiff: async () => '+a',
    stagedState: async () => state.staged,
    commit: async (message: string, files?: string[], opts?: { noVerify?: boolean }) => {
      calls.push('commit');
      if (failures > 0) {
        failures--;
        throw new Error('pre-commit hook refused');
      }
      committed.push({ message, files: files ?? [], noVerify: Boolean(opts?.noVerify) });
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
        generated.push({ branch: context?.branch });
        return state.answer(groups);
      },
    },
    ticket: async () => undefined,
    prompts: {
      confirm: async () => {
        calls.push('confirm');
        return true;
      },
      editor: async (d) => d.default ?? '',
    },
    io: { out: (l) => out.push(l), err: (l) => err.push(l) },
    ...(o.planCache ? { planCache: o.planCache } : {}),
  };
  return { deps, calls, committed, generated, out, err, state };
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
        { category: 'app', message: 'feat: app', files: ['src/a.ts'], sha: 'sha1' },
        { category: 'test', message: 'feat: test', files: ['src/a.test.ts'], sha: 'sha2' },
      ],
    });
    expect(f.err.length).toBeGreaterThan(0);
    expect(f.calls).not.toContain('confirm');
    expect(result?.commits).toHaveLength(2);
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
    expect(f.generated).toEqual([{ branch: 'fix/family/my-profile--phone-kenya' }]);
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
