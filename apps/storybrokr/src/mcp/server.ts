import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { DaemonClient } from '../client/index.js';
import { resolveComponent, resolveTarget } from '../commands/_shared/output.js';
import { StorybrokrError, toErrorBody } from '../lib/errors.js';
import { realpathOrResolve } from '../lib/host.js';
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

  const hostRootOpt = z
    .string()
    .optional()
    .describe('Host repo root (optional; defaults to STORYBROKR_HOST or cwd host)');

  server.registerTool(
    'storybrokr_up',
    {
      description:
        "Boot (or reuse) an ephemeral Storybook containing only one component (and optionally its child components), derived from the host repo's existing .storybook. Returns the instance with a per-story iframeUrl you can screenshot.",
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
          .min(0)
          .optional()
          .describe('Idle minutes before reaping; 0 = never'),
        includeChildren: z
          .boolean()
          .optional()
          .describe(
            'Also include stories of transitively imported child components (default false unless root has 0 stories)',
          ),
        wait: z.boolean().optional().describe('Wait for readiness (default true)'),
      },
    },
    async ({ component, hostRoot, ttlMinutes, includeChildren, wait }) =>
      guard(async () => {
        const target =
          hostRoot === undefined ? resolveComponent(component) : { component, hostRoot };
        return (await connect()).up({
          ...target,
          ttlMinutes,
          ...(includeChildren !== undefined ? { includeChildren } : {}),
          wait: wait !== false,
        });
      }),
  );

  server.registerTool(
    'storybrokr_list',
    {
      description: 'List brokered Storybook instances (optionally filtered by hostRoot).',
      inputSchema: { hostRoot: hostRootOpt },
    },
    async ({ hostRoot }) =>
      guard(async () =>
        (await connect()).list(hostRoot ? { host: realpathOrResolve(hostRoot) } : undefined),
      ),
  );

  server.registerTool(
    'storybrokr_get',
    {
      description: 'Get one instance by id or component path, including its story URLs.',
      inputSchema: { id: z.string(), hostRoot: hostRootOpt },
    },
    async ({ id, hostRoot }) =>
      guard(async () => {
        const target = resolveTarget(id, hostRoot);
        return (await connect()).get(target.idOrPath, {
          host: target.host,
          hint: target.hint,
        });
      }),
  );

  server.registerTool(
    'storybrokr_down',
    {
      description:
        'Stop an instance by id/path or stop all instances for a hostRoot, and remove their config dirs.',
      inputSchema: { id: z.string().optional(), hostRoot: hostRootOpt },
    },
    async ({ id, hostRoot }) =>
      guard(async () => {
        const client = await connect();
        if (!id && hostRoot) {
          const stopped = await client.downByHost(realpathOrResolve(hostRoot));
          return { stopped };
        }
        if (!id) {
          throw new StorybrokrError('BAD_REQUEST', 'provide id or hostRoot');
        }
        const target = resolveTarget(id, hostRoot);
        await client.down(target.idOrPath, { host: target.host, hint: target.hint });
        return { stopped: target.idOrPath };
      }),
  );

  server.registerTool(
    'storybrokr_logs',
    {
      description: "Tail an instance's Storybook output.",
      inputSchema: {
        id: z.string(),
        hostRoot: hostRootOpt,
        tail: z.number().int().min(1).max(2000).optional(),
      },
    },
    async ({ id, hostRoot, tail }) =>
      guard(async () => {
        const target = resolveTarget(id, hostRoot);
        return {
          lines: await (await connect()).logs(target.idOrPath, tail ?? 200, {
            host: target.host,
            hint: target.hint,
          }),
        };
      }),
  );

  server.registerTool(
    'storybrokr_touch',
    {
      description: "Reset an instance's idle timer.",
      inputSchema: { id: z.string(), hostRoot: hostRootOpt },
    },
    async ({ id, hostRoot }) =>
      guard(async () => {
        const target = resolveTarget(id, hostRoot);
        return (await connect()).touch(target.idOrPath, {
          host: target.host,
          hint: target.hint,
        });
      }),
  );

  const waitFor = z
    .union([z.object({ selector: z.string() }), z.object({ text: z.string() })])
    .optional()
    .describe(
      'After Storybook reports the story rendered, also wait for a selector or visible text (hosts with Suspense fallbacks such as "Loading translations…")',
    );
  const timeoutMs = z
    .number()
    .int()
    .min(1000)
    .max(300_000)
    .optional()
    .describe('Settle budget in ms per story (default 30000)');

  server.registerTool(
    'storybrokr_check',
    {
      description:
        'Run stories headlessly in Chromium and report pass/fail per story. Play functions are executed; a story passes when Storybook reports its render (and play) completed. Failing stories are rows in the result, not tool errors.',
      inputSchema: {
        id: z.string().describe('Instance id or component path'),
        hostRoot: hostRootOpt,
        storyIds: z
          .array(z.string())
          .min(1)
          .optional()
          .describe('Default: every story in the instance'),
        waitFor,
        timeoutMs,
        concurrency: z
          .number()
          .int()
          .min(1)
          .max(16)
          .optional()
          .describe('Max isolated browser contexts to run in parallel (default 4)'),
      },
    },
    async ({ id, hostRoot, storyIds, waitFor: wf, timeoutMs: t, concurrency }) =>
      guard(async () => {
        const target = resolveTarget(id, hostRoot);
        return (await connect()).check(
          target.idOrPath,
          {
            storyIds,
            waitFor: wf,
            timeoutMs: t,
            ...(concurrency !== undefined ? { concurrency } : {}),
          },
          { host: target.host, hint: target.hint },
        );
      }),
  );

  server.registerTool(
    'storybrokr_screenshot',
    {
      description:
        'Write a PNG of one story at a viewport you choose and return its absolute path. Use an absolute outPath to save anywhere (e.g. a scratchpad). Refuses to capture a story that errored or timed out.',
      inputSchema: {
        id: z.string().describe('Instance id or component path'),
        hostRoot: hostRootOpt,
        storyId: z.string(),
        outPath: z
          .string()
          .optional()
          .describe(
            'Absolute output path (relative paths are rejected); default <instance configDir>/screenshots/<story>-<WxH>.png',
          ),
        viewport: z
          .object({
            width: z.number().int().min(1).max(10_000),
            height: z.number().int().min(1).max(10_000),
          })
          .optional()
          .describe('Default 1280x720'),
        clip: z
          .enum(['root', 'viewport', 'page'])
          .optional()
          .describe('root = #storybook-root bounds (default); viewport; page = full page'),
        waitFor,
        timeoutMs,
      },
    },
    async ({ id, hostRoot, storyId, outPath, viewport, clip, waitFor: wf, timeoutMs: t }) =>
      guard(async () => {
        const target = resolveTarget(id, hostRoot);
        return (await connect()).screenshot(
          target.idOrPath,
          {
            storyId,
            outPath,
            viewport,
            clip,
            waitFor: wf,
            timeoutMs: t,
          },
          { host: target.host, hint: target.hint },
        );
      }),
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
