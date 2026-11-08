/**
 * `merge`/`pick --json` through the built CLI (spec §5). `runCli` blanks every
 * GitHub token, so the agent is never available here: a conflict always rolls back.
 * The agent-resolved paths are covered by src/core/json-operations.test.ts.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { type ConflictRepo, makeConflictRepo } from '../../src/test/conflict-fixture.js';
import { cleanupFixtures } from '../../src/test/git-fixture.js';
import {
  createWorkspace,
  parseErrorLine,
  parseJsonLine,
  runCli,
  type Workspace,
} from './helpers.js';

let ws: Workspace | undefined;
afterEach(async () => {
  await ws?.cleanup();
  ws = undefined;
  await cleanupFixtures();
});

/** A workspace whose manifest has one repo, `app` in group `web`, at the fixture. */
async function workspaceFor(repo: ConflictRepo, settings?: Record<string, unknown>) {
  ws = await createWorkspace({
    workspace: '.',
    ...(settings ? { settings } : {}),
    groups: {
      web: {
        repos: [{ name: 'app', path: repo.path, remote: 'origin', branches: {}, tags: [] }],
      },
    },
  });
  return ws;
}

const exists = (repo: ConflictRepo, ref: string) =>
  repo.git.raw(['rev-parse', '--verify', ref]).then(
    () => true,
    () => false,
  );

describe('merge/pick --json refusals', () => {
  it.each([
    [['merge', 'feature', 'main', '-r', 'app', '--json'], 'CONFIRMATION_REQUIRED'],
    [['merge', 'feature', 'main', '--yes', '--json'], 'TARGET_REQUIRED'],
    [
      ['merge', 'feature', 'main', '-r', 'app', '--yes', '--ai', 'suggest', '--json'],
      'INTERACTIVE_ONLY',
    ],
    [['merge', 'feature', 'main', '-r', 'app', '--yes', '--ai', 'bogus', '--json'], 'USAGE'],
    [['pick', '-r', 'app', '-s', 'feature', '-t', 'main', '--yes', '--json'], 'INTERACTIVE_ONLY'],
    [
      ['pick', '-r', 'app', '-s', 'feature', '-t', 'main', '-i', '--yes', '--json'],
      'INTERACTIVE_ONLY',
    ],
    [['pick', '-r', 'app', '-t', 'main', '-c', 'ADD_A', '--yes', '--json'], 'USAGE'],
    [['merge', 'feature', 'main', '-g', 'nope', '--yes', '--json'], 'TARGET_UNKNOWN'],
  ])('%j → %s, touching nothing', async (args, code) => {
    const repo = await makeConflictRepo();
    const before = await repo.sha('main');
    await workspaceFor(repo);

    const r = await runCli(
      ws as Workspace,
      args.map((a) => (a === 'ADD_A' ? repo.c.addA : a)),
    );

    expect(r.stdout).toBe('');
    expect(r.exitCode).toBe(2);
    expect(parseErrorLine(r.stderr).code).toBe(code);
    expect(await repo.sha('main')).toBe(before);
  });
});

