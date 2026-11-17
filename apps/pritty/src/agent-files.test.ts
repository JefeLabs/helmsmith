import { describe, expect, it } from 'vitest';
import { readAgentFile } from './agent-files.js';

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
    ]) {
      expect(md, s).toContain(s);
    }
  });

  it('AGENTS.section.md holds the committing rules, without markers', () => {
    const md = readAgentFile('AGENTS.section.md');
    expect(md.startsWith('## Committing with pritty')).toBe(true);
    for (const s of ['--label', '--input=json', '--breaking', '--output=json']) {
      expect(md, s).toContain(s);
    }
    expect(md).not.toContain('pritty:begin');
  });
});
