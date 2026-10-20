/**
 * Commits that reach the clone after a scan but carry older dates must still be
 * counted by the next incremental scan (#79): a branch merged after the scan, and a
 * back-dated direct commit pulled later.
 */
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSandbox, runCli, type Sandbox } from './helpers.js';

const ENV = { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
function git(cwd: string, args: string[], env: Record<string, string> = {}): string {
  return execFileSync('git', args, {
    cwd,
    env: { ...process.env, ...ENV, ...env },
    stdio: 'pipe',
  }).toString();
}
function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString();
}
async function commit(
  cwd: string,
  file: string,
  msg: string,
  when: string,
  author = 'Bob',
): Promise<void> {
  await writeFile(join(cwd, file), `${msg}\n`);
  git(cwd, ['add', file]);
  git(cwd, ['commit', '-q', '-m', msg], {
    GIT_AUTHOR_NAME: author,
    GIT_AUTHOR_EMAIL: `${author.toLowerCase()}@example.com`,
    GIT_AUTHOR_DATE: when,
    GIT_COMMITTER_NAME: author,
    GIT_COMMITTER_EMAIL: `${author.toLowerCase()}@example.com`,
    GIT_COMMITTER_DATE: when,
  });
}

describe('incremental scan after a late merge', () => {
  let sb: Sandbox;
  let clone: string;
  let dev: string;
  beforeEach(async () => {
    sb = await createSandbox();
    const origin = await sb.mkdir('origin.git');
    git(origin, ['init', '-q', '--bare', '-b', 'main']);
    dev = await sb.mkdir('dev');
    git(dev, ['clone', '-q', origin, '.']);
    git(dev, ['config', 'commit.gpgsign', 'false']);
    await commit(dev, 'a.ts', 'feat: initial', daysAgo(20), 'Alice');
    git(dev, ['push', '-q', 'origin', 'main']);
    clone = await sb.mkdir('clone');
    git(clone, ['clone', '-q', origin, '.']);
    await mkdir(join(sb.home, '.agentx'), { recursive: true });
    await writeFile(
      join(sb.home, '.agentx', 'repos.yml'),
      [
        'workspaces:',
        '  t:',
        '    repos:',
        '      - name: late',
        `        path: ${clone}`,
        '',
      ].join('\n'),
    );
  });
  afterEach(async () => {
    await sb.cleanup();
  });

  async function totals(): Promise<{ commits: number; insertions: number }> {
    const r = await runCli(sb, ['--json', '--workspace', 't', '-w', '8', 'view', 'contributions']);
    expect(r.exitCode).toBe(0);
    const rows = JSON.parse(r.stdout) as Array<{ commits: number; insertions: number }>;
    return rows.reduce(
      (s, x) => ({ commits: s.commits + x.commits, insertions: s.insertions + x.insertions }),
      {
        commits: 0,
        insertions: 0,
      },
    );
  }

  it('counts back-dated branch commits merged after the first scan, same as a force-scan', async () => {
    const flags = ['--workspace', 't', '--staleness', '0', '--skip-enrich', '--skip-rework'];
    expect((await runCli(sb, ['scan', ...flags])).exitCode).toBe(0);
    expect((await totals()).commits).toBe(1);

    // Meanwhile on origin: Bob's branch with 3 commits dated 10..8 days ago, merged now;
    // plus Carol's direct commit dated 5 days ago.
    git(dev, ['checkout', '-q', '-b', 'feature']);
    await commit(dev, 'b1.ts', 'feat: b1', daysAgo(10));
    await commit(dev, 'b2.ts', 'feat: b2', daysAgo(9));
    await commit(dev, 'b3.ts', 'feat: b3', daysAgo(8));
    git(dev, ['checkout', '-q', 'main']);
    git(
      dev,
      ['merge', '-q', '--no-ff', '-m', 'Merge pull request #7 from acme/feature', 'feature'],
      {
        GIT_AUTHOR_NAME: 'Alice',
        GIT_AUTHOR_EMAIL: 'alice@example.com',
        GIT_COMMITTER_NAME: 'Alice',
        GIT_COMMITTER_EMAIL: 'alice@example.com',
      },
    );
    await commit(dev, 'c.ts', 'fix: carol', daysAgo(5), 'Carol');
    git(dev, ['push', '-q', 'origin', 'main']);
    git(clone, ['pull', '-q', '--ff-only']);

    const second = await runCli(sb, ['scan', ...flags]);
    expect(second.exitCode).toBe(0);
    expect(second.stdout).toMatch(/\+4 commits/);
    const incremental = await totals();
    expect(incremental.commits).toBe(5);

    expect((await runCli(sb, ['scan', '--force-scan', ...flags])).exitCode).toBe(0);
    expect(await totals()).toEqual(incremental);
  }, 60_000);
});
