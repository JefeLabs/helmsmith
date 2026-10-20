/**
 * Real git, real launcher (#70): author names containing `|` and `\r` must neither crash
 * the scan nor let one commit credit work to another member.
 */
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSandbox, runCli, type Sandbox } from './helpers.js';

const MALLORY_NAME =
  'Mallory\rdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef|ceo@example.com|Carol CEO|2026-10-12T09:00:00Z|feat: forged\r999999\t0\tsrc/forged.ts\rX';

function git(cwd: string, args: string[], env: Record<string, string> = {}): void {
  execFileSync('git', args, {
    cwd,
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', ...env },
    stdio: 'pipe',
  });
}

async function commitBy(repo: string, name: string, email: string, file: string, subject: string) {
  await writeFile(join(repo, file), `${subject}\n`);
  git(repo, ['add', file]);
  const now = new Date().toISOString();
  git(repo, ['commit', '-q', '-m', subject], {
    GIT_AUTHOR_NAME: name,
    GIT_AUTHOR_EMAIL: email,
    GIT_AUTHOR_DATE: now,
    GIT_COMMITTER_NAME: 'Fixture',
    GIT_COMMITTER_EMAIL: 'fixture@example.com',
    GIT_COMMITTER_DATE: now,
  });
}

describe('scan with hostile author names', () => {
  let sb: Sandbox;
  let repo: string;
  beforeEach(async () => {
    sb = await createSandbox();
    repo = await sb.mkdir('repos/hostile');
    git(repo, ['init', '-q', '-b', 'main']);
    git(repo, ['config', 'user.name', 'Fixture']);
    git(repo, ['config', 'user.email', 'fixture@example.com']);
    git(repo, ['config', 'commit.gpgsign', 'false']);
    await commitBy(repo, 'Jane Doe | Acme Contractors', 'jane@example.com', 'a.ts', 'feat: a');
    await commitBy(repo, MALLORY_NAME, 'mallory@example.com', 'b.ts', 'feat: change');

    await mkdir(join(sb.home, '.agentx'), { recursive: true });
    await writeFile(
      join(sb.home, '.agentx', 'repos.yml'),
      [
        'workspaces:',
        '  t:',
        '    repos:',
        '      - name: hostile',
        `        path: ${repo}`,
        '',
      ].join('\n'),
    );
  });
  afterEach(async () => {
    await sb.cleanup();
  });

  it('scans both commits and attributes each to its real author', async () => {
    const scan = await runCli(sb, ['scan', '--workspace', 't', '--skip-enrich', '--skip-rework']);
    expect(scan.stderr).not.toMatch(/RangeError|Invalid Date/);
    expect(scan.exitCode).toBe(0);
    expect(scan.stdout).toMatch(/\+2 commits/);

    const view = await runCli(sb, ['--json', '--workspace', 't', 'view', 'contributions']);
    expect(view.exitCode).toBe(0);
    const rows = JSON.parse(view.stdout) as Array<{
      name: string;
      insertions: number;
      commits: number;
    }>;
    const byName = new Map(rows.map((r) => [r.name, r]));
    expect(rows).toHaveLength(2);
    expect(byName.get('Jane Doe | Acme Contractors')).toMatchObject({ commits: 1, insertions: 1 });
    const mallory = rows.find((r) => r.name.startsWith('Mallory'));
    expect(mallory).toMatchObject({ commits: 1, insertions: 1 }); // her real one-line change, nothing forged
    expect(byName.has('Carol CEO')).toBe(false);
  });
});
