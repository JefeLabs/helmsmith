import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it } from 'vitest';
import { currentOwner, Registry, validateManifest } from '../core/index.js';
import { makeRepo } from '../core/testing/index.js';
import type { Ctx } from '../lib/effort.js';
import { buildMcpServer } from './server.js';

const manifest = validateManifest({
  project: 'demo',
  baseBranch: 'develop',
  ports: { services: { backend: { base: 44100 } } },
  services: { backend: { start: 'true', stop: 'true', health: 'true' } },
  scopes: { frontend: ['app/{group}/{section}/**'], backend: ['svc/{module}/**'] },
  areas: { 'shop/cart': { module: 'cart' } },
});

async function connected(repoRoot: string) {
  const home = mkdtempSync(join(tmpdir(), 'wk-mcp-'));
  const registry = Registry.open(home);
  registry.upsertProject('demo', { root: repoRoot, ranges: {} });
  const ctx: Ctx = {
    home,
    repoRoot,
    manifest,
    registry,
    owner: currentOwner({ WORK_SESSION: 'mcp' }),
    runner: { start: async () => ({ pids: {} }), stop: async () => {} },
    storybrokr: { up: async () => ({ id: 'sb', port: 1, url: 'u' }), down: async () => {} },
    log: () => {},
  };
  const server = buildMcpServer(async () => ctx);
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: 'test', version: '0.0.0' });
  await client.connect(clientT);
  return client;
}

const text = (r: { content?: unknown }) => (r.content as { text: string }[])[0].text;

describe('MCP server', () => {
  let cleanup = () => {};
  afterEach(() => cleanup());

  it('exposes the six tools', async () => {
    const f = makeRepo();
    cleanup = f.cleanup;
    const client = await connected(f.main);
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual([
      'work_audit',
      'work_env',
      'work_finish',
      'work_reap',
      'work_start',
      'work_status',
    ]);
  });

  it('work_status reports the project with no open effort; work_env refuses with the error body', async () => {
    const f = makeRepo();
    cleanup = f.cleanup;
    const client = await connected(f.main);
    const status = JSON.parse(
      text(await client.callTool({ name: 'work_status', arguments: {} })),
    ) as {
      project: string;
      areas: { area: string; effort?: unknown }[];
    };
    expect(status.project).toBe('demo');
    expect(status.areas.map((a) => a.area)).toEqual(['shop/cart']);
    expect(status.areas[0].effort).toBeUndefined();
    const env = await client.callTool({ name: 'work_env', arguments: { area: 'shop/cart' } });
    expect(env.isError).toBe(true);
    expect(JSON.parse(text(env)).code).toBe('EFFORT_NOT_FOUND');
  });

  it('work_start then work_finish round-trip through the tools', async () => {
    const f = makeRepo();
    cleanup = f.cleanup;
    const client = await connected(f.main);
    const started = JSON.parse(
      text(
        await client.callTool({
          name: 'work_start',
          arguments: { area: 'shop/cart', type: 'feature', mode: 'fullstack' },
        }),
      ),
    ) as { effort: { branch: string }; leases: { kind: string }[] };
    expect(started.effort.branch).toBe('feature/shop/cart');
    expect(started.leases[0].kind).toBe('slot');
    const finished = JSON.parse(
      text(await client.callTool({ name: 'work_finish', arguments: { area: 'shop/cart' } })),
    ) as { pushed: boolean };
    expect(finished.pushed).toBe(true);
    const audit = JSON.parse(
      text(await client.callTool({ name: 'work_audit', arguments: {} })),
    ) as unknown[];
    expect(audit).toEqual([]);
  });
});
