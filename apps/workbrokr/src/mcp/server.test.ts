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

  it('exposes the nine tools including work_promote, work_pr and work_reset', async () => {
    const f = makeRepo();
    cleanup = f.cleanup;
    const client = await connected(f.main);
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual([
      'work_audit',
      'work_env',
      'work_finish',
      'work_pr',
      'work_promote',
      'work_reap',
      'work_reset',
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
    // nothing was committed on the branch: finish does not push an empty branch
    expect(finished.pushed).toBe(false);
    const audit = JSON.parse(
      text(await client.callTool({ name: 'work_audit', arguments: {} })),
    ) as unknown[];
    expect(audit).toEqual([]);
  });

  it('supports task sub-efforts, work_promote, and intoArea convergence via MCP', async () => {
    const f = makeRepo();
    cleanup = f.cleanup;
    const client = await connected(f.main);
    const started = JSON.parse(
      text(
        await client.callTool({
          name: 'work_start',
          arguments: { area: 'shop/cart', task: 'api', type: 'feature', mode: 'backend' },
        }),
      ),
    ) as { effort: { branch: string; mode: string } };
    expect(started.effort.branch).toBe('feature/shop/cart--api');
    expect(started.effort.mode).toBe('backend');

    const promoted = JSON.parse(
      text(
        await client.callTool({
          name: 'work_promote',
          arguments: { area: 'shop/cart', task: 'api', mode: 'fullstack' },
        }),
      ),
    ) as { effort: { mode: string } };
    expect(promoted.effort.mode).toBe('fullstack');

    const finished = JSON.parse(
      text(
        await client.callTool({
          name: 'work_finish',
          arguments: { area: 'shop/cart', task: 'api', intoArea: true },
        }),
      ),
    ) as { mergedIntoArea: boolean };
    expect(finished.mergedIntoArea).toBe(true);
  });
});

describe('work_pr input surface', () => {
  let cleanup = () => {};
  afterEach(() => cleanup());

  it("takes body text, never a file path to read on the caller's behalf", async () => {
    const f = makeRepo();
    cleanup = f.cleanup;
    const client = await connected(f.main);
    const tool = (await client.listTools()).tools.find((t) => t.name === 'work_pr');
    const props = Object.keys(
      (tool?.inputSchema as { properties?: Record<string, unknown> }).properties ?? {},
    );
    expect(props).toContain('body');
    expect(props).not.toContain('bodyFile');
  });
});
