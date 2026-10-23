import { afterEach, describe, expect, it } from 'vitest';
import { commitFile, gitIn } from '../../src/testing/repo.js';
import { head, installFakeClaude, makeRepo, makeSandbox, runCli, type Sandbox } from './helpers.js';

let sb: Sandbox | undefined;
afterEach(() => {
  sb?.cleanup();
  sb = undefined;
});

/** `feat/greet`, two commits ahead of main: a feature and a typo fix for it. */
function featureBranch(s: Sandbox): { repo: string; oldest: string; newest: string } {
  const repo = makeRepo(s, { config: { provider: 'claude' } });
  gitIn(repo, 'checkout', '-q', '-b', 'feat/greet');
  commitFile(repo, 'src/greet.ts', 'export const greet = () => "helo";\n', 'feat: add greet');
  commitFile(repo, 'src/greet.ts', 'export const greet = () => "hello";\n', 'fix typo');
  const [newest, oldest] = gitIn(repo, 'log', '--format=%H', '-2').trim().split('\n');
  return { repo, oldest: oldest!, newest: newest! };
}

const fixupPlan = (oldest: string, newest: string): string =>
  JSON.stringify({
    steps: [
      { hash: oldest, action: 'pick' },
      { hash: newest.slice(0, 7), action: 'fixup', rationale: 'typo fix' },
    ],
    summary: 'fold the typo fix into the feature',
  });

describe('pritty rebase (claude provider)', () => {
  it('--dry-run shows the model’s plan and leaves the branch alone', async () => {
    sb = makeSandbox();
    const { repo, oldest, newest } = featureBranch(sb);
    const fake = installFakeClaude(sb);
    fake.answer(fixupPlan(oldest, newest));
    const before = head(repo);

    const r = await runCli(sb, repo, [
      'rebase',
      '--dry-run',
      '--base',
      'main',
      '--strategy',
      'auto',
    ]);
    expect(r.exitCode, r.stderr).toBe(0);
    expect(r.stdout).toMatch(new RegExp(`pick\\s+${oldest.slice(0, 7)}`));
    expect(r.stdout).toMatch(new RegExp(`fixup\\s+${newest.slice(0, 7)}`));
    expect(r.stdout).toContain('Summary: fold the typo fix into the feature');
    expect(r.stdout).toContain('Dry-run — git not touched');
    expect(head(repo)).toBe(before);
    // oldest first, the order git's todo uses
    expect(fake.calls()[0]!.stdin).toMatch(
      new RegExp(
        `1\\. ${oldest.slice(0, 7)}  feat: add greet\\n\\s+2\\. ${newest.slice(0, 7)}  fix typo`,
      ),
    );
  });

  it('never rewrites history without a confirmation it can read', async () => {
    sb = makeSandbox();
    const { repo, oldest, newest } = featureBranch(sb);
    installFakeClaude(sb).answer(fixupPlan(oldest, newest));
    const before = head(repo);

    const r = await runCli(sb, repo, ['rebase', '--base', 'main', '--strategy', 'auto']);
    expect(r.timedOut).toBe(false);
    expect(r.exitCode).toBe(1);
    expect(r.stdout + r.stderr).toContain('This step needs a terminal to ask a question');
    expect(head(repo)).toBe(before);
    expect(gitIn(repo, 'rev-list', '--count', 'main..HEAD').trim()).toBe('2');
  });

  it('refuses to rebase main', async () => {
    sb = makeSandbox();
    const repo = makeRepo(sb, { config: { provider: 'claude' } });
    const r = await runCli(sb, repo, ['rebase']);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toContain('Refusing to rebase main');
  });
});