describe('merge --json', () => {
  it('rolls a conflicting merge back when no agent is available, restoring branch and work', async () => {
    const repo = await makeConflictRepo();
    const before = await repo.sha('main');
    await repo.git.checkout('side');
    writeFileSync(join(repo.path, 'g.txt'), 'G edited\n');
    await workspaceFor(repo);

    const r = await runCli(ws as Workspace, [
      'merge',
      'feature',
      'main',
      '-r',
      'app',
      '--yes',
      '--no-fetch',
      '--json',
    ]);

    expect(r.exitCode).toBe(1);
    const doc = parseJsonLine(r.stdout);
    expect(doc).toMatchObject({
      operation: 'merge',
      source: 'feature',
      target: 'main',
      agent: { mode: 'auto', modeSource: 'manifest', model: 'gpt-4o', available: false },
      summary: { repos: 1, success: 0, conflict: 1, error: 0, skipped: 0 },
    });
    expect(doc.repos[0]).toMatchObject({
      repo: 'app',
      status: 'conflict',
      rolledBack: true,
      head: before,
      conflicts: [
        {
          path: 'f.txt',
          outcome: 'agent_unavailable',
          reason: expect.stringContaining('auth login'),
        },
      ],
    });
    expect(await repo.sha('main')).toBe(before);
    expect(await exists(repo, 'MERGE_HEAD')).toBe(false);
    expect(await repo.currentBranch()).toBe('side');
    expect(await repo.read('g.txt')).toBe('G edited\n');
  });

  it('merges a clean branch and exits 0', async () => {
    const repo = await makeConflictRepo();
    await workspaceFor(repo);

    const r = await runCli(ws as Workspace, [
      'merge',
      'side',
      'main',
      '-r',
      'app',
      '--yes',
      '--no-fetch',
      '--json',
    ]);

    expect(r.exitCode).toBe(0);
    const doc = parseJsonLine(r.stdout);
    expect(doc.repos[0]).toMatchObject({ status: 'success', head: await repo.sha('main') });
    expect(doc.summary).toEqual({ repos: 1, success: 1, conflict: 0, error: 0, skipped: 0 });
  });

  it('honours a manifest set to manual: the agent is never asked', async () => {
    const repo = await makeConflictRepo();
    await workspaceFor(repo, { ai_mode: 'manual' });

    const r = await runCli(ws as Workspace, [
      'merge',
      'feature',
      'main',
      '-r',
      'app',
      '--yes',
      '--no-fetch',
      '--json',
    ]);

    const doc = parseJsonLine(r.stdout);
    expect(doc.agent).toMatchObject({ mode: 'manual', modeSource: 'manifest', available: null });
    expect(doc.repos[0].conflicts[0].outcome).toBe('not_attempted');
  });

  it('lets --ai auto override a manifest set to manual', async () => {
    const repo = await makeConflictRepo();
    await workspaceFor(repo, { ai_mode: 'manual' });

    const r = await runCli(ws as Workspace, [
      'merge',
      'feature',
      'main',
      '-r',
      'app',
      '--yes',
      '--no-fetch',
      '--ai',
      'auto',
      '--json',
    ]);

    expect(parseJsonLine(r.stdout).agent).toMatchObject({ mode: 'auto', modeSource: 'flag' });
  });

  it('skips a repo whose pre-fetch fails and touches nothing', async () => {
    const repo = await makeConflictRepo();
    const before = await repo.sha('main');
    await workspaceFor(repo);

    const r = await runCli(ws as Workspace, [
      'merge',
      'side',
      'main',
      '-r',
      'app',
      '--yes',
      '--json',
    ]);

    expect(r.exitCode).toBe(1);
    expect(parseJsonLine(r.stdout).repos[0]).toMatchObject({
      status: 'skipped',
      error: expect.stringMatching(/^fetch failed/),
    });
    expect(await repo.sha('main')).toBe(before);
  });
});

describe('pick --json', () => {
  it('undoes the commits it applied when commit 2 of 3 conflicts and no agent is available', async () => {
    const repo = await makeConflictRepo();
    const before = await repo.sha('main');
    const { addA, changeF, addB } = repo.c;
    await workspaceFor(repo);

    const r = await runCli(ws as Workspace, [
      'pick',
      '-r',
      'app',
      '-s',
      'feature',
      '-t',
      'main',
      '-c',
      addA,
      changeF,
      addB,
      '--yes',
      '--no-fetch',
      '--json',
    ]);

    expect(r.exitCode).toBe(1);
    const doc = parseJsonLine(r.stdout);
    expect(doc).toMatchObject({ operation: 'pick', source: 'feature', target: 'main' });
    expect(doc.repos[0]).toMatchObject({
      status: 'conflict',
      rolledBack: true,
      stoppedAt: changeF,
      commits: { requested: [addA, changeF, addB], applied: [] },
      head: before,
    });
    expect(await repo.sha('main')).toBe(before);
    expect(await exists(repo, 'CHERRY_PICK_HEAD')).toBe(false);
  });
});
