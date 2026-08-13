/**
 * JobIntent emission (roadmap 2.9) — the factory/fleet seam's second
 * half. A completed job-definition flow's enforced intent(s) are
 * submitted automatically: harness-server spawns child jobs through the
 * same dispatcher path as HTTP submissions, records spawnedJobIds on
 * the parent and parentJobId on each child, and records spawnErrors
 * (unknown flowId, …) without failing the parent.
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
import type { FlowCatalog, FlowDef } from '@helmsmith/harness-core';
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

function agentFlow(id: string, agentId: string, over: Partial<FlowDef> = {}): FlowDef {
  return {
    id,
    nodes: [
      { id: '__trigger', kind: 'trigger', config: { kind: 'manual' } },
      {
        id: agentId,
        kind: 'agent',
        config: {
          agent: { id: agentId, role: 'R', adapter: 'claude-sdk', systemPrompt: 'go' },
        },
      },
    ],
    edges: [{ from: '__trigger', to: agentId, type: 'sequence' }],
    ...over,
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

describe('JobIntent emission (2.9)', () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const c of cleanups.splice(0)) await c();
  });

  async function bootServer(catalog: FlowCatalog, replies: string[]) {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'emit-ws-'));
    const socketPath = tmpSocket();
    const adapters: TestAdapter[] = [];
    const handle = await startHarnessServer({
      socketPath,
      workspaceRoot,
      catalog,
      broker: dummyBroker,
      adapterFactory: () => {
        const a = new TestAdapter(replies[adapters.length] ?? 'done');
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

  it('a completed job-definition flow spawns its work job through the dispatcher', async () => {
    const intent = { flowId: 'build-it', productId: 'p1', input: 'do X' };
    const { socketPath } = await bootServer(
      {
        flows: [
          agentFlow('intake', 'planner', {
            kind: 'job-definition',
            output: { kind: 'job-intent' },
          }),
          agentFlow('build-it', 'builder'),
        ],
      },
      [JSON.stringify(intent), 'built'],
    );

    await udsJson(socketPath, 'POST', '/v1/jobs', {
      jobId: 'jParent',
      pipeline: 'intake',
      input: 'plan the work',
    });
    await waitFor(async () => {
      const r = await udsJson(socketPath, 'GET', '/v1/jobs/jParent');
      return r.body.job?.status === 'completed';
    });

    // The parent records its spawned child; the child carries lineage
    // and the intent's input, and runs to completion on its own.
    const parent = await udsJson(socketPath, 'GET', '/v1/jobs/jParent');
    expect(parent.body.job.flowOutput).toEqual(intent);
    expect(parent.body.job.spawnedJobIds).toHaveLength(1);
    const childId = parent.body.job.spawnedJobIds[0];

    await waitFor(async () => {
      const r = await udsJson(socketPath, 'GET', `/v1/jobs/${childId}`);
      return r.body.job?.status === 'completed';
    });
    const child = await udsJson(socketPath, 'GET', `/v1/jobs/${childId}`);
    expect(child.body.job.parentJobId).toBe('jParent');
    expect(child.body.job.pipeline).toBe('build-it');
    expect(child.body.job.input).toBe('do X');
  });

  it('job-intents fan-out spawns one child per intent', async () => {
    const { socketPath } = await bootServer(
      {
        flows: [
          agentFlow('intake', 'planner', {
            kind: 'job-definition',
            output: { kind: 'job-intents', min: 2 },
          }),
          agentFlow('build-it', 'builder'),
        ],
      },
      [
        JSON.stringify([
          { flowId: 'build-it', productId: 'p1', input: 'part a' },
          { flowId: 'build-it', productId: 'p1', input: 'part b' },
        ]),
        'built-a',
        'built-b',
      ],
    );

    await udsJson(socketPath, 'POST', '/v1/jobs', {
      jobId: 'jFan',
      pipeline: 'intake',
      input: 'split the work',
    });
    await waitFor(async () => {
      const r = await udsJson(socketPath, 'GET', '/v1/jobs/jFan');
      return r.body.job?.spawnedJobIds?.length === 2;
    });
    const parent = await udsJson(socketPath, 'GET', '/v1/jobs/jFan');
    for (const childId of parent.body.job.spawnedJobIds) {
      await waitFor(async () => {
        const r = await udsJson(socketPath, 'GET', `/v1/jobs/${childId}`);
        return r.body.job?.status === 'completed';
      });
    }
    const inputs = await Promise.all(
      parent.body.job.spawnedJobIds.map(async (id: string) => {
        const r = await udsJson(socketPath, 'GET', `/v1/jobs/${id}`);
        return r.body.job.input;
      }),
    );
    expect(inputs.sort()).toEqual(['part a', 'part b']);
  });

  it('an intent naming an unknown flow records a spawn error without failing the parent', async () => {
    const { socketPath } = await bootServer(
      {
        flows: [
          agentFlow('intake', 'planner', {
            kind: 'job-definition',
            output: { kind: 'job-intent' },
          }),
        ],
      },
      [JSON.stringify({ flowId: 'ghost', productId: 'p1', input: 'x' })],
    );

    await udsJson(socketPath, 'POST', '/v1/jobs', {
      jobId: 'jGhost',
      pipeline: 'intake',
      input: 'plan',
    });
    await waitFor(async () => {
      const r = await udsJson(socketPath, 'GET', '/v1/jobs/jGhost');
      return r.body.job?.status === 'completed';
    });
    await waitFor(async () => {
      const r = await udsJson(socketPath, 'GET', '/v1/jobs/jGhost');
      return (r.body.job?.spawnErrors?.length ?? 0) > 0;
    });
    const parent = await udsJson(socketPath, 'GET', '/v1/jobs/jGhost');
    expect(parent.body.job.status).toBe('completed');
    expect(parent.body.job.spawnedJobIds).toEqual([]);
    expect(parent.body.job.spawnErrors[0]).toContain('ghost');
  });
});
