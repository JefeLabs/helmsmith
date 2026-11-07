import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { commitFile, gitIn, write } from '../../src/testing/repo.js';
import {
  head,
  installFakeClaude,
  jsonLine,
  makeRepo,
  makeSandbox,
  runCli,
  type Sandbox,
} from './helpers.js';

let sb: Sandbox | undefined;
afterEach(() => {
  sb?.cleanup();
  sb = undefined;
});

/** Leaf command paths (`['auth', 'login']`, `['commit']`, …) read from `--help`, so a new command is covered without editing this list. */
async function leafCommands(s: Sandbox, path: string[] = []): Promise<string[][]> {
  const r = await runCli(s, s.root, [...path, '--help']);
  const section = r.stdout.split(/^Commands:$/m)[1];
  if (!section) return [path];
  const names = [...section.matchAll(/^ {2}(\S+)/gm)].map((m) => m[1]!).filter((n) => n !== 'help');
  const leaves: string[][] = [];
  for (const name of names) leaves.push(...(await leafCommands(s, [...path, name])));
  return leaves;
}

describe('--json everywhere', () => {
  it('every command accepts --json', async () => {
    sb = makeSandbox();
    const leaves = await leafCommands(sb);
    expect(leaves.length).toBeGreaterThanOrEqual(10);
    for (const cmd of leaves) {
      const r = await runCli(sb, sb.root, [...cmd, '--help']);
      expect(r.stdout, cmd.join(' ')).toMatch(/^\s+--json\b/m);
    }
  });
});

describe('cache --json', () => {
  it('cache path prints { path }', async () => {
    sb = makeSandbox();
    const r = await runCli(sb, sb.root, ['cache', 'path', '--json']);
    expect(r.exitCode, r.stderr).toBe(0);
    expect(jsonLine(r)).toEqual({ path: join(sb.prittyHome, 'cache.json') });
  });

  it('cache clear prints { path, removed } and says whether there was a file', async () => {
    sb = makeSandbox();
    const cacheFile = join(sb.prittyHome, 'cache.json');
    mkdirSync(sb.prittyHome, { recursive: true });
    writeFileSync(cacheFile, `${JSON.stringify({ version: 1, tickets: {} })}\n`);

    const first = await runCli(sb, sb.root, ['cache', 'clear', '--json']);
    expect(first.exitCode, first.stderr).toBe(0);
    expect(jsonLine(first)).toEqual({ path: cacheFile, removed: true });
    expect(existsSync(cacheFile)).toBe(false);

    const again = await runCli(sb, sb.root, ['cache', 'clear', '--json']);
    expect(jsonLine(again)).toEqual({ path: cacheFile, removed: false });
  });
});

describe('auth --json', () => {
  it('auth status lists providers without the token; auth logout reports what it removed', async () => {
    sb = makeSandbox();
    const authFile = join(sb.prittyHome, 'auth.json');

    const empty = await runCli(sb, sb.root, ['auth', 'status', '--json']);
    expect(empty.exitCode, empty.stderr).toBe(0);
    expect(jsonLine(empty)).toEqual({ providers: [] });

    // Assembled at runtime so no token-shaped literal sits in the source.
    const token = ['gho', `e2e${'0'.repeat(33)}`].join('_');
    mkdirSync(sb.prittyHome, { recursive: true });
    writeFileSync(
      authFile,
      JSON.stringify({
        version: 1,
        providers: {
          'github-copilot': {
            apiKey: token,
            scope: 'read:user',
            createdAt: '2026-10-23T00:00:00.000Z',
          },
        },
      }),
    );
    const status = await runCli(sb, sb.root, ['auth', 'status', '--json']);
    expect(status.exitCode, status.stderr).toBe(0);
    expect(jsonLine(status)).toEqual({
      providers: [
        {
          id: 'github-copilot',
          scope: 'read:user',
          createdAt: '2026-10-23T00:00:00.000Z',
          expiresAt: null,
        },
      ],
    });
    expect(status.stdout + status.stderr).not.toContain(token);

    const logout = await runCli(sb, sb.root, ['auth', 'logout', '--json']);
    expect(logout.exitCode, logout.stderr).toBe(0);
    expect(jsonLine(logout)).toEqual({ path: authFile, removed: true });
    expect(existsSync(authFile)).toBe(false);

    const again = await runCli(sb, sb.root, ['auth', 'logout', '--json']);
    expect(jsonLine(again)).toEqual({ path: authFile, removed: false });
  });
});

