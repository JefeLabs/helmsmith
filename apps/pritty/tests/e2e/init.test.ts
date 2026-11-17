import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { jsonLine, makeRepo, makeSandbox, runCli, type Sandbox } from './helpers.js';

let sb: Sandbox | undefined;
afterEach(() => {
  sb?.cleanup();
  sb = undefined;
});

const STARTER = { provider: 'claude', commitStyle: 'conventional' };

const INTEGRATION_FILES = [
  '.pritty.json',
  '.claude/commands/commit.md',
  '.claude/commands/pr.md',
  '.claude/skills/pritty/SKILL.md',
  '.claude/agents/pritty.md',
  'AGENTS.md',
  '.github/prompts/commit.prompt.md',
  '.github/prompts/pr.prompt.md',
];

interface InitJson {
  written: string[];
  skipped: string[];
}

/** Every regular file under `dir`, relative to it, sorted. */
function filesUnder(dir: string): string[] {
  return (readdirSync(dir, { recursive: true }) as string[])
    .filter((f) => statSync(join(dir, f)).isFile())
    .sort();
}

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

    writeFileSync(config, '{"provider":"copilot"}\n');
    const again = await runCli(sb, repo, ['init', '--no-aliases']);
    expect(again.exitCode).toBe(0);
    expect(tally(again.stdout)).toEqual({
      written: 1, // AGENTS.md: its section is replaced on every run
      skipped: INTEGRATION_FILES.length - 1,
    });
    expect(readFileSync(config, 'utf8')).toBe('{"provider":"copilot"}\n');

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

  it('writes .helmsmith/pritty.json, not .pritty.json, in a repository that has a .helmsmith folder', async () => {
    sb = makeSandbox();
    const repo = makeRepo(sb);
    mkdirSync(join(repo, '.helmsmith', 'hooks'), { recursive: true });

    const r = await runCli(sb, repo, ['init', '--no-aliases']);
    expect(r.exitCode).toBe(0);
    expect(JSON.parse(readFileSync(join(repo, '.helmsmith', 'pritty.json'), 'utf8'))).toEqual(
      STARTER,
    );
    expect(existsSync(join(repo, '.pritty.json'))).toBe(false);
  });

  it('keeps an existing .pritty.json and adds no second config beside a .helmsmith folder', async () => {
    sb = makeSandbox();
    const repo = makeRepo(sb);
    mkdirSync(join(repo, '.helmsmith'));
    writeFileSync(join(repo, '.pritty.json'), '{"provider":"copilot"}\n');

    const r = await runCli(sb, repo, ['init', '--no-aliases']);
    expect(r.exitCode).toBe(0);
    expect(existsSync(join(repo, '.helmsmith', 'pritty.json'))).toBe(false);
    expect(readFileSync(join(repo, '.pritty.json'), 'utf8')).toBe('{"provider":"copilot"}\n');
  });

  describe('agent files', () => {
    const SHIPPED = join(__dirname, '..', '..', 'agents', 'pritty.md');

    it('installs the committer subagent and the AGENTS.md section, keeping the subagent on a second run', async () => {
      sb = makeSandbox();
      const repo = makeRepo(sb);
      const first = await runCli(sb, repo, ['init', '--json', '--no-aliases']);
      expect(first.exitCode).toBe(0);
      const agent = join(repo, '.claude', 'agents', 'pritty.md');
      const agentsMd = join(repo, 'AGENTS.md');
      expect(readFileSync(agent, 'utf8')).toBe(readFileSync(SHIPPED, 'utf8'));
      const md = readFileSync(agentsMd, 'utf8');
      expect(md).toContain('<!-- pritty:begin');
      expect(md).toContain('<!-- pritty:end -->');
      expect(md).toContain('## Committing with pritty');

      const second = await runCli(sb, repo, ['init', '--json', '--no-aliases']);
      const out = jsonLine<InitJson>(second);
      expect(out.skipped).toContain(agent);
      expect(out.written).toContain(agentsMd);
      expect(readFileSync(agentsMd, 'utf8').split('pritty:begin')).toHaveLength(2);
    });

    it('writes neither file with --no-agent --no-agents-md', async () => {
      sb = makeSandbox();
      const repo = makeRepo(sb);
      const r = await runCli(sb, repo, [
        'init',
        '--json',
        '--no-aliases',
        '--no-agent',
        '--no-agents-md',
      ]);
      expect(r.exitCode).toBe(0);
      expect(existsSync(join(repo, '.claude', 'agents', 'pritty.md'))).toBe(false);
      expect(existsSync(join(repo, 'AGENTS.md'))).toBe(false);
    });

    it('writes neither file outside a git repository', async () => {
      sb = makeSandbox();
      const dir = join(sb.root, 'plain');
      mkdirSync(dir);
      await runCli(sb, dir, ['init', '--json', '--no-aliases']);
      expect(readdirSync(dir)).toEqual(['.pritty.json']);
    });

    it('hints about @AGENTS.md on stderr and leaves CLAUDE.md alone', async () => {
      sb = makeSandbox();
      const repo = makeRepo(sb);
      writeFileSync(join(repo, 'CLAUDE.md'), '# Claude\n');
      const r = await runCli(sb, repo, ['init', '--json', '--no-aliases']);
      expect(r.stderr).toContain('@AGENTS.md');
      expect(r.stderr).toContain('CLAUDE.md');
      expect(readFileSync(join(repo, 'CLAUDE.md'), 'utf8')).toBe('# Claude\n');
    });

    it('leaves AGENTS.md untouched and skipped when its markers are broken', async () => {
      sb = makeSandbox();
      const repo = makeRepo(sb);
      const original =
        '# Mine\n<!-- pritty:begin (managed by `pritty init`; edits inside are replaced) -->\nuser text\n';
      const agentsMd = join(repo, 'AGENTS.md');
      writeFileSync(agentsMd, original);
      await runCli(sb, repo, ['init', '--json', '--no-aliases']);
      const second = await runCli(sb, repo, ['init', '--json', '--no-aliases']);
      expect(readFileSync(agentsMd, 'utf8')).toBe(original);
      expect(jsonLine<InitJson>(second).skipped).toContain(agentsMd);
      expect(jsonLine<InitJson>(second).written).not.toContain(agentsMd);
      expect(second.stderr).toMatch(/marker/i);
    });

    it('never writes through a symlinked AGENTS.md', async () => {
      sb = makeSandbox();
      const repo = makeRepo(sb);
      const target = join(sb.root, 'victim.rc');
      writeFileSync(target, 'export A=1\n');
      const agentsMd = join(repo, 'AGENTS.md');
      symlinkSync(target, agentsMd);
      const r = await runCli(sb, repo, ['init', '--json', '--no-aliases']);
      expect(readFileSync(target, 'utf8')).toBe('export A=1\n');
      expect(jsonLine<InitJson>(r).skipped).toContain(agentsMd);
      expect(r.stderr).toContain(agentsMd);
    });

    it('never writes through a symlinked .claude/agents/pritty.md, even with --force', async () => {
      sb = makeSandbox();
      const repo = makeRepo(sb);
      const target = join(sb.root, 'victim2.rc');
      writeFileSync(target, 'export B=1\n');
      mkdirSync(join(repo, '.claude', 'agents'), { recursive: true });
      const agent = join(repo, '.claude', 'agents', 'pritty.md');
      symlinkSync(target, agent);
      const r = await runCli(sb, repo, ['init', '--json', '--no-aliases', '--force']);
      expect(readFileSync(target, 'utf8')).toBe('export B=1\n');
      expect(jsonLine<InitJson>(r).skipped).toContain(agent);
      expect(r.stderr).toContain(agent);
    });
  });

  describe('writes only inside the repository', () => {
    it('skips every file under a parent directory that links outside, even with --force', async () => {
      sb = makeSandbox();
      const repo = makeRepo(sb);
      const outside = join(sb.root, 'outside');
      mkdirSync(join(outside, 'claude', 'commands'), { recursive: true });
      mkdirSync(join(outside, 'github'));
      mkdirSync(join(outside, 'helmsmith'));
      writeFileSync(join(outside, 'claude', 'commands', 'commit.md'), 'USER FILE\n');
      symlinkSync(join(outside, 'claude'), join(repo, '.claude'));
      symlinkSync('../outside/github', join(repo, '.github'));
      symlinkSync(join(outside, 'helmsmith'), join(repo, '.helmsmith'));
      const before = filesUnder(outside);

      for (const extra of [[], ['--force']]) {
        const r = await runCli(sb, repo, ['init', '--json', '--no-aliases', ...extra]);
        expect(r.exitCode).toBe(0);
        const out = jsonLine<InitJson>(r);
        for (const f of [
          '.helmsmith/pritty.json',
          '.claude/commands/commit.md',
          '.claude/commands/pr.md',
          '.claude/skills/pritty/SKILL.md',
          '.claude/agents/pritty.md',
          '.github/prompts/commit.prompt.md',
          '.github/prompts/pr.prompt.md',
        ]) {
          expect(out.skipped, f).toContain(join(repo, f));
          expect(r.stderr, f).toContain(join(repo, f));
        }
        expect(out.written).toEqual([join(repo, 'AGENTS.md')]);
        expect(r.stderr).toContain('outside the repository');
      }
      expect(filesUnder(outside)).toEqual(before);
      expect(readFileSync(join(outside, 'claude', 'commands', 'commit.md'), 'utf8')).toBe(
        'USER FILE\n',
      );
    });

    it('creates nothing through a dangling link and overwrites nothing through a link, even with --force', async () => {
      sb = makeSandbox();
      const repo = makeRepo(sb);
      const victim = join(sb.root, 'victim');
      mkdirSync(victim);
      writeFileSync(join(victim, 'rc'), 'export SAFE=1\n');
      mkdirSync(join(repo, '.claude', 'commands'), { recursive: true });
      mkdirSync(join(repo, '.github', 'prompts'), { recursive: true });
      const config = join(repo, '.pritty.json');
      const command = join(repo, '.claude', 'commands', 'commit.md');
      const prompt = join(repo, '.github', 'prompts', 'pr.prompt.md');
      symlinkSync(join(victim, 'config.json'), config);
      symlinkSync('../../../victim/created-by-init', command);
      symlinkSync('../../../victim/rc', prompt);

      for (const extra of [[], ['--force']]) {
        const r = await runCli(sb, repo, ['init', '--json', '--no-aliases', ...extra]);
        expect(r.exitCode).toBe(0);
        const out = jsonLine<InitJson>(r);
        for (const p of [config, command, prompt]) {
          expect(out.skipped, p).toContain(p);
          expect(out.written, p).not.toContain(p);
          expect(r.stderr, p).toContain(p);
        }
      }
      expect(readdirSync(victim)).toEqual(['rc']);
      expect(readFileSync(join(victim, 'rc'), 'utf8')).toBe('export SAFE=1\n');
    });

    it('still writes through a directory link that stays inside the repository', async () => {
      sb = makeSandbox();
      const repo = makeRepo(sb);
      mkdirSync(join(repo, 'tools', 'claude'), { recursive: true });
      symlinkSync('tools/claude', join(repo, '.claude'));
      const r = await runCli(sb, repo, ['init', '--json', '--no-aliases']);
      expect(r.exitCode).toBe(0);
      const out = jsonLine<InitJson>(r);
      expect(out.skipped).toEqual([]);
      for (const f of [
        'commands/commit.md',
        'commands/pr.md',
        'skills/pritty/SKILL.md',
        'agents/pritty.md',
      ]) {
        expect(existsSync(join(repo, 'tools', 'claude', f)), f).toBe(true);
        expect(out.written, f).toContain(join(repo, '.claude', f));
      }
    });
  });
});
