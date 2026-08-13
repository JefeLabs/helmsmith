/**
 * Unit tests for the `kind: 'publish'` executor.
 *
 * Covers the pre-flight error paths that don't touch `git` or the
 * network — credential wiring, repo selection, and PR-URL parsing. The
 * happy paths (real `git push` + GitHub REST round-trips) are exercised
 * by the Gate 2d E2E test against a live repo, not here.
 */

import type { GitHubCredential, GitHubCredentialResolver } from '@helmsmith/agent-auth';
import { describe, expect, it } from 'vitest';
import type { TaskStep } from './catalog.ts';
import { FlowState, type FlowStateT } from './flow-graph.ts';
import type { JobRecord } from './job.ts';
import { findOrCreatePr, makePublishExecutor } from './publish-executor.ts';

const STUB_RESOLVER: GitHubCredentialResolver = {
  resolve: async (): Promise<GitHubCredential | null> => ({ token: 'tok', source: 'local-gh-cli' }),
};

function freshState(jobId: string): FlowStateT {
  void FlowState;
  return {
    jobId,
    input: null,
    output: '',
    nodes: {},
    messages: [],
    attempts: {},
    lastExit: null,
    rejectionPayload: null,
    steering: [],
    cancelRequested: false,
    cancelReason: null,
    changedFiles: [],
    __completions: {},
    __joinSkips: {},
  } as FlowStateT;
}

function pushNode(config: Record<string, unknown>): TaskStep {
  return {
    id: 'pub',
    kind: 'publish',
    config: { action: 'push-and-open-pr', ...config },
  } as TaskStep;
}
function mergeNode(config: Record<string, unknown> = {}): TaskStep {
  return { id: 'mrg', kind: 'publish', config: { action: 'merge-pr', ...config } } as TaskStep;
}
function job(over: Partial<JobRecord>): JobRecord {
  return {
    jobId: 'job_test',
    submittedAt: new Date().toISOString(),
    status: 'running',
    agents: [],
    ...over,
  } as JobRecord;
}

describe('makePublishExecutor', () => {
  it('fails with UnconfiguredGitHub when no resolver is supplied', async () => {
    const run = makePublishExecutor(pushNode({}), { job: job({}) });
    const delta = await run(freshState('job_test'));
    expect(delta.lastExit).toMatchObject({ kind: 'error', errorName: 'UnconfiguredGitHub' });
  });

  it('throws if given a non-publish node', () => {
    const bad = { id: 'x', kind: 'tool', config: { toolId: 't' } } as unknown as TaskStep;
    expect(() => makePublishExecutor(bad, { job: job({}) })).toThrow(/expected "publish"/);
  });

  describe('push-and-open-pr', () => {
    it('fails with AmbiguousRepo when product has multiple repos and no config.repo', async () => {
      const run = makePublishExecutor(pushNode({}), {
        job: job({ productRepos: ['a', 'b'], workdirRoot: '/tmp/ws' }),
        githubResolver: STUB_RESOLVER,
      });
      const delta = await run(freshState('job_test'));
      expect(delta.lastExit).toMatchObject({ kind: 'error', errorName: 'AmbiguousRepo' });
    });

    it('fails with NoWorkdir when workdirRoot is unset', async () => {
      const run = makePublishExecutor(pushNode({ repo: 'a' }), {
        job: job({ productRepos: ['a'] }),
        githubResolver: STUB_RESOLVER,
      });
      const delta = await run(freshState('job_test'));
      expect(delta.lastExit).toMatchObject({ kind: 'error', errorName: 'NoWorkdir' });
    });
  });

  describe('merge-pr', () => {
    it('fails with NoPr when JobRecord.prUrl is unset', async () => {
      const run = makePublishExecutor(mergeNode(), { job: job({}), githubResolver: STUB_RESOLVER });
      const delta = await run(freshState('job_test'));
      expect(delta.lastExit).toMatchObject({ kind: 'error', errorName: 'NoPr' });
    });

    it('fails with UnparseablePrUrl when prUrl is not a recognisable PR URL', async () => {
      const run = makePublishExecutor(mergeNode(), {
        job: job({ prUrl: 'https://example.com/not-a-pr' }),
        githubResolver: STUB_RESOLVER,
      });
      const delta = await run(freshState('job_test'));
      expect(delta.lastExit).toMatchObject({ kind: 'error', errorName: 'UnparseablePrUrl' });
    });
  });

  describe('idempotency by natural key (2.8)', () => {
    const cred: GitHubCredential = { token: 'tok', source: 'local-gh-cli' };
    const prParams = { title: 't', head: 'feat-x', base: 'main', body: '', draft: false };

    function jsonResponse(v: unknown): Response {
      return new Response(JSON.stringify(v), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    it('findOrCreatePr reuses an existing open PR for the head branch without POSTing', async () => {
      const calls: string[] = [];
      const fetchFn = (async (url: RequestInfo | URL, init?: RequestInit) => {
        calls.push(`${init?.method} ${String(url)}`);
        if (init?.method === 'GET') {
          return jsonResponse([{ html_url: 'https://github.com/o/r/pull/7', number: 7 }]);
        }
        throw new Error(`unexpected ${init?.method} call`);
      }) as typeof fetch;
      const pr = await findOrCreatePr(fetchFn, cred, { owner: 'o', name: 'r' }, prParams);
      expect(pr).toMatchObject({
        html_url: 'https://github.com/o/r/pull/7',
        number: 7,
        reused: true,
      });
      expect(calls.some((c) => c.startsWith('POST'))).toBe(false);
      expect(calls[0]).toContain('head=o%3Afeat-x');
    });

    it('findOrCreatePr creates a PR when no open one exists for the branch', async () => {
      const calls: string[] = [];
      const fetchFn = (async (url: RequestInfo | URL, init?: RequestInit) => {
        calls.push(`${init?.method} ${String(url)}`);
        if (init?.method === 'GET') return jsonResponse([]);
        return jsonResponse({ html_url: 'https://github.com/o/r/pull/8', number: 8 });
      }) as typeof fetch;
      const pr = await findOrCreatePr(fetchFn, cred, { owner: 'o', name: 'r' }, prParams);
      expect(pr).toMatchObject({ number: 8, reused: false });
      expect(calls.filter((c) => c.startsWith('POST')).length).toBe(1);
    });

    it('merge-pr short-circuits without any API call when job.mergeSha is set', async () => {
      let fetchCalls = 0;
      const fetchFn = (async () => {
        fetchCalls++;
        throw new Error('network must not be touched');
      }) as unknown as typeof fetch;
      const run = makePublishExecutor(mergeNode(), {
        job: job({ prUrl: 'https://github.com/o/r/pull/7', mergeSha: 'abc123' }),
        githubResolver: STUB_RESOLVER,
        fetchFn,
      });
      const delta = await run(freshState('job_test'));
      expect(delta.lastExit).toMatchObject({ kind: 'success' });
      expect(JSON.parse(delta.output as string)).toMatchObject({ mergeSha: 'abc123' });
      expect(fetchCalls).toBe(0);
    });
  });
});
