import { describe, expect, it } from 'vitest';
import { judgeBash, judgeHookPayload, runAgentGuard } from './agent-guard.js';

const CWD = '/repo';

describe('judgeBash', () => {
  it.each([
    'git status',
    'git diff --cached',
    'git log -5 --format=%s',
    'git show HEAD',
    'git add -- src/a.ts src/a.test.ts',
    'pritty commit --label abc --type fix --scope api --message "handle 404" --output=json -- src/a.ts',
    'pritty commit --input=json --dry-run --output=json < .git/pritty/plan.json',
    'pritty pr --input=json --output=json < /repo/.git/pritty/pr.json',
    'pritty --version',
    'pritty categorize --json',
  ])('allows %s', (cmd) => {
    expect(judgeBash(cmd, CWD)).toEqual({ allow: true });
  });

  it.each([
    ['git add src/a.ts', 'git add -- <paths>'],
    ['git add .', 'git add -- <paths>'],
    ['git add -A', 'git add -- <paths>'],
    ['git add --', 'git add -- <paths>'],
    ['git commit -m x', 'not allowed'],
    ['git push', 'not allowed'],
    ['rm -rf src', 'not allowed'],
    ['git status && rm -rf src', '&&'],
    ['git status & rm -rf src', '&'],
    ['git diff | sh', '|'],
    ['git status; rm x', ';'],
    ['pritty commit --input=json < src/plan.json', '.git/pritty/'],
    ['pritty commit --input=json < .git/pritty/../../src/x', '.git/pritty/'],
    ['pritty commit --input=json < /other/.git/pritty/x', '.git/pritty/'],
    ['git status < .git/pritty/x', '.git/pritty/'],
    ['echo $(whoami)', '$('],
    ['git log `whoami`', '`'],
    ['pritty commit > out.json', '>'],
    ['git diff --output=x.txt', '--output'],
    ['git status\nrm x', 'newline'],
    ['git status\trm', 'whitespace'],
    ['git status x', 'whitespace'],
    ['pritty commit --message "a;b"', ';'],
    ['', 'not allowed'],
  ])('refuses %j', (cmd, fragment) => {
    const v = judgeBash(cmd, CWD);
    expect(v.allow).toBe(false);
    if (!v.allow) expect(v.reason).toContain(fragment);
  });
});

describe('judgeHookPayload', () => {
  const p = (o: unknown) => JSON.stringify(o);
  it('judges Bash commands', () => {
    expect(
      judgeHookPayload(p({ tool_name: 'Bash', tool_input: { command: 'git status' }, cwd: CWD })),
    ).toEqual({ allow: true });
    expect(
      judgeHookPayload(p({ tool_name: 'Bash', tool_input: { command: 'git push' }, cwd: CWD }))
        .allow,
    ).toBe(false);
  });
  it('allows Write only inside .git/pritty', () => {
    const w = (file_path: string, tool_name = 'Write') =>
      judgeHookPayload(p({ tool_name, tool_input: { file_path }, cwd: CWD }));
    expect(w('/repo/.git/pritty/plan.json')).toEqual({ allow: true });
    expect(w('/repo/.git/pritty/plan.json', 'Edit')).toEqual({ allow: true });
    expect(w('/repo/src/a.ts').allow).toBe(false);
    expect(w('/repo/.git/pritty/../../src/a.ts').allow).toBe(false);
    expect(w('/repo/.git/pritty').allow).toBe(false);
  });
  it('allows other tools', () => {
    expect(judgeHookPayload(p({ tool_name: 'Read', tool_input: {}, cwd: CWD }))).toEqual({
      allow: true,
    });
  });
  it('refuses invalid or incomplete payloads', () => {
    expect(judgeHookPayload('not json').allow).toBe(false);
    expect(judgeHookPayload(p({ tool_name: 'Bash', tool_input: {}, cwd: CWD })).allow).toBe(false);
    expect(judgeHookPayload(p({ tool_name: 'Write', tool_input: { file_path: 'x' } })).allow).toBe(
      false,
    );
    expect(judgeHookPayload('null').allow).toBe(false);
  });
});

describe('runAgentGuard', () => {
  const run = async (payload: string) => {
    const lines: string[] = [];
    const code = await runAgentGuard({
      readStdin: async () => payload,
      err: (l) => lines.push(l),
    });
    return { code, lines };
  };
  it('returns 2 with the reason for a refused payload', async () => {
    const r = await run(
      JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git push' }, cwd: CWD }),
    );
    expect(r.code).toBe(2);
    expect(r.lines.join('\n')).toContain('not allowed');
  });
  it('returns 0 for an allowed payload', async () => {
    const r = await run(
      JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'git status' }, cwd: CWD }),
    );
    expect(r).toEqual({ code: 0, lines: [] });
  });
});
