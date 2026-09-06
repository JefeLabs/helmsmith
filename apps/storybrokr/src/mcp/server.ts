import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { DaemonClient } from '../client/index.js';
import { resolveComponent } from '../commands/_shared/output.js';
import { toErrorBody } from '../lib/errors.js';
import { VERSION } from '../version.js';

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

const ok = (value: unknown): ToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
});
const failed = (err: unknown): ToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(toErrorBody(err)) }],
  isError: true,
});

async function guard(fn: () => Promise<unknown>): Promise<ToolResult> {
  try {
    return ok(await fn());
  } catch (err) {
    return failed(err);
  }
}

export function buildMcpServer(connect: () => Promise<DaemonClient>): McpServer {
  const server = new McpServer({ name: 'storybrokr', version: VERSION });

  server.registerTool(
    'storybrokr_up',
    {
      description:
        "Boot (or reuse) an ephemeral Storybook containing only one component and its child components, derived from the host repo's existing .storybook. Returns the instance with a per-story iframeUrl you can screenshot.",
      inputSchema: {
        component: z
          .string()
          .describe(
            'Story-file path or folder, relative to the host repo root (e.g. components/core/atoms/button)',
          ),
        hostRoot: z
          .string()
          .optional()
          .describe('Host repo root; default walks up from component to the nearest .storybook/'),
        ttlMinutes: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe('Idle minutes before reaping; 0 = never'),
        wait: z.boolean().optional().describe('Wait for readiness (default true)'),
      },
    },
    async ({ component, hostRoot, ttlMinutes, wait }) =>
      guard(async () => {
        const target =
          hostRoot === undefined ? resolveComponent(component) : { component, hostRoot };
        return (await connect()).up({ ...target, ttlMinutes, wait: wait !== false });
      }),
  );

  server.registerTool(
    'storybrokr_list',
    { description: 'List brokered Storybook instances.', inputSchema: {} },
    async () => guard(async () => (await connect()).list()),
  );

  server.registerTool(
    'storybrokr_get',
    {
      description: 'Get one instance by id or component path, including its story URLs.',
      inputSchema: { id: z.string() },
    },
    async ({ id }) => guard(async () => (await connect()).get(id)),
  );

  server.registerTool(
    'storybrokr_down',
    { description: 'Stop an instance and remove its config dir.', inputSchema: { id: z.string() } },
    async ({ id }) =>
      guard(async () => {
        await (await connect()).down(id);
        return { stopped: id };
      }),
  );

  server.registerTool(
    'storybrokr_logs',
    {
      description: "Tail an instance's Storybook output.",
      inputSchema: { id: z.string(), tail: z.number().int().min(1).max(2000).optional() },
    },
    async ({ id, tail }) =>
      guard(async () => ({ lines: await (await connect()).logs(id, tail ?? 200) })),
  );

  server.registerTool(
    'storybrokr_touch',
    { description: "Reset an instance's idle timer.", inputSchema: { id: z.string() } },
    async ({ id }) => guard(async () => (await connect()).touch(id)),
  );

  server.registerTool(
    'storybrokr_inspect_host',
    {
      description:
        'Pre-flight a host repo: .storybook presence, storybook binary/version, framework, tsconfig aliases.',
      inputSchema: { path: z.string() },
    },
    async ({ path }) => guard(async () => (await connect()).inspectHost(path)),
  );

  return server;
}

export async function runStdio(): Promise<void> {
  const server = buildMcpServer(() => DaemonClient.connect());
  await server.connect(new StdioServerTransport());
}
