/**
 * The headless (`--json`) merge and pick flows: every repo ends either done or exactly
 * as it started, and its row says which. Real repos; the agent is a fake.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { MergeTarget, RepoConfig } from '../config/schema.js';
import type { MergePickRow } from '../output/contract.js';
import { type ConflictRepo, makeConflictRepo } from '../test/conflict-fixture.js';
import { cleanupFixtures } from '../test/git-fixture.js';
import type { AgentReply } from './copilot-agent.js';
import { GitOperations } from './git-operations.js';
import {
  type AgentSetup,
  type RunOptions,
  resolveAgentMode,
  runMergeJson,
  setupAgent,
  toMergePickDocument,
} from './json-operations.js';

afterAll(cleanupFixtures);

const RESOLVED = 'a\nRESOLVED\nc\n';
const resolves: AgentReply = async () => RESOLVED;
const refuses: AgentReply = async () => '<<<<<<< x\n';

function agentSetup(reply: AgentReply): AgentSetup {
  return {
    mode: 'auto',
    modeSource: 'manifest',
    model: 'test-model',
    available: true,
    reply: vi.fn(reply),
  };
}

const config = (repo: ConflictRepo, name = 'app'): RepoConfig =>
  ({ name, path: repo.path, remote: 'origin', branches: {}, tags: [] }) as RepoConfig;

const target = (repo: ConflictRepo, sourceBranch: string, name = 'app'): MergeTarget => ({
  repo: config(repo, name),
  sourceBranch,
  targetBranch: 'main',
});

const deps = (reply: AgentReply = resolves) => ({
  getGit: (r: RepoConfig) => new GitOperations(r.path),
  agent: agentSetup(reply),
});

const OFFLINE: RunOptions = { fetch: false, push: false, pr: false };
const mergeHeadExists = (repo: ConflictRepo) =>
  repo.git.raw(['rev-parse', '--verify', 'MERGE_HEAD']).then(
    () => true,
    () => false,
  );

describe('resolveAgentMode', () => {
  it('reads a manifest suggest as auto (suggest is for people)', () => {
    expect(resolveAgentMode(undefined, 'suggest')).toEqual({
      mode: 'auto',
      modeSource: 'manifest',
    });
  });

  it('lets the flag win over the manifest', () => {
    expect(resolveAgentMode('manual', 'auto')).toEqual({ mode: 'manual', modeSource: 'flag' });
  });
});

describe('setupAgent', () => {
  it('checks nothing in manual mode and reports availability as unknown', async () => {
    const check = vi.fn();
    const setup = await setupAgent('manual', 'manifest', 'm', { check, make: vi.fn() });

    expect(check).not.toHaveBeenCalled();
    expect(setup).toMatchObject({ mode: 'manual', available: null, reply: null });
  });

  it('carries the reason when the agent is unavailable', async () => {
    const setup = await setupAgent('auto', 'flag', 'm', {
      check: async () => ({ available: false, reason: 'no token' }),
      make: vi.fn(),
    });

    expect(setup).toMatchObject({ available: false, reply: null, unavailableReason: 'no token' });
  });
});

describe('runMergeJson', () => {
  it('merges a clean branch and reports the new head', async () => {
    const repo = await makeConflictRepo();
    const before = await repo.sha('main');

    const [row] = await runMergeJson([target(repo, 'side')], deps(), OFFLINE);

    expect(row).toMatchObject({
      repo: 'app',
      sourceRef: 'side',
      targetRef: 'main',
      status: 'success',
      resolvedBy: null,
      conflicts: [],
      rolledBack: false,
      pushed: false,
      pr: null,
    });
    expect(row?.head).not.toBe(before);
    expect(row?.head).toBe(await repo.sha('main'));
    expect(await repo.currentBranch()).toBe('main');
  });

  it('commits the agent’s resolution as a merge carrying the Resolved-by trailer', async () => {
    const repo = await makeConflictRepo();

    const [row] = await runMergeJson([target(repo, 'feature')], deps(resolves), OFFLINE);

    expect(row).toMatchObject({
      status: 'success',
      resolvedBy: 'agent',
      conflicts: [{ path: 'f.txt', outcome: 'resolved' }],
      head: await repo.sha('main'),
    });
    const parents = (await repo.git.raw(['log', '-1', '--format=%P', 'main'])).trim().split(' ');
    expect(parents).toHaveLength(2);
    const body = (await repo.git.raw(['log', '-1', '--format=%B', 'main'])).trimEnd();
    expect(body.endsWith('Resolved-by: gittyup agent (test-model)')).toBe(true);
  });

  it('rolls back when the agent cannot resolve, leaving main where it was', async () => {
    const repo = await makeConflictRepo();
    const before = await repo.sha('main');

    const [row] = await runMergeJson([target(repo, 'feature')], deps(refuses), OFFLINE);

    expect(row).toMatchObject({ status: 'conflict', rolledBack: true, head: before });
    expect(row?.conflicts[0]?.outcome).toBe('agent_refused');
    expect(await repo.sha('main')).toBe(before);
    expect(await mergeHeadExists(repo)).toBe(false);
  });

  it('rolls back when the agent throws', async () => {
    const repo = await makeConflictRepo();
    const throws: AgentReply = async () => {
      throw new Error('rate limited');
    };

    const [row] = await runMergeJson([target(repo, 'feature')], deps(throws), OFFLINE);

    expect(row).toMatchObject({ status: 'conflict', rolledBack: true });
    expect(row?.conflicts[0]?.outcome).toBe('agent_error');
  });

  it('puts the start branch and uncommitted work back after a rollback', async () => {
    const repo = await makeConflictRepo();
    await repo.git.checkout('side');
    writeFileSync(join(repo.path, 'g.txt'), 'G edited\n');

    const [row] = await runMergeJson([target(repo, 'feature')], deps(refuses), OFFLINE);

    expect(row?.status).toBe('conflict');
    expect(await repo.currentBranch()).toBe('side');
    expect(await repo.read('g.txt')).toBe('G edited\n');
  });

  it('reports a missing source as an error for that repo and still runs the next', async () => {
    const first = await makeConflictRepo();
    const second = await makeConflictRepo();
    const firstBefore = await first.sha('main');

    const rows = await runMergeJson(
      [target(first, 'nope', 'one'), target(second, 'side', 'two')],
      deps(),
      OFFLINE,
    );

    expect(rows[0]).toMatchObject({ repo: 'one', status: 'error', head: firstBefore });
    expect(rows[0]?.error).toEqual(expect.any(String));
    expect(rows[1]).toMatchObject({ repo: 'two', status: 'success' });
  });

  it('says so when the target already contains the source, without a new commit', async () => {
    const repo = await makeConflictRepo();
    await runMergeJson([target(repo, 'side')], deps(), OFFLINE);
    const head = await repo.sha('main');

    const [row] = await runMergeJson([target(repo, 'side')], deps(), OFFLINE);

    expect(row).toMatchObject({
      status: 'success',
      head,
      message: expect.stringMatching(/already/),
    });
  });

  it('turns a rejected push into an error row that keeps the local head', async () => {
    const repo = await makeConflictRepo();

    const [row] = await runMergeJson([target(repo, 'side')], deps(), { ...OFFLINE, push: true });

    expect(row).toMatchObject({
      status: 'error',
      pushed: false,
      error: expect.stringMatching(/^push failed/),
      head: await repo.sha('main'),
    });
  });

  it('skips a repo whose fetch fails, touching nothing', async () => {
    const repo = await makeConflictRepo();
    const before = await repo.sha('main');

    const [row] = await runMergeJson([target(repo, 'side')], deps(), { ...OFFLINE, fetch: true });

    expect(row).toMatchObject({
      status: 'skipped',
      error: expect.stringMatching(/^fetch failed/),
      head: before,
    });
    expect(await repo.sha('main')).toBe(before);
  });

  it('reports --pr as skipped until --branch exists', async () => {
    const repo = await makeConflictRepo();

    const [row] = await runMergeJson([target(repo, 'side')], deps(), { ...OFFLINE, pr: true });

    expect(row?.pr).toEqual({
      status: 'skipped',
      reason: expect.stringContaining('needs --branch'),
    });
  });
});

describe('toMergePickDocument', () => {
  it('counts rows by status', () => {
    const row = (status: MergePickRow['status']): MergePickRow => ({
      repo: status,
      sourceRef: 's',
      targetRef: 't',
      status,
      message: '',
      resolvedBy: null,
      conflicts: [],
      rolledBack: false,
      head: null,
      pushed: false,
      pr: null,
    });

    const doc = toMergePickDocument(
      'merge',
      's',
      't',
      agentSetup(resolves),
      ['success', 'conflict', 'error', 'skipped'].map((s) => row(s as MergePickRow['status'])),
    );

    expect(doc.summary).toEqual({ repos: 4, success: 1, conflict: 1, error: 1, skipped: 1 });
    expect(doc.agent).toEqual({
      mode: 'auto',
      modeSource: 'manifest',
      model: 'test-model',
      available: true,
    });
  });
});
