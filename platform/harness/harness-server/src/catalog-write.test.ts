/**
 * Catalog write surface (designer save-to-server): GET /v1/catalog
 * returns the full live catalog; PUT /v1/catalog validates the body
 * with the real validator (400 with the path-prefixed message on
 * rejection — the live catalog untouched), persists it to the same
 * .harness/config/flows.json that boot's loadCatalog reads
 * (restart-consistent), hot-swaps the live catalog, and re-arms
 * schedule triggers. Warnings (the two remaining report ids) come back
 * in the response.
 */

import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
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
import type { Catalog, FlowDef } from '@helmsmith/harness-core';
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
  constructor(private readonly reply: string) {}
  async invoke(_input: AgentInput): Promise<AgentInvocationResult> {
    return { content: this.reply, durationMs: 0 };
  }
  // biome-ignore lint/correctness/useYield: stub never emits chunks.
  async *stream(): AsyncIterable<AgentChunk> {
    throw new Error('unused');
  }
}

function agentFlow(id: string): FlowDef {
  return {
    id,
    nodes: [
      { id: '__trigger', kind: 'trigger', config: { kind: 'manual' } },
      {
        id: 'w',
        kind: 'agent',
        config: { agent: { id: 'w', role: 'W', adapter: 'claude-sdk', systemPrompt: 'go' } },
      },
    ],
    edges: [{ from: '__trigger', to: 'w', type: 'sequence' }],
  };
}

// biome-ignore lint/suspicious/noExplicitAny: test helper mirrors trigger-ingress.test.ts
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

describe('catalog write surface (designer save-to-server)', () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const c of cleanups.splice(0)) await c();
  });

  async function bootServer() {
    const workspaceRoot = await mkdtemp(join(tmpdir(), 'catw-ws-'));
    const socketPath = tmpSocket();
    const handle = await startHarnessServer({
      socketPath,
      workspaceRoot,
      catalog: { flows: [agentFlow('original')] },
      broker: dummyBroker,
      adapterFactory: () => new TestAdapter('done'),
    });
    cleanups.push(async () => {
      await handle.stop();
      await rm(socketPath, { force: true });
      await rm(workspaceRoot, { recursive: true, force: true });
    });
    return { socketPath, workspaceRoot };
  }

  it('GET /v1/catalog returns the full live catalog', async () => {
    const { socketPath } = await bootServer();
    const r = await udsJson(socketPath, 'GET', '/v1/catalog');
    expect(r.status).toBe(200);
    expect(r.body.catalog.flows.map((f: FlowDef) => f.id)).toEqual(['original']);
  });

  it('PUT rejects an invalid catalog with the validator message and leaves the live one untouched', async () => {
    const { socketPath } = await bootServer();
    const bad: Catalog = { flows: [{ ...agentFlow('broken'), nodes: [] } as FlowDef] };
    const r = await udsJson(socketPath, 'PUT', '/v1/catalog', bad);
    expect(r.status).toBe(400);
    expect(r.body.error).toContain('nodes must be a non-empty array');
    const after = await udsJson(socketPath, 'GET', '/v1/catalog');
    expect(after.body.catalog.flows.map((f: FlowDef) => f.id)).toEqual(['original']);
  });

  it('PUT hot-swaps the catalog, persists flows.json, re-arms schedules, and new flows are runnable', async () => {
    const { socketPath, workspaceRoot } = await bootServer();
    const nightly: FlowDef = {
      ...agentFlow('nightly'),
      nodes: [
        { id: '__trigger', kind: 'trigger', config: { kind: 'schedule', cron: '0 3 * * *' } },
        ...agentFlow('nightly').nodes.slice(1),
      ],
    };
    const next: Catalog = { flows: [agentFlow('fresh'), nightly] };

    const put = await udsJson(socketPath, 'PUT', '/v1/catalog', next);
    expect(put.status).toBe(200);
    expect(put.body.flowCount).toBe(2);

    // Live swap visible on the read surface.
    const got = await udsJson(socketPath, 'GET', '/v1/catalog');
    expect(got.body.catalog.flows.map((f: FlowDef) => f.id).sort()).toEqual(['fresh', 'nightly']);

    // Persisted where boot's loadCatalog reads.
    const onDisk = JSON.parse(
      await readFile(join(workspaceRoot, '.harness', 'config', 'flows.json'), 'utf8'),
    ) as Catalog;
    expect(onDisk.flows.map((f) => f.id).sort()).toEqual(['fresh', 'nightly']);

    // Schedule triggers re-armed against the NEW catalog.
    const triggers = await udsJson(socketPath, 'GET', '/v1/triggers');
    expect(triggers.body.schedules.map((s: { flowId: string }) => s.flowId)).toEqual(['nightly']);

    // The new flow is immediately runnable.
    await udsJson(socketPath, 'POST', '/v1/jobs', {
      jobId: 'jFresh',
      pipeline: 'fresh',
      input: 'go',
    });
    await waitFor(async () => {
      const r = await udsJson(socketPath, 'GET', '/v1/jobs/jFresh');
      return r.body.job?.status === 'completed';
    });
  });

  it('PUT surfaces validator warnings without rejecting', async () => {
    const { socketPath } = await bootServer();
    const withJs: FlowDef = {
      id: 'warned',
      nodes: [
        { id: '__trigger', kind: 'trigger', config: { kind: 'manual' } },
        {
          id: 'g',
          kind: 'gate',
          config: {
            assertions: [{ expression: { kind: 'js', expression: 'true' }, message: 'x' }],
          },
        },
      ],
      edges: [{ from: '__trigger', to: 'g', type: 'sequence' }],
    };
    const r = await udsJson(socketPath, 'PUT', '/v1/catalog', { flows: [withJs] });
    expect(r.status).toBe(200);
    expect(r.body.warnings).toHaveLength(1);
    expect(r.body.warnings[0].feature).toBe('expression-js');
  });
});
