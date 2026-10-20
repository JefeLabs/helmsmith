/**
 * Two scans at once must not double-count (#111): the second finds the lock, says so,
 * and exits non-zero; the store ends with exactly the repo's commits.
 */
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSandbox, runCli, type Sandbox } from './helpers.js';

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, {
    cwd,
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
    stdio: 'pipe',
  });
}

const N = 60;

describe('parallel scans', () => {
  let sb: Sandbox;
  beforeEach(async () => {
    sb = await createSandbox();
    const repo = await sb.mkdir('repos/busy');
    git(repo, ['init', '-q', '-b', 'main']);
    git(repo, ['config', 'user.name', 'Ann']);
    git(repo, ['config', 'user.email', 'ann@example.com']);
    git(repo, ['config', 'commit.gpgsign', 'false']);
    for (let i = 1; i <= N; i++) {
      await writeFile(join(repo, 'f.ts'), `${i}\n`);
      git(repo, ['add', '.']);
      git(repo, ['commit', '-q', '-m', `feat: ${i}`]);
    }
    await mkdir(join(sb.home, '.agentx'), { recursive: true });
    await writeFile(
      join(sb.home, '.agentx', 'repos.yml'),
      ['workspaces:', '  t:', '    repos:', '      - name: busy', `        path: ${repo}`, ''].join(
        '\n',
      ),
    );
  });
  afterEach(async () => {
    await sb.cleanup();
  });

  it('one of two concurrent scans yields, and the total is exact', async () => {
    const flags = [
      'scan',
      '--workspace',
      't',
      '--staleness',
      '0',
      '--skip-enrich',
      '--skip-rework',
    ];
    const [a, b] = await Promise.all([runCli(sb, flags), runCli(sb, flags)]);
    const outputs = [a, b];
    const yielded = outputs.filter((r) => /scan .*in progress/i.test(r.stdout + r.stderr));
    const ran = outputs.filter((r) => /\+\d+ commits/.test(r.stdout));
    expect(yielded).toHaveLength(1);
    expect(ran).toHaveLength(1);
    expect(yielded[0].exitCode).not.toBe(0);
    expect(ran[0].exitCode).toBe(0);

    const view = await runCli(sb, ['--json', '--workspace', 't', 'view', 'contributions']);
    const rows = JSON.parse(view.stdout) as Array<{ name: string; commits: number }>;
    expect(rows.reduce((s, r) => s + r.commits, 0)).toBe(N);
  }, 60_000);
});
