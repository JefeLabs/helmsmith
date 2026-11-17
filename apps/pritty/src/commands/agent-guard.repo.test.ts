import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { commitFile, gitIn, makeRepo } from '../testing/repo.js';
import { judgeHookPayload } from './agent-guard.js';

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

const write = (cwd: string, file_path: string) =>
  judgeHookPayload(JSON.stringify({ tool_name: 'Write', tool_input: { file_path }, cwd }));
const bash = (cwd: string, command: string) =>
  judgeHookPayload(JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd }));

describe('agent-guard in a real repository', () => {
  it('allows Write inside .git/pritty and refuses elsewhere, including through symlinks', () => {
    const repo = makeRepo();
    cleanups.push(repo.cleanup);
    expect(write(repo.dir, join(repo.dir, '.git/pritty/plan.json'))).toEqual({ allow: true });
    expect(write(repo.dir, '.git/pritty/plan.json')).toEqual({ allow: true });
    expect(write(repo.dir, join(repo.dir, 'src/a.ts')).allow).toBe(false);
    expect(write(repo.dir, join(repo.dir, '.git/config')).allow).toBe(false);

    mkdirSync(join(repo.dir, '.git/pritty'), { recursive: true });
    const outside = mkdtempSync(join(tmpdir(), 'pritty-outside-'));
    cleanups.push(() => rmSync(outside, { recursive: true, force: true }));
    symlinkSync(outside, join(repo.dir, '.git/pritty/link'));
    symlinkSync(join(outside, 'missing'), join(repo.dir, '.git/pritty/dangling'));
    expect(write(repo.dir, join(repo.dir, '.git/pritty/link/x.json')).allow).toBe(false);
    expect(write(repo.dir, join(repo.dir, '.git/pritty/dangling')).allow).toBe(false);
  });

  it('refuses outside a repository', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pritty-norepo-'));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    expect(write(dir, join(dir, '.git/pritty/x')).allow).toBe(false);
  });

  it('uses the worktree-aware scratch dir in a linked worktree', () => {
    const repo = makeRepo();
    cleanups.push(repo.cleanup);
    const wt = join(mkdtempSync(join(tmpdir(), 'pritty-wt-')), 'wt');
    cleanups.push(() => rmSync(join(wt, '..'), { recursive: true, force: true }));
    gitIn(repo.dir, 'worktree', 'add', '-q', '-b', 'side', wt);
    const scratch = gitIn(wt, 'rev-parse', '--path-format=absolute', '--git-path', 'pritty').trim();
    expect(scratch).toContain('/worktrees/');
    expect(write(wt, join(scratch, 'plan.json'))).toEqual({ allow: true });
    expect(write(wt, join(wt, '.git/pritty/plan.json')).allow).toBe(false);
    expect(write(wt, join(wt, 'src/a.ts')).allow).toBe(false);
    expect(
      bash(wt, `pritty commit --input=json --dry-run --output=json < ${scratch}/plan.json`),
    ).toEqual({ allow: true });
  });

  it.each(['My Projects', 'josé'])(
    'allows a double-quoted redirect from a scratch dir under %j, also in a linked worktree',
    (name) => {
      const parent = mkdtempSync(join(tmpdir(), 'pritty-name-'));
      cleanups.push(() => rmSync(parent, { recursive: true, force: true }));
      const main = join(parent, name, 'main');
      mkdirSync(main, { recursive: true });
      gitIn(main, 'init', '-q', '-b', 'main');
      commitFile(main, 'README.md', 'hello\n', 'init');
      const wt = join(parent, name, 'wt');
      gitIn(main, 'worktree', 'add', '-q', '-b', 'side', wt);

      for (const cwd of [main, wt]) {
        const scratch = gitIn(
          cwd,
          'rev-parse',
          '--path-format=absolute',
          '--git-path',
          'pritty',
        ).trim();
        expect(scratch).toContain(name);
        expect(
          bash(cwd, `pritty commit --input=json --dry-run --output=json < "${scratch}/plan.json"`),
        ).toEqual({ allow: true });
        expect(
          bash(cwd, `pritty commit --input=json --dry-run --output=json < ${scratch}/plan.json`)
            .allow,
        ).toBe(false);
        expect(bash(cwd, `pritty commit --input=json < "${join(cwd, 'plan.json')}"`).allow).toBe(
          false,
        );
        expect(write(cwd, join(scratch, 'plan.json'))).toEqual({ allow: true });
      }
    },
  );
});
