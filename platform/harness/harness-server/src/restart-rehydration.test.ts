/**
 * Restart-survival integration test for HITL (roadmap 2.2).
 *
 * Boots server A on a temp workspace, runs an approval flow to
 * 'awaiting-approval', STOPS server A (in-memory jobs/graphs/pending
 * maps are gone — a simulated restart), boots server B on the same
 * workspace root, and proves the paused job came back: the pending
 * ApprovalRequest is served, POST resume approves it, and the flow runs
 * to completion WITHOUT re-running the planner — the paused thread
 * state came from the durable SQLite checkpointer and the graph was
 * recompiled from the persisted JobRecord's flow (recompile-on-resume).
 */

import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  AdapterCapabilities,
  AgentAdapter,
  AgentChunk,
  AgentInput,
  AgentInvocationResult,
} from '@helmsmith/agent-adapter';
import type { CredentialBroker, Provider } from '@helmsmith/agent-auth';
import type { Edge, FlowCatalog, FlowDef, TaskStep } from '@helmsmith/harness-core';
import { afterEach, describe, expect, it } from 'vitest';
import { startHarnessServer } from './index.ts';

const tmpSocket = () => join(tmpdir(), `ax-${randomUUID().slice(0, 8)}.sock`);

const dummyBroker: CredentialBroker = {
  async getCredential(provider) {
    return { provider: provider as Provider, apiKey: 'test', source: 'env' };
  },
};

const STUB_CAPS: AdapterCapabilities = {
  reportsUsage: false,
  supportsStreaming: false,
  supportsToolUse: false,
  toolUseMode: 'none',
  supportsExtendedThinking: false,
  supportsCancellation: false,
  supportsCapture: false,
  supportsJsonMode: false,
  supportsSessionResume: false,
};

class TestAdapter implements AgentAdapter {
  readonly type = 'claude-sdk' as const;
  readonly capabilities = STUB_CAPS;
  readonly workdir = '/test/workdir';
  readonly invokeCalls: AgentInput[] = [];
  constructor(private readonly reply: string) {}
  async invoke(input: AgentInput): Promise<AgentInvocationResult> {
    this.invokeCalls.push(input);
    return { content: this.reply, durationMs: 0 };
  }
  // biome-ignore lint/correctness/useYield: stub never emits chunks.
  async *stream(): AsyncIterable<AgentChunk> {
    throw new Error('TestAdapter.stream is not used by runJob');
  }
}

/** Approval-tagged 2-step flow: planner (Approval) → builder. */
function approvalFlow(): FlowDef {
  const nodes: TaskStep[] = [
    { id: '__trigger', kind: 'trigger', config: { kind: 'manual' } },
    {
      id: 'planner',
      kind: 'agent',
      config: {
        agent: { id: 'planner', role: 'Plan', adapter: 'claude-sdk', systemPrompt: 'plan' },
      },
      tags: {
        approval: { assigneeRole: 'tech-lead', slaMs: 60_000, concurrency: 'pessimistic' },
      },
    },
    {
      id: 'builder',
      kind: 'agent',
      config: {
        agent: { id: 'builder', role: 'Build', adapter: 'claude-sdk', systemPrompt: 'build' },
      },
    },
  ];
  const edges: Edge[] = [
    { from: '__trigger', to: 'planner', type: 'sequence' },
    { from: 'planner', to: 'builder', type: 'sequence' },
    { from: 'planner', to: 'planner', type: 'reject', maxAttempts: 3 },
  ];
  return { id: 'plan-then-build', nodes, edges };
}

const catalog: FlowCatalog = { flows: [approvalFlow()] };

function udsJson(
  socketPath: string,
  method: string,
  path: string,
  body?: unknown,
  headers?: Record<string, string>,
  // biome-ignore lint/suspicious/noExplicitAny: test helper mirrors approval-resume-integration.test.ts
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = request(
      {
        socketPath,
        method,
        path,
        headers: {
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
          ...headers,
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode ?? 0, body: data ? JSON.parse(data) : {} });
          } catch (err) {
            reject(err);
          }
        });
      },
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`waitFor: condition not met within ${timeoutMs}ms`);
}

