import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { makeRepo, makeSandbox, runCli, type Sandbox } from './helpers.js';

let sb: Sandbox | undefined;
afterEach(() => {
  sb?.cleanup();
  sb = undefined;
});

const STARTER = { provider: 'copilot', commitStyle: 'conventional' };

const INTEGRATION_FILES = [
  '.pritty.json',
  '.claude/commands/commit.md',
  '.claude/commands/pr.md',
  '.claude/skills/pritty/SKILL.md',
  '.github/prompts/commit.prompt.md',
  '.github/prompts/pr.prompt.md',
];

/** The closing "N written, M skipped" line. */
function tally(out: string): { written: number; skipped: number } {
  const m = out.match(/(\d+) written, (\d+) skipped/);
  if (!m) throw new Error(`no tally in:\n${out}`);
  return { written: Number(m[1]), skipped: Number(m[2]) };
}

describe('pritty init', () => {
  it('writes the starter config and the Claude Code / Copilot files, then leaves them alone unless --force', async () => {
    sb = makeSandbox();
    const repo = makeRepo(sb);
    const config = join(repo, '.pritty.json');

    const first = await runCli(sb, repo, ['init', '--no-aliases']);
    expect(first.exitCode).toBe(0);
    for (const f of INTEGRATION_FILES) expect(existsSync(join(repo, f)), f).toBe(true);
    expect(JSON.parse(readFileSync(config, 'utf8'))).toEqual(STARTER);
    expect(tally(first.stdout)).toEqual({ written: INTEGRATION_FILES.length, skipped: 0 });

    writeFileSync(config, '{"provider":"claude"}\n');
    const again = await runCli(sb, repo, ['init', '--no-aliases']);
    expect(again.exitCode).toBe(0);
    expect(tally(again.stdout)).toEqual({ written: 0, skipped: INTEGRATION_FILES.length });
    expect(readFileSync(config, 'utf8')).toBe('{"provider":"claude"}\n');

    const forced = await runCli(sb, repo, ['init', '--no-aliases', '--force']);
    expect(forced.exitCode).toBe(0);
    expect(tally(forced.stdout)).toEqual({ written: INTEGRATION_FILES.length, skipped: 0 });
    expect(JSON.parse(readFileSync(config, 'utf8'))).toEqual(STARTER);
  });

  it('writes only .pritty.json outside a git repository', async () => {
    sb = makeSandbox();
    const dir = join(sb.root, 'plain');
    mkdirSync(dir);
    const r = await runCli(sb, dir, ['init', '--no-aliases']);
    expect(r.exitCode).toBe(0);
    expect(readdirSync(dir)).toEqual(['.pritty.json']);
    expect(r.stdout).toContain('Not a git repository');
  });
});