describe('categorize --json', () => {
  it('prints { all, categories: [{ category, files }] }, leaving out empty categories', async () => {
    sb = makeSandbox();
    const repo = makeRepo(sb, { config: { categories: { docs: ['docs/**'] } } });
    write(repo, 'docs/guide.md', '# guide\n');
    write(repo, 'src/app.ts', 'export const a = 1;\n');
    write(repo, 'notes.txt', 'not staged\n');
    gitIn(repo, 'add', 'docs/guide.md', 'src/app.ts');

    const staged = await runCli(sb, repo, ['categorize', '--json']);
    expect(staged.exitCode, staged.stderr).toBe(0);
    const out = jsonLine<{ all: boolean; categories: { category: string; files: string[] }[] }>(
      staged,
    );
    expect(out.all).toBe(false);
    expect(out.categories).toEqual(
      expect.arrayContaining([
        { category: 'docs', files: ['docs/guide.md'] },
        { category: 'app', files: ['src/app.ts'] },
      ]),
    );
    expect(out.categories).toHaveLength(2);

    const all = await runCli(sb, repo, ['categorize', '--all', '--json']);
    const everything = jsonLine<typeof out>(all);
    expect(everything.all).toBe(true);
    expect(everything.categories).toContainEqual({ category: 'unknown', files: ['notes.txt'] });
  });

  it('prints an empty list when nothing is staged', async () => {
    sb = makeSandbox();
    const repo = makeRepo(sb);
    const r = await runCli(sb, repo, ['categorize', '--json']);
    expect(r.exitCode, r.stderr).toBe(0);
    expect(jsonLine(r)).toEqual({ all: false, categories: [] });
  });
});

describe('init --json', () => {
  it('prints { written, skipped, gitRepo } and never asks about shell aliases', async () => {
    sb = makeSandbox();
    const repo = makeRepo(sb);
    // A shell pritty recognizes: without --json, init would prompt (and fail on closed stdin).
    const env = { SHELL: '/bin/zsh' };

    const first = await runCli(sb, repo, ['init', '--json'], { env });
    expect(first.exitCode, first.stderr).toBe(0);
    const out = jsonLine<{ written: string[]; skipped: string[]; gitRepo: boolean }>(first);
    expect(out.gitRepo).toBe(true);
    expect(out.skipped).toEqual([]);
    expect(out.written).toContain(join(repo, '.pritty.json'));
    expect(out.written).toContain(join(repo, '.claude', 'skills', 'pritty', 'SKILL.md'));
    expect(existsSync(join(sb.home, '.zshrc'))).toBe(false);

    const again = await runCli(sb, repo, ['init', '--json'], { env });
    const second = jsonLine<typeof out>(again);
    expect(second.written).toEqual([]);
    expect([...second.skipped].sort()).toEqual([...out.written].sort());
  });

  it('reports gitRepo: false outside a repository', async () => {
    sb = makeSandbox();
    const dir = join(sb.root, 'plain');
    mkdirSync(dir);
    const r = await runCli(sb, dir, ['init', '--json']);
    expect(r.exitCode, r.stderr).toBe(0);
    expect(jsonLine(r)).toEqual({
      written: [join(dir, '.pritty.json')],
      skipped: [],
      gitRepo: false,
    });
  });
});

describe('rebase --json', () => {
  /** `feat/greet`, two commits ahead of main. */
  function featureBranch(s: Sandbox): { repo: string; oldest: string; newest: string } {
    const repo = makeRepo(s, { config: { provider: 'claude' } });
    gitIn(repo, 'checkout', '-q', '-b', 'feat/greet');
    commitFile(repo, 'src/greet.ts', 'export const greet = () => "helo";\n', 'feat: add greet');
    commitFile(repo, 'src/greet.ts', 'export const greet = () => "hello";\n', 'fix typo');
    const [newest, oldest] = gitIn(repo, 'log', '--format=%H', '-2').trim().split('\n');
    return { repo, oldest: oldest!, newest: newest! };
  }

  it('--dry-run prints the plan as one line and leaves the branch alone', async () => {
    sb = makeSandbox();
    const { repo, oldest, newest } = featureBranch(sb);
    installFakeClaude(sb).answer(
      JSON.stringify({
        steps: [
          { hash: oldest, action: 'pick' },
          { hash: newest, action: 'fixup', rationale: 'typo fix' },
        ],
        summary: 'fold the typo fix into the feature',
      }),
    );
    const before = head(repo);

    const r = await runCli(sb, repo, [
      'rebase',
      '--dry-run',
      '--json',
      '--base',
      'main',
      '--strategy',
      'auto',
    ]);
    expect(r.exitCode, r.stderr).toBe(0);
    expect(jsonLine(r)).toEqual({
      dryRun: true,
      branch: 'feat/greet',
      base: 'main',
      strategy: 'auto',
      commits: [
        { hash: oldest, subject: 'feat: add greet' },
        { hash: newest, subject: 'fix typo' },
      ],
      steps: [
        { hash: oldest, action: 'pick' },
        { hash: newest, action: 'fixup', rationale: 'typo fix' },
      ],
      summary: 'fold the typo fix into the feature',
      rebased: false,
    });
    expect(head(repo)).toBe(before);
  });

  it('prints an empty plan when there is nothing to consolidate, without calling the model', async () => {
    sb = makeSandbox();
    const repo = makeRepo(sb, { config: { provider: 'claude' } });
    gitIn(repo, 'checkout', '-q', '-b', 'feat/one');
    commitFile(repo, 'a.ts', 'export {};\n', 'feat: a');
    const fake = installFakeClaude(sb);

    const r = await runCli(sb, repo, ['rebase', '--dry-run', '--json', '--base', 'main']);
    expect(r.exitCode, r.stderr).toBe(0);
    expect(jsonLine(r)).toMatchObject({
      dryRun: true,
      branch: 'feat/one',
      base: 'main',
      steps: [],
      summary: null,
      rebased: false,
    });
    expect(fake.calls()).toHaveLength(0);
  });
});
