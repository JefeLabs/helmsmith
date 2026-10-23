import { join, sep } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { gitIn, stagedPaths, write } from '../../src/testing/repo.js';
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

interface Outcome {
  dryRun: boolean;
  commits: Array<{ category: string; message: string; files: string[]; sha?: string }>;
}

const STAGED = ['src/feature.test.ts', 'src/feature.ts'];

/** A repo using the `claude` provider, with an app file and its test staged. */
function stagedRepo(s: Sandbox): string {
  const repo = makeRepo(s, { config: { provider: 'claude', commitTrailers: ['Refs: E2E-1'] } });
  write(repo, 'src/feature.ts', 'export const greet = () => "hi";\n');
  write(repo, 'src/feature.test.ts', 'it.todo("greets");\n');
  gitIn(repo, 'add', ...STAGED);
  return repo;
}

/** The model's commit plan. `files` is deliberately wrong: pritty must take files from its own categorizer. */
const PLAN = JSON.stringify([
  { category: 'app', message: 'feat(feature): add greet', files: ['src/elsewhere.ts'] },
  { category: 'test', message: 'test(feature): cover greet', files: [] },
]);

const argAfter = (argv: string[], flag: string): string | undefined => argv[argv.indexOf(flag) + 1];

describe('pritty commit (claude provider)', () => {
  it('makes one commit per category with the model’s messages, the categorizer’s files and the configured trailer', async () => {
    sb = makeSandbox();
    const repo = stagedRepo(sb);
    installFakeClaude(sb).answer(PLAN);

    const r = await runCli(sb, repo, ['commit', '--json']);
    expect(r.exitCode, r.stderr).toBe(0);
    const out = jsonLine<Outcome>(r);
    expect(out.dryRun).toBe(false);
    expect(out.commits.map((c) => [c.category, c.message, c.files])).toEqual([
      ['app', 'feat(feature): add greet', ['src/feature.ts']],
      ['test', 'test(feature): cover greet', ['src/feature.test.ts']],
    ]);

    // git agrees, newest first
    expect(gitIn(repo, 'log', '--format=%H', '-2').trim().split('\n')).toEqual([
      out.commits[1]!.sha,
      out.commits[0]!.sha,
    ]);
    for (const c of out.commits) {
      expect(gitIn(repo, 'show', '--format=', '--name-only', c.sha!).trim().split('\n')).toEqual(
        c.files,
      );
      expect(gitIn(repo, 'log', '-1', '--format=%B', c.sha!).trim()).toBe(
        `${c.message}\n\nRefs: E2E-1`,
      );
    }
    expect(gitIn(repo, 'status', '--porcelain').trim()).toBe('');
  });

  it('works from a subdirectory of the repository', async () => {
    sb = makeSandbox();
    const repo = stagedRepo(sb);
    installFakeClaude(sb).answer(PLAN);

    const r = await runCli(sb, join(repo, 'src'), ['commit', '--json']);
    expect(r.exitCode, r.stderr).toBe(0);
    expect(jsonLine<Outcome>(r).commits.map((c) => c.files)).toEqual([
      ['src/feature.ts'],
      ['src/feature.test.ts'],
    ]);
    expect(gitIn(repo, 'status', '--porcelain').trim()).toBe('');
  });

  it('--dry-run reports the plan and commits nothing', async () => {
    sb = makeSandbox();
    const repo = stagedRepo(sb);
    installFakeClaude(sb).answer(PLAN);
    const before = head(repo);

    const r = await runCli(sb, repo, ['commit', '--dry-run', '--json']);
    expect(r.exitCode, r.stderr).toBe(0);
    const out = jsonLine<Outcome>(r);
    expect(out.dryRun).toBe(true);
    expect(out.commits.map((c) => c.category)).toEqual(['app', 'test']);
    expect(out.commits.every((c) => c.sha === undefined)).toBe(true);
    expect(head(repo)).toBe(before);
    expect(stagedPaths(repo).sort()).toEqual(STAGED);
  });

  it('sends claude a redacted diff, headless and from outside the repository', async () => {
    sb = makeSandbox();
    const repo = makeRepo(sb, { config: { provider: 'claude' } });
    // Assembled at runtime so no secret-shaped literal sits in the source.
    const apiKey = ['sk', `e2e${'a'.repeat(30)}`].join('-');
    const dbPassword = `pw${'9'.repeat(12)}`;
    write(repo, 'src/feature.ts', `export const apiKey = "${apiKey}";\nexport const greet = 1;\n`);
    write(repo, '.env', `DB_URL=postgres://app:${dbPassword}@db/app\n`);
    gitIn(repo, 'add', '-A');
    const fake = installFakeClaude(sb);
    fake.answer(
      JSON.stringify([
        { category: 'app', message: 'feat: add greet', files: [] },
        { category: 'unknown', message: 'chore: add env', files: [] },
      ]),
    );

    const r = await runCli(sb, repo, ['commit', '--dry-run', '--json']);
    expect(r.exitCode, r.stderr).toBe(0);

    const calls = fake.calls();
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.stdin).toContain('export const greet = 1;');
    expect(call.stdin).not.toContain(apiKey);
    expect(call.stdin).not.toContain(dbPassword);
    expect(call.stdin).toContain('[diff for .env omitted]');

    expect(call.argv[0]).toBe('-p');
    expect(argAfter(call.argv, '--setting-sources')).toBe('user');
    expect(argAfter(call.argv, '--max-turns')).toBe('1');
    expect(argAfter(call.argv, '--tools')).toBe('');
    expect(call.argv).toContain('--strict-mcp-config');
    expect(call.argv).toContain('--no-session-persistence');
    expect(call.cwd === repo || call.cwd.startsWith(repo + sep)).toBe(false);
  });

  it('fails without committing when claude fails', async () => {
    sb = makeSandbox();
    const repo = stagedRepo(sb);
    installFakeClaude(sb).fail(1, 'Invalid API key · Please run /login');
    const before = head(repo);

    const r = await runCli(sb, repo, ['commit', '--auto-approve']);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('claude exited with code 1');
    expect(r.stderr).toContain('Please run /login');
    expect(head(repo)).toBe(before);
    expect(stagedPaths(repo).sort()).toEqual(STAGED);
  });

  it('commits nothing when the plan leaves a category out', async () => {
    sb = makeSandbox();
    const repo = stagedRepo(sb);
    installFakeClaude(sb).answer(
      JSON.stringify([{ category: 'app', message: 'feat: add greet', files: [] }]),
    );
    const before = head(repo);

    const r = await runCli(sb, repo, ['commit', '--auto-approve']);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('AI plan omits categories with staged files: test');
    expect(head(repo)).toBe(before);
  });

  it('names the setup step when no claude is on PATH', async () => {
    sb = makeSandbox();
    const repo = stagedRepo(sb);

    const r = await runCli(sb, repo, ['commit', '--auto-approve']);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('No AI provider available. Tried: claude.');
    expect(r.stderr).toContain('install Claude Code');
  });
});
