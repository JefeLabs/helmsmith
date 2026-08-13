/**
 * Trigger ingress (roadmap 3.1): webhook triggers fire via
 * POST/GET /v1/hooks/<path>, event triggers fire via POST /v1/events
 * (same envelope + matcher semantics as suspend wakes), and schedule
 * triggers are armed at boot (inspectable via GET /v1/triggers; the
 * cron math itself is unit-tested in cron.test.ts). All three spawn
 * through the same dispatcher path as HTTP submissions.
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
import type { FlowCatalog, FlowDef, TriggerConfig } from '@helmsmith/harness-core';
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

function triggeredFlow(id: string, trigger: TriggerConfig): FlowDef {
  return {
    id,
    nodes: [
      { id: '__trigger', kind: 'trigger', config: trigger },
      {
        id: 'worker',
        kind: 'agent',
        config: { agent: { id: 'worker', role: 'W', adapter: 'claude-sdk', systemPrompt: 'go' } },
      },
    ],
    edges: [{ from: '__trigger', to: 'worker', type: 'sequence' }],
  };
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

describe('trigger ingress (3.1)', () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const c of cleanups.splice(0)) await c();
  });

  async function bootServer(catalog: FlowCatalog) {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'trig-ws-'));
    const socketPath = tmpSocket();
    const adapters: TestAdapter[] = [];
    const handle = await startHarnessServer({
      socketPath,
      workspaceRoot,
      catalog,
      broker: dummyBroker,
      adapterFactory: () => {
        const a = new TestAdapter(`reply-${adapters.length + 1}`);
        adapters.push(a);
        return a;
      },
    });
    cleanups.push(async () => {
      await handle.stop();
      await rm(socketPath, { force: true });
      await rm(workspaceRoot, { recursive: true, force: true });
    });
    return { socketPath, adapters };
  }

  it('a webhook trigger fires its flow with the request body as input', async () => {
    const { socketPath } = await bootServer({
      flows: [triggeredFlow('deploy-flow', { kind: 'webhook', path: 'deploy', method: 'POST' })],
    });

    const hit = await udsJson(socketPath, 'POST', '/v1/hooks/deploy', { ref: 'main' });
    expect(hit.status).toBe(200);
    expect(hit.body.started).toHaveLength(1);
    const jobId = hit.body.started[0];

    await waitFor(async () => {
      const r = await udsJson(socketPath, 'GET', `/v1/jobs/${jobId}`);
      return r.body.job?.status === 'completed';
    });
    const job = await udsJson(socketPath, 'GET', `/v1/jobs/${jobId}`);
    expect(job.body.job.pipeline).toBe('deploy-flow');
    expect(job.body.job.triggeredBy).toBe('webhook:deploy');
    expect(job.body.job.input).toContain('main');
  });

  it('an unmatched hook path 404s without spawning anything', async () => {
    const { socketPath } = await bootServer({
      flows: [triggeredFlow('deploy-flow', { kind: 'webhook', path: 'deploy' })],
    });
    const miss = await udsJson(socketPath, 'POST', '/v1/hooks/nope', {});
    expect(miss.status).toBe(404);
  });

  it('an event trigger starts its flow when type and matcher agree', async () => {
    const { socketPath } = await bootServer({
      flows: [
        triggeredFlow('on-merge', {
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

    const miss = await udsJson(socketPath, 'POST', '/v1/events', {
      type: 'pr-merged',
      payload: { branch: 'dev' },
    });
    expect(miss.body.started ?? []).toEqual([]);

    const hit = await udsJson(socketPath, 'POST', '/v1/events', {
      type: 'pr-merged',
      payload: { branch: 'main' },
    });
    expect(hit.body.started).toHaveLength(1);
    const jobId = hit.body.started[0];
    await waitFor(async () => {
      const r = await udsJson(socketPath, 'GET', `/v1/jobs/${jobId}`);
      return r.body.job?.status === 'completed';
    });
    const job = await udsJson(socketPath, 'GET', `/v1/jobs/${jobId}`);
    expect(job.body.job.triggeredBy).toBe('event:pr-merged');
  });

  it('a message trigger starts its flow with the message text as input', async () => {
    const { socketPath } = await bootServer({
      flows: [triggeredFlow('intake-chat', { kind: 'message', channel: 'helm-requests' })],
    });

    // Wrong channel → nothing starts.
    const miss = await udsJson(socketPath, 'POST', '/v1/messages', {
      channel: 'random',
      text: 'hello?',
    });
    expect(miss.status).toBe(200);
    expect(miss.body.started).toEqual([]);

    // Matching channel → flow starts; the TEXT is the job input (the
    // conversational prompt), not a JSON envelope.
    const hit = await udsJson(socketPath, 'POST', '/v1/messages', {
      channel: 'helm-requests',
      text: 'please build the widget',
      from: 'edwin',
    });
    expect(hit.body.started).toHaveLength(1);
    const jobId = hit.body.started[0];
    await waitFor(async () => {
      const r = await udsJson(socketPath, 'GET', `/v1/jobs/${jobId}`);
      return r.body.job?.status === 'completed';
    });
    const job = await udsJson(socketPath, 'GET', `/v1/jobs/${jobId}`);
    expect(job.body.job.input).toBe('please build the widget');
    expect(job.body.job.triggeredBy).toBe('message:helm-requests');
  });

  it('rejects malformed message ingests', async () => {
    const { socketPath } = await bootServer({
      flows: [triggeredFlow('intake-chat', { kind: 'message', channel: 'helm-requests' })],
    });
    const noChannel = await udsJson(socketPath, 'POST', '/v1/messages', { text: 'x' });
    expect(noChannel.status).toBe(400);
    const noText = await udsJson(socketPath, 'POST', '/v1/messages', { channel: 'helm-requests' });
    expect(noText.status).toBe(400);
  });

  it('schedule triggers are armed at boot and inspectable via GET /v1/triggers', async () => {
    const { socketPath } = await bootServer({
      flows: [
        triggeredFlow('nightly', { kind: 'schedule', cron: '0 3 * * *' }),
        triggeredFlow('deploy-flow', { kind: 'webhook', path: 'deploy' }),
      ],
    });
    const r = await udsJson(socketPath, 'GET', '/v1/triggers');
    expect(r.status).toBe(200);
    expect(r.body.schedules).toHaveLength(1);
    expect(r.body.schedules[0].flowId).toBe('nightly');
    expect(r.body.schedules[0].cron).toBe('0 3 * * *');
    expect(Date.parse(r.body.schedules[0].nextFireAt)).toBeGreaterThan(Date.now());
    expect(r.body.webhooks).toEqual([{ flowId: 'deploy-flow', path: 'deploy', method: 'POST' }]);
  });

  it('GET /v1/triggers lists message channels', async () => {
    const { socketPath } = await bootServer({
      flows: [triggeredFlow('intake-chat', { kind: 'message', channel: 'helm-requests' })],
    });
    const r = await udsJson(socketPath, 'GET', '/v1/triggers');
    expect(r.body.messages).toEqual([{ flowId: 'intake-chat', channel: 'helm-requests' }]);
  });
});
