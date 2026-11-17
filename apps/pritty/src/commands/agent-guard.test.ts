import { describe, expect, it } from 'vitest';
import { judgeBash, judgeHookPayload, runAgentGuard } from './agent-guard.js';

const CWD = '/repo';
const S = '/repo/.git/pritty';
const scratch = () => S;
const judge = (cmd: string) => judgeBash(cmd, CWD, scratch);

describe('judgeBash', () => {
  it.each([
    'git status',
    'git diff --cached',
    'git log -5 --format=%s',
    'git show HEAD',
    'git show "HEAD^"',
    'git diff "HEAD~1"',
    'git add -- src/a.ts src/a.test.ts',
    'pritty commit --label abc --type fix --scope api --message "handle 404" --output=json -- src/a.ts',
    'pritty commit --message "handle 404" --body "more, detail (really)" --breaking',
    `pritty commit --input=json --dry-run --output=json < ${S}/plan.json`,
    `pritty commit --input json < .git/pritty/plan.json`,
    `pritty pr --input=json --output=json < ${S}/pr.json`,
    `pritty commit --input=json < "${S}/a"`,
    `pritty pr --base main --input=json --output=json < "${S}/pr.json"`,
    'pritty pr --title "x" --body "y" --draft --base main --no-footer --check',
    'pritty commit --message "a;b"',
    `pritty pr --base main --input=json --output=json < ${S}/pr.json`,
    'pritty pr --base release/1.2 --draft',
    'pritty --version',
    'pritty --help',
    'pritty categorize --json --all',
  ])('allows %s', (cmd) => {
    expect(judge(cmd)).toEqual({ allow: true });
  });

  it.each([
    ['git add src/a.ts', 'git add -- <paths>'],
    ['git add .', 'git add -- <paths>'],
    ['git add -A', 'git add -- <paths>'],
    ['git add --', 'git add -- <paths>'],
    ['git commit -m x', 'not allowed'],
    ['git push', 'not allowed'],
    ['rm -rf src', 'not allowed'],
    ['', 'not allowed'],
    ['git status && rm -rf src', 'allowed'],
    ['git status & rm -rf src', 'allowed'],
    ['git diff | sh', 'allowed'],
    ['git status; rm x', 'allowed'],
    ['git status\nrm x', 'allowed'],
    ['git status\trm', 'allowed'],
    ['git status\u00a0x', 'allowed'],
    ['echo $(whoami)', 'allowed'],
    ['git log `whoami`', 'allowed'],
    ['pritty commit > out.json', 'allowed'],
    // C1: quoting and expansion hiding --output
    [`git log -1 '--output=src/a.ts'`, 'allowed'],
    [`git log -1 "--output=src/a.ts"`, '--output'],
    [`git log -1 --output\\=src/a.ts`, 'allowed'],
    [`git log -1 \\--output=src/a.ts`, 'allowed'],
    [`git log -1 '--output'=src/a.ts`, 'allowed'],
    [`git log -1 --outpu""t=src/a.ts`, '--output'],
    [`git log -1 "--output"`, '--output'],
    [`git log -1 $'--output=src/a.ts'`, 'allowed'],
    ['git log {--output=src/a.ts,-1}', 'allowed'],
    ['git log --output=src/a.ts', '--output'],
    ['git log --output src/a.ts', '--output'],
    // C2: zsh expansions
    ['git status =(touch X)', 'allowed'],
    ["git status *(e:'touch X':)", 'allowed'],
    ['git log -1 .git/pritty/*(e:sh:)', 'allowed'],
    ['git status =ls', 'allowed'],
    ['git status ~', 'allowed'],
    ['git status *.ts', 'allowed'],
    ['git status ?', 'allowed'],
    ['git status [a]', 'allowed'],
    ['git status #x', 'allowed'],
    ['git status "$HOME"', 'allowed'],
    ['git status "a\\b"', 'allowed'],
    // R8: `^` and `~` are glob operators under zsh EXTENDED_GLOB; quote revisions
    ['git log ^zzz', 'allowed'],
    ['git log -1 ^zzz', 'allowed'],
    ['git log a^b', 'allowed'],
    ['git show HEAD^', 'allowed'],
    ['git diff HEAD~1', 'allowed'],
    ['pritty commit --label =(touch X)', 'allowed'],
    ['pritty categorize *(e:sh:)', 'allowed'],
    // S2: flag allowlists
    ['pritty pr --title x --body-file /etc/passwd', 'not an allowed flag'],
    ['pritty commit --no-verify --message x', 'not an allowed flag'],
    ['pritty commit --trailer "A: b" --message x', 'not an allowed flag'],
    ['pritty commit --auto-approve', 'not an allowed flag'],
    ['pritty commit stray', 'not an allowed flag'],
    ['pritty categorize -- x', 'takes no paths'],
    ['pritty pr --base --output=x', 'must not be empty'],
    ['pritty pr --base=--output=x', 'must not be empty'],
    ['pritty pr --base -x', 'must not be empty'],
    ['pritty commit --scope -x', 'must not be empty'],
    ['pritty commit --scope=-x', 'must not be empty'],
    ['pritty commit --message ""', 'must not be empty'],
    ['pritty pr --base a..b', '--base must be'],
    ['pritty pr --base a:b', '--base must be'],
    ['git log --outp=x', '--output'],
    ['pritty rebase', 'not allowed'],
    ['pritty --version x', 'no arguments'],
    // redirect
    ['pritty commit --input=json < src/plan.json', `${S}/`],
    ['pritty commit --input=json < .git/pritty/../../src/x', `${S}/`],
    ['pritty commit --input=json < /other/.git/pritty/x', `${S}/`],
    ['pritty commit --input=json < "/other/.git/pritty/x"', `${S}/`],
    ['git status < .git/pritty/x', `${S}/`],
    [`pritty commit --input=json <${S}/x`, 'allowed'],
    [`pritty commit < ${S}/plan.json`, '--input=json'],
    [`pritty commit --input=json < ${S}/a < ${S}/b`, `${S}/`],
    [`pritty commit --input=json < "${S}/a" x`, `${S}/`],
  ])('refuses %j', (cmd, fragment) => {
    const v = judge(cmd);
    expect(v.allow).toBe(false);
    if (!v.allow) expect(v.reason).toContain(fragment);
  });
});