describe('HITL restart survival (durable checkpointer + paused-job rehydration)', () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const c of cleanups.splice(0)) await c();
  });

  it('rehydrates a paused job after a restart and resumes it to completion', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'hitl-ws-'));
    cleanups.push(() => rm(workspaceRoot, { recursive: true, force: true }));
    const adapters: TestAdapter[] = [];
    const adapterFactory = () => {
      const a = new TestAdapter(`reply-${adapters.length + 1}`);
      adapters.push(a);
      return a;
    };

    // ── Server A: submit, pause at approval, then "crash".
    const socketA = tmpSocket();
    const serverA = await startHarnessServer({
      socketPath: socketA,
      catalog,
      broker: dummyBroker,
      adapterFactory,
      workspaceRoot,
    });

    await udsJson(socketA, 'POST', '/v1/jobs', {
      jobId: 'jRestart',
      pipeline: 'plan-then-build',
      input: 'design the auth module',
    });
    await waitFor(async () => {
      const r = await udsJson(socketA, 'GET', '/v1/jobs/jRestart');
      return r.body.job?.status === 'awaiting-approval';
    });
    expect(adapters).toHaveLength(1);

    await serverA.stop();
    await rm(socketA, { force: true });

    // ── Server B: same workspace, fresh process-level state.
    const socketB = tmpSocket();
    const serverB = await startHarnessServer({
      socketPath: socketB,
      catalog,
      broker: dummyBroker,
      adapterFactory,
      workspaceRoot,
    });
    cleanups.push(async () => {
      await serverB.stop();
      await rm(socketB, { force: true });
    });

    // The rehydrated job + pending approval are served by the new process.
    const job = await udsJson(socketB, 'GET', '/v1/jobs/jRestart');
    expect(job.status).toBe(200);
    expect(job.body.job?.status).toBe('awaiting-approval');
    const approval = await udsJson(socketB, 'GET', '/v1/jobs/jRestart/approval');
    expect(approval.status).toBe(200);
    expect(approval.body.request?.nodeId).toBe('planner');
    expect(approval.body.request?.content).toBe('reply-1');

    // Approve on the NEW server — the graph recompiles from the persisted
    // flow and picks the paused thread up from the SQLite checkpointer.
    const resume = await udsJson(
      socketB,
      'POST',
      '/v1/jobs/jRestart/resume',
      { decision: 'approve' },
      { 'x-actor-role': 'tech-lead' },
    );
    expect(resume.status).toBe(200);

    await waitFor(async () => {
      const r = await udsJson(socketB, 'GET', '/v1/jobs/jRestart');
      return r.body.job?.status === 'completed';
    });

    // Planner did NOT re-run across the restart: exactly one planner
    // invocation on server A, one builder invocation on server B.
    expect(adapters).toHaveLength(2);
    expect(adapters[0]?.invokeCalls).toHaveLength(1);
    expect(adapters[1]?.invokeCalls).toHaveLength(1);

    // The pause record is gone — a second restart won't resurrect it.
    const after = await udsJson(socketB, 'GET', '/v1/jobs/jRestart/approval');
    expect(after.status).toBe(404);
  });
});

describe('approval SLA auto-reject (2.1)', () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const c of cleanups.splice(0)) await c();
  });

  /** Same planner→builder shape but with a short, test-controlled SLA. */
  function slaCatalog(slaMs: number): FlowCatalog {
    const flow = approvalFlow();
    const planner = flow.nodes.find((n) => n.id === 'planner');
    if (planner?.tags?.approval) planner.tags.approval.slaMs = slaMs;
    return { flows: [flow] };
  }

  async function bootServer(slaMs: number) {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'sla-ws-'));
    const socketPath = tmpSocket();
    const adapters: TestAdapter[] = [];
    const handle = await startHarnessServer({
      socketPath,
      catalog: slaCatalog(slaMs),
      broker: dummyBroker,
      adapterFactory: () => {
        const a = new TestAdapter(`reply-${adapters.length + 1}`);
        adapters.push(a);
        return a;
      },
      workspaceRoot,
    });
    cleanups.push(async () => {
      await handle.stop();
      await rm(socketPath, { force: true });
      await rm(workspaceRoot, { recursive: true, force: true });
    });
    return { socketPath, adapters };
  }

  it('auto-rejects on SLA expiry: the reject edge re-runs the planner, a second approval follows', async () => {
    const { socketPath, adapters } = await bootServer(150);

    await udsJson(socketPath, 'POST', '/v1/jobs', {
      jobId: 'jSla',
      pipeline: 'plan-then-build',
      input: 'work',
    });
    await waitFor(async () => {
      const r = await udsJson(socketPath, 'GET', '/v1/jobs/jSla');
      return r.body.job?.status === 'awaiting-approval';
    });
    expect(adapters).toHaveLength(1);

    // Do NOT resume. The SLA timer must fire the reject edge — the
    // planner re-runs (adapter #2) and the flow pauses at attempt 2.
    await waitFor(async () => adapters.length === 2);
    await waitFor(async () => {
      const r = await udsJson(socketPath, 'GET', '/v1/jobs/jSla/approval');
      return r.status === 200 && r.body.request?.attempt === 2;
    });

    // A human approves the second attempt in time → completes.
    await udsJson(
      socketPath,
      'POST',
      '/v1/jobs/jSla/resume',
      { decision: 'approve' },
      { 'x-actor-role': 'tech-lead' },
    );
    await waitFor(async () => {
      const r = await udsJson(socketPath, 'GET', '/v1/jobs/jSla');
      return r.body.job?.status === 'completed';
    });
    expect(adapters).toHaveLength(3); // planner, planner-rerun, builder
  });

  it('does not fire after a timely manual resume', async () => {
    const { socketPath, adapters } = await bootServer(300);

    await udsJson(socketPath, 'POST', '/v1/jobs', {
      jobId: 'jTimely',
      pipeline: 'plan-then-build',
      input: 'work',
    });
    await waitFor(async () => {
      const r = await udsJson(socketPath, 'GET', '/v1/jobs/jTimely');
      return r.body.job?.status === 'awaiting-approval';
    });

    await udsJson(
      socketPath,
      'POST',
      '/v1/jobs/jTimely/resume',
      { decision: 'approve' },
      { 'x-actor-role': 'tech-lead' },
    );
    await waitFor(async () => {
      const r = await udsJson(socketPath, 'GET', '/v1/jobs/jTimely');
      return r.body.job?.status === 'completed';
    });

    // Wait past the SLA — the cancelled timer must not reject/re-run.
    await new Promise((r) => setTimeout(r, 400));
    const after = await udsJson(socketPath, 'GET', '/v1/jobs/jTimely');
    expect(after.body.job?.status).toBe('completed');
    expect(adapters).toHaveLength(2); // planner + builder only
  });
});
