/**
 * Suspend wake-up scheduling (roadmap 2.6): timer-triggered suspends
 * wake themselves (armed at pause, re-armed at boot from the original
 * pausedAt — an expired-while-down timer fires immediately), and
 * event-triggered suspends wake through POST /v1/events when the event
 * type matches and the declared matcher passes against the event
 * envelope { type, payload }.
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
import type { Edge, FlowCatalog, FlowDef, SuspendTag, TaskStep } from '@helmsmith/harness-core';
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

/** t → worker (suspend-tagged) → builder. */
function suspendFlow(trigger: SuspendTag['trigger']): FlowDef {
  const nodes: TaskStep[] = [
    { id: '__trigger', kind: 'trigger', config: { kind: 'manual' } },
    {
      id: 'worker',
      kind: 'agent',
      config: {
        agent: { id: 'worker', role: 'Work', adapter: 'claude-sdk', systemPrompt: 'work' },
      },
      tags: { suspend: { trigger } as SuspendTag },
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
    { from: '__trigger', to: 'worker', type: 'sequence' },
    { from: 'worker', to: 'builder', type: 'sequence' },
  ];
  return { id: 'work-then-build', nodes, edges };
}

// biome-ignore lint/suspicious/noExplicitAny: test helper mirrors approval-resume-integration.test.ts
function udsJson(
  socketPath: string,
  method: string,
  path: string,
  body?: unknown,
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

describe('suspend wake-up scheduling (2.6)', () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const c of cleanups.splice(0)) await c();
  });

  async function bootServer(catalog: FlowCatalog, workspaceRoot?: string) {
    const ws = workspaceRoot ?? (await mkdtemp(join(tmpdir(), 'susp-ws-')));
    const socketPath = tmpSocket();
    const adapters: TestAdapter[] = [];
    const handle = await startHarnessServer({
      socketPath,
      catalog,
      broker: dummyBroker,
      adapterFactory: () => {
        const a = new TestAdapter(`reply-${adapters.length + 1}`);
        adapters.push(a);
        return a;
      },
      workspaceRoot: ws,
    });
    cleanups.push(async () => {
      await handle.stop();
      await rm(socketPath, { force: true });
      if (!workspaceRoot) await rm(ws, { recursive: true, force: true });
    });
    return { socketPath, adapters, handle, workspaceRoot: ws };
  }

  it('a timer suspend wakes itself and the flow completes without any caller', async () => {
    const { socketPath, adapters } = await bootServer({
      flows: [suspendFlow({ kind: 'timer', durationMs: 150 })],
    });

    await udsJson(socketPath, 'POST', '/v1/jobs', {
      jobId: 'jTimer',
      pipeline: 'work-then-build',
      input: 'work',
    });
    await waitFor(async () => {
      const r = await udsJson(socketPath, 'GET', '/v1/jobs/jTimer');
      return r.body.job?.status === 'suspended';
    });
    expect(adapters).toHaveLength(1);

    // No manual resume — the timer must fire the wake.
    await waitFor(async () => {
      const r = await udsJson(socketPath, 'GET', '/v1/jobs/jTimer');
      return r.body.job?.status === 'completed';
    });
    expect(adapters).toHaveLength(2); // worker + builder
  });

  it('a timer that expired while the server was down fires immediately after rehydration', async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'susp-restart-'));
    cleanups.push(() => rm(workspaceRoot, { recursive: true, force: true }));
    const catalog: FlowCatalog = { flows: [suspendFlow({ kind: 'timer', durationMs: 250 })] };

    const a = await bootServer(catalog, workspaceRoot);
    await udsJson(a.socketPath, 'POST', '/v1/jobs', {
      jobId: 'jSleep',
      pipeline: 'work-then-build',
      input: 'work',
    });
    await waitFor(async () => {
      const r = await udsJson(a.socketPath, 'GET', '/v1/jobs/jSleep');
      return r.body.job?.status === 'suspended';
    });
    await a.handle.stop();
    await rm(a.socketPath, { force: true });

    // Let the timer expire while no server is running.
    await new Promise((r) => setTimeout(r, 300));

    const b = await bootServer(catalog, workspaceRoot);
    await waitFor(async () => {
      const r = await udsJson(b.socketPath, 'GET', '/v1/jobs/jSleep');
      return r.body.job?.status === 'completed';
    });
  });

  it('an event suspend wakes via POST /v1/events when type and matcher agree', async () => {
    const { socketPath, adapters } = await bootServer({
      flows: [
        suspendFlow({
          kind: 'event',
          eventType: 'pr-merged',
          matcher: {
            kind: 'compare',
            lhs: { kind: 'jsonpath', path: '$.payload.branch' },
            op: '==',
            rhs: { kind: 'literal', value: 'main' },
          },
        }),
      ],
    });

    await udsJson(socketPath, 'POST', '/v1/jobs', {
      jobId: 'jEvent',
      pipeline: 'work-then-build',
      input: 'work',
    });
    await waitFor(async () => {
      const r = await udsJson(socketPath, 'GET', '/v1/jobs/jEvent');
      return r.body.job?.status === 'suspended';
    });

    // Wrong event type → no wake.
    const miss1 = await udsJson(socketPath, 'POST', '/v1/events', {
      type: 'pr-opened',
      payload: { branch: 'main' },
    });
    expect(miss1.status).toBe(200);
    expect(miss1.body.woke).toEqual([]);

    // Right type, matcher fails → no wake.
    const miss2 = await udsJson(socketPath, 'POST', '/v1/events', {
      type: 'pr-merged',
      payload: { branch: 'dev' },
    });
    expect(miss2.body.woke).toEqual([]);
    const still = await udsJson(socketPath, 'GET', '/v1/jobs/jEvent');
    expect(still.body.job?.status).toBe('suspended');

    // Right type, matcher passes → wake and complete.
    const hit = await udsJson(socketPath, 'POST', '/v1/events', {
      type: 'pr-merged',
      payload: { branch: 'main' },
    });
    expect(hit.body.woke).toEqual(['jEvent']);
    await waitFor(async () => {
      const r = await udsJson(socketPath, 'GET', '/v1/jobs/jEvent');
      return r.body.job?.status === 'completed';
    });
    expect(adapters).toHaveLength(2);
  });

  it('rejects malformed event ingests', async () => {
    const { socketPath } = await bootServer({
      flows: [suspendFlow({ kind: 'timer', durationMs: 60_000 })],
    });
    const bad = await udsJson(socketPath, 'POST', '/v1/events', { payload: {} });
    expect(bad.status).toBe(400);
  });
});
