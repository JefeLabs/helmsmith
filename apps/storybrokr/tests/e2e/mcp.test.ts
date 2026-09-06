import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterAll, describe, expect, it } from 'vitest';
import { BIN, FIXTURE_HOST, makeHome, runCli } from './helpers.js';

describe('MCP stdio surface', () => {
  const { home, cleanup } = makeHome();
  afterAll(async () => {
    await runCli(['daemon', 'stop'], { home }).catch(() => {});
    cleanup();
  });

  it('storybrokr_up over MCP boots the fixture and returns story URLs', async () => {
    const client = new Client({ name: 'e2e', version: '0.0.0' });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [BIN, 'mcp'],
      env: { ...process.env, STORYBROKR_HOME: home } as Record<string, string>,
    });
    await client.connect(transport);
    const tools = (await client.listTools()).tools.map((t) => t.name);
    expect(tools).toContain('storybrokr_up');
    const t0 = Date.now();
    const result = await client.callTool({
      name: 'storybrokr_up',
      arguments: { component: 'src/components/Button', hostRoot: FIXTURE_HOST },
    });
    console.log(`mcp up ready in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    expect(result.isError).toBeFalsy();
    const body = JSON.parse((result.content as { text: string }[])[0].text) as {
      record: { status: string; stories: { iframeUrl: string }[] };
    };
    expect(body.record.status).toBe('ready');
    expect(body.record.stories[0].iframeUrl).toMatch(/iframe\.html/);
    await client.callTool({ name: 'storybrokr_down', arguments: { id: 'src/components/Button' } });
    await client.close();
  });
});
