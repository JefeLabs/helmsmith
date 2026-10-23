import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { gitIn, write } from '../../src/testing/repo.js';
import { makeRepo, makeSandbox, runCli, type Sandbox } from './helpers.js';

let sb: Sandbox | undefined;
afterEach(() => {
  sb?.cleanup();
  sb = undefined;
});

/** `categorize` output → { category: files }. */
function sections(out: string): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  let current: string | undefined;
  for (const line of out.split('\n')) {
    const heading = line.match(/^(\S+)\s+\(\d+\)$/);
    if (heading) {
      current = heading[1]!;
      result[current] = [];
    } else if (current && line.startsWith('  ')) {
      result[current]!.push(line.trim());
    }
  }
  return result;
}

describe('pritty CLI', () => {
  it('lists every command in --help', async () => {
    sb = makeSandbox();
    const r = await runCli(sb, sb.root, ['--help']);
    expect(r.exitCode).toBe(0);
    for (const cmd of ['auth', 'init', 'categorize', 'cache', 'commit', 'pr', 'rebase']) {
      expect(r.stdout, cmd).toMatch(new RegExp(`^\\s+${cmd}\\b`, 'm'));
    }
  });

  it('exits non-zero on an unknown command', async () => {
    sb = makeSandbox();
    const r = await runCli(sb, sb.root, ['frobnicate']);
    expect(r.exitCode).not.toBe(0);
    expect(r.stderr).toMatch(/unknown command/i);
  });
});

describe('pritty categorize', () => {
  it("groups staged files using the repository's .pritty.json, found from a subdirectory", async () => {
    sb = makeSandbox();
    const repo = makeRepo(sb, { config: { categories: { docs: ['docs/**'] } } });
    write(repo, 'docs/guide.md', '# guide\n');
    write(repo, 'src/app.ts', 'export const a = 1;\n');
    write(repo, 'src/app.test.ts', 'it.todo("a");\n');
    write(repo, 'notes.txt', 'not staged\n');
    gitIn(repo, 'add', 'docs/guide.md', 'src/app.ts', 'src/app.test.ts');

    const staged = await runCli(sb, join(repo, 'src'), ['categorize']);
    expect(staged.exitCode).toBe(0);
    expect(sections(staged.stdout)).toEqual({
      docs: ['docs/guide.md'],
      test: ['src/app.test.ts'],
      app: ['src/app.ts'],
    });

    const all = await runCli(sb, join(repo, 'src'), ['categorize', '--all']);
    expect(sections(all.stdout).unknown).toEqual(['notes.txt']);
  });
});

describe('pritty pr, before it reaches GitHub', () => {
  it('fails clearly without an origin remote', async () => {
    sb = makeSandbox();
    const repo = makeRepo(sb);
    gitIn(repo, 'checkout', '-q', '-b', 'feat/x');
    const r = await runCli(sb, repo, ['pr', '--base', 'main', '--title', 't', '--body', 'b']);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('No `origin` remote configured');
  });

  it('fails before pushing anything when no GitHub token is available', async () => {
    sb = makeSandbox();
    const repo = makeRepo(sb);
    // A GitHub origin for the URL check, but pushes would land in a local bare repo.
    const pushTarget = mkdtempSync(join(sb.root, 'push-'));
    gitIn(pushTarget, 'init', '-q', '--bare');
    gitIn(repo, 'remote', 'add', 'origin', 'https://github.com/acme/widget.git');
    gitIn(repo, 'remote', 'set-url', '--push', 'origin', pushTarget);
    gitIn(repo, 'checkout', '-q', '-b', 'feat/x');
    write(repo, 'src/x.ts', 'export {};\n');
    gitIn(repo, 'add', '-A');
    gitIn(repo, 'commit', '-q', '-m', 'feat: x');

    const r = await runCli(sb, repo, ['pr', '--base', 'main', '--title', 't', '--body', 'b']);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('No GitHub token available');
    expect(gitIn(pushTarget, 'for-each-ref').trim()).toBe('');
  });
});
