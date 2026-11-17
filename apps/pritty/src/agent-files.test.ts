import { describe, expect, it } from 'vitest';
import { readAgentFile } from './agent-files.js';
import { judgeBash } from './commands/agent-guard.js';

describe('agent files', () => {
  it('pritty.md is a guarded committer subagent', () => {
    const md = readAgentFile('pritty.md');
    expect(md.startsWith('---\nname: pritty\n')).toBe(true);
    for (const s of [
      'tools: Bash, Read, Grep, Glob, Write',
      'pritty agent-guard || exit 2',
      'matcher: "Bash"',
      'matcher: "Write|Edit"',
      '--input=json',
      'git rev-parse --path-format=absolute --git-path pritty',
      '--dry-run',
      '--no-verify',
      '--base <branch>',
      'baseBranch',
      '"HEAD^"',
    ]) {
      expect(md, s).toContain(s);
    }
  });

  it('AGENTS.section.md holds the committing rules, without markers', () => {
    const md = readAgentFile('AGENTS.section.md');
    expect(md.startsWith('## Committing with pritty')).toBe(true);
    for (const s of [
      '--label',
      '--input=json',
      '--breaking',
      '--output=json',
      'git rev-parse --path-format=absolute --git-path pritty',
      '--base <branch>',
      'baseBranch',
    ]) {
      expect(md, s).toContain(s);
    }
    expect(md).not.toContain('pritty:begin');
    expect(md).not.toContain('/tmp/');
  });
});

/** A scratch directory with a space in its path, as under iCloud Drive. */
const CWD = '/nonexistent-pritty/My Projects/repo';
const SCRATCH = `${CWD}/.git/pritty`;
const PLACEHOLDERS: Record<string, string> = {
  '<scratch>': SCRATCH,
  '<branch>': 'main',
  '<paths>': 'src/a.ts src/a.test.ts',
};
/** Commands the files name only to forbid them. */
const FORBIDDEN = new Set(['git commit', 'git commit -m']);

/** The `git …` and `pritty …` commands in a Markdown file's code spans and fenced blocks. */
function commandsIn(md: string): string[] {
  const body = md.replace(/^---\n[\s\S]*?\n---\n/, '');
  const fence = /^```[^\n]*\n([\s\S]*?)^```/gm;
  const found: string[] = [];
  for (const m of body.matchAll(fence)) found.push(...(m[1] ?? '').split('\n'));
  for (const m of body.replace(fence, '').matchAll(/`([^`\n]+)`/g)) found.push(m[1] ?? '');
  return found.map((c) => c.trim()).filter((c) => /^(git|pritty)\s/.test(c));
}

function fill(command: string): string {
  const out = command.replace(/<[a-z]+>/g, (p) => PLACEHOLDERS[p] ?? p);
  expect(out, `unknown placeholder in ${command}`).not.toMatch(/<[a-z]+>/);
  return out;
}

describe.each(['pritty.md', 'AGENTS.section.md'] as const)('the commands in %s', (name) => {
  const commands = commandsIn(readAgentFile(name));

  it('pass the agent guard, except the ones named only to forbid them', () => {
    expect(commands.length).toBeGreaterThan(4);
    expect(commands.some((c) => FORBIDDEN.has(c))).toBe(true);
    for (const command of commands) {
      const verdict = judgeBash(fill(command), CWD, () => SCRATCH);
      if (FORBIDDEN.has(command)) expect(verdict.allow, command).toBe(false);
      else expect(verdict, command).toEqual({ allow: true });
    }
  });

  it('redirect only from the quoted scratch path and pass --base to pritty pr', () => {
    const redirects = commands.filter((c) => c.includes(' < '));
    expect(redirects.length).toBeGreaterThan(1);
    for (const c of redirects) expect(c, c).toMatch(/ < "<scratch>\/[a-z]+\.json"$/);
    const prs = commands.filter((c) => c.startsWith('pritty pr '));
    expect(prs.length).toBeGreaterThan(0);
    for (const c of prs) expect(c, c).toContain('--base <branch>');
  });
});
