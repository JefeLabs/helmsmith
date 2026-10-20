/**
 * Author commit counts must not inflate on forced rescans (#116).
 */
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSandbox, runCli, type Sandbox } from './helpers.js';

function git(cwd: string, args: string[], env: Record<string, string> = {}): void {
  execFileSync('git', args, {
    cwd,
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', ...env },
    stdio: 'pipe',
  });
}

describe('force-scan and author counts', () => {
  let sb: Sandbox;
  beforeEach(async () => {
    sb = await createSandbox();
    const repo = await sb.mkdir('repos/gamma');
    git(repo, ['init', '-q', '-b', 'main']);
    git(repo, ['config', 'user.name', 'Ann']);
    git(repo, ['config', 'user.email', 'ann@example.com']);
    git(repo, ['config', 'commit.gpgsign', 'false']);
    for (let i = 1; i <= 5; i++) {
      await writeFile(join(repo, `f${i}.ts`), `${i}\n`);
      git(repo, ['add', '.']);
      git(repo, ['commit', '-q', '-m', `feat: ${i}`]);
    }
    await mkdir(join(sb.home, '.agentx'), { recursive: true });
    await writeFile(
      join(sb.home, '.agentx', 'repos.yml'),
      [
        'workspaces:',
        '  t:',
        '    repos:',
        '      - name: gamma',
        `        path: ${repo}`,
        '',
      ].join('\n'),
    );
  });
  afterEach(async () => {
    await sb.cleanup();
  });

  async function annCount(): Promise<number> {
    const r = await runCli(sb, ['--json', '--workspace', 't', 'author', 'list']);
    expect(r.exitCode).toBe(0);
    const authors = JSON.parse(r.stdout) as Array<{ email: string; commitCount: number }>;
    return authors.find((a) => a.email === 'ann@example.com')?.commitCount ?? -1;
  }

  it('shows the true count after two force-scans', async () => {
    const flags = ['--workspace', 't', '--skip-enrich', '--skip-rework'];
    expect((await runCli(sb, ['scan', ...flags])).exitCode).toBe(0);
    expect(await annCount()).toBe(5);
    expect((await runCli(sb, ['scan', '--force-scan', ...flags])).exitCode).toBe(0);
    expect((await runCli(sb, ['scan', '--force-scan', ...flags])).exitCode).toBe(0);
    expect(await annCount()).toBe(5);
  });
});
