import { describe, expect, it } from 'vitest';
import { ConfigSchema } from '../config.js';
import type { GitOps } from '../git.js';
import { type CommitDeps, runCommit } from './commit.js';

function fakes(o: { staged?: string[]; config?: Record<string, unknown> } = {}) {
  const calls: string[] = [];
  const committed: Array<{ message: string; files: string[] }> = [];
  let sha = 0;
  const git = {
    getCurrentBranch: async () => 'feature/x',
    getStaged: async () => o.staged ?? ['src/a.ts', 'src/a.test.ts'],
    getStagedDiff: async () => '+a',
    commit: async (message: string, files?: string[]) => {
      calls.push('commit');
      committed.push({ message, files: files ?? [] });
    },
    headSha: async () => `sha${++sha}`,
  } as unknown as GitOps;
  const out: string[] = [];
  const err: string[] = [];
  const deps: CommitDeps = {
    git,
    config: ConfigSchema.parse(o.config ?? {}),
    ai: {
      generateCommitMessages: async (groups) => {
        calls.push('generate');
        return Object.entries(groups)
          .filter(([, files]) => files.length > 0)
          .map(([category, files]) => ({ category, message: `feat: ${category}`, files }));
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
  };
  return { deps, calls, committed, out, err };
}

describe('runCommit --json', () => {
  it('prints one JSON line with the commits made, everything else on stderr, and asks nothing', async () => {
    const f = fakes();
    const result = await runCommit({ json: true }, f.deps);
    expect(f.out).toHaveLength(1);
    const line = JSON.parse(f.out[0]!);
    expect(line).toEqual({
      dryRun: false,
      commits: [
        { category: 'test', message: 'feat: test', files: ['src/a.test.ts'], sha: 'sha1' },
        { category: 'app', message: 'feat: app', files: ['src/a.ts'], sha: 'sha2' },
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