describe.each([
  ['a space', '/nonexistent-pritty/My Projects/repo'],
  ['a non-ASCII character', '/nonexistent-pritty/josé/repo'],
])('a scratch directory with %s', (_, cwd) => {
  const dir = `${cwd}/.git/pritty`;
  const j = (cmd: string) => judgeBash(cmd, cwd, () => dir);
  it('allows a double-quoted redirect from it', () => {
    expect(j(`pritty commit --input=json --dry-run --output=json < "${dir}/plan.json"`)).toEqual({
      allow: true,
    });
    expect(j(`pritty pr --base main --input=json --output=json < "${dir}/pr.json"`)).toEqual({
      allow: true,
    });
  });
  it('refuses the unquoted redirect', () => {
    expect(j(`pritty commit --input=json < ${dir}/plan.json`).allow).toBe(false);
  });
  it('refuses a double-quoted path outside it', () => {
    for (const path of [`${cwd}/src/plan.json`, `${dir}/../../src/plan.json`, dir]) {
      const v = j(`pritty commit --input=json < "${path}"`);
      expect(v.allow, path).toBe(false);
      if (!v.allow) expect(v.reason).toContain(`${dir}/`);
    }
  });
});

describe('refusal messages', () => {
  const WT = '/main/.git/worktrees/wt/pritty';
  const write = (resolver: () => string | null) =>
    judgeHookPayload(
      JSON.stringify({ tool_name: 'Write', tool_input: { file_path: '/wt/src/a.ts' }, cwd: '/wt' }),
      resolver,
    );
  const redirect = (resolver: () => string | null) =>
    judgeBash('pritty commit --input=json < src/plan.json', '/wt', resolver);
  it('name the resolved scratch directory', () => {
    for (const v of [write(() => WT), redirect(() => WT)]) {
      expect(v.allow).toBe(false);
      if (!v.allow) {
        expect(v.reason).toContain(`${WT}/`);
        expect(v.reason).not.toContain('.git/pritty/');
      }
    }
  });
  it('name the rev-parse command when no scratch directory resolves', () => {
    for (const v of [write(() => null), redirect(() => null)]) {
      expect(v.allow).toBe(false);
      if (!v.allow) {
        expect(v.reason).toContain('git rev-parse --path-format=absolute --git-path pritty');
      }
    }
  });
});

