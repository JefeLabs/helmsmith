import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DaemonClient } from '../client/index.js';
import { StorybrokrError } from '../lib/errors.js';
import type { InstanceRecord } from '../types.js';
import { buildMcpServer } from './server.js';

const rec = {
  id: 'abc',
  status: 'ready',
  url: 'http://127.0.0.1:6100',
  stories: [],
  storyFiles: [],
  component: 'src/Button',
  hostRoot: '/h',
} as unknown as InstanceRecord;

async function connected(fake: Partial<DaemonClient>) {
  const server = buildMcpServer(async () => fake as DaemonClient);
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: 'test', version: '0.0.0' });
  await client.connect(clientT);
  return client;
}

describe('MCP server', () => {
  it('exposes the seven tools', async () => {
    const client = await connected({});
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual([
      'storybrokr_down',
      'storybrokr_get',
      'storybrokr_inspect_host',
      'storybrokr_list',
      'storybrokr_logs',
      'storybrokr_touch',
      'storybrokr_up',
    ]);
  });

  it('storybrokr_up forwards arguments and returns the record as JSON text', async () => {
    const up = vi.fn(async () => ({ record: rec, created: true }));
    const client = await connected({ up } as Partial<DaemonClient>);
    const result = await client.callTool({
      name: 'storybrokr_up',
      arguments: { component: 'src/Button', hostRoot: '/h', ttlMinutes: 5 },
    });
    expect(up).toHaveBeenCalledWith({
      component: 'src/Button',
      hostRoot: '/h',
      ttlMinutes: 5,
      wait: true,
    });
    const text = (result.content as { type: string; text: string }[])[0].text;
    expect(JSON.parse(text)).toMatchObject({ created: true, record: { id: 'abc' } });
    expect(result.isError).toBeFalsy();
  });

  it('errors come back as isError with the error body', async () => {
    const get = vi.fn(async () => {
      throw new StorybrokrError('INSTANCE_NOT_FOUND', 'no instance zz');
    });
    const client = await connected({ get } as Partial<DaemonClient>);
    const result = await client.callTool({ name: 'storybrokr_get', arguments: { id: 'zz' } });
    expect(result.isError).toBe(true);
    expect(JSON.parse((result.content as { text: string }[])[0].text)).toEqual({
      code: 'INSTANCE_NOT_FOUND',
      message: 'no instance zz',
    });
  });

  describe('storybrokr_up without hostRoot', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('resolves hostRoot on the MCP process side and errors HOST_NOT_FOUND when none is found', async () => {
      const cwdDir = mkdtempSync(join(tmpdir(), 'storybrokr-mcp-test-'));
      vi.spyOn(process, 'cwd').mockReturnValue(cwdDir);
      const up = vi.fn(async () => ({ record: rec, created: true }));
      const client = await connected({ up } as Partial<DaemonClient>);
      const result = await client.callTool({
        name: 'storybrokr_up',
        arguments: { component: 'nowhere/at/all' },
      });
      expect(result.isError).toBe(true);
      expect(JSON.parse((result.content as { text: string }[])[0].text)).toMatchObject({
        code: 'HOST_NOT_FOUND',
      });
      expect(up).not.toHaveBeenCalled();
    });
  });
});