describe('judgeHookPayload', () => {
  const p = (o: unknown) => JSON.stringify(o);
  const hook = (s: string) => judgeHookPayload(s, scratch);
  it('judges Bash commands', () => {
    expect(hook(p({ tool_name: 'Bash', tool_input: { command: 'git status' }, cwd: CWD }))).toEqual(
      { allow: true },
    );
    expect(
      hook(p({ tool_name: 'Bash', tool_input: { command: 'git push' }, cwd: CWD })).allow,
    ).toBe(false);
  });
  it('allows Write only inside the scratch dir', () => {
    const w = (file_path: string, tool_name = 'Write') =>
      hook(p({ tool_name, tool_input: { file_path }, cwd: CWD }));
    expect(w(`${S}/plan.json`)).toEqual({ allow: true });
    expect(w(`${S}/plan.json`, 'Edit')).toEqual({ allow: true });
    expect(w(`${S}/plan.json`, 'MultiEdit')).toEqual({ allow: true });
    expect(w('/repo/src/a.ts').allow).toBe(false);
    expect(w(`${S}/../../src/a.ts`).allow).toBe(false);
    expect(w(S).allow).toBe(false);
  });
  it('refuses writes when no scratch dir resolves', () => {
    expect(
      judgeHookPayload(
        p({ tool_name: 'Write', tool_input: { file_path: `${S}/x` }, cwd: CWD }),
        () => null,
      ).allow,
    ).toBe(false);
  });
  it('allows other tools', () => {
    expect(hook(p({ tool_name: 'Read', tool_input: {}, cwd: CWD }))).toEqual({ allow: true });
  });
  it.each([
    'not json',
    'null',
    '{}',
    '[]',
    '{"tool_input":{"command":"rm -rf /"},"cwd":"/repo"}',
    '{"tool_name":5,"tool_input":{"command":"rm -rf /"},"cwd":"/repo"}',
    '{"tool_name":"Bash","tool_input":{},"cwd":"/repo"}',
    '{"tool_name":"Write","tool_input":{"file_path":"x"}}',
  ])('refuses %s', (s) => {
    expect(hook(s).allow).toBe(false);
  });
});

describe('runAgentGuard', () => {
  const run = async (payload: string, resolver = scratch) => {
    const lines: string[] = [];
    const code = await runAgentGuard(
      { readStdin: async () => payload, err: (l) => lines.push(l) },
      resolver,
    );
    return { code, lines };
  };
  const bash = (command: string) =>
    JSON.stringify({ tool_name: 'Bash', tool_input: { command }, cwd: CWD });
  it('returns 2 with the reason for a refused payload', async () => {
    const r = await run(bash('git push'));
    expect(r.code).toBe(2);
    expect(r.lines.join('\n')).toContain('not allowed');
  });
  it('returns 0 for an allowed payload', async () => {
    expect(await run(bash('git status'))).toEqual({ code: 0, lines: [] });
  });
  it('fails closed when reading or judging throws', async () => {
    const lines: string[] = [];
    const code = await runAgentGuard({
      readStdin: async () => {
        throw new Error('boom');
      },
      err: (l) => lines.push(l),
    });
    expect(code).toBe(2);
    expect(lines.join('')).toContain('boom');
    const r = await run(
      JSON.stringify({ tool_name: 'Write', tool_input: { file_path: `${S}/x` }, cwd: CWD }),
      () => {
        throw new Error('resolver died');
      },
    );
    expect(r.code).toBe(2);
  });
});
