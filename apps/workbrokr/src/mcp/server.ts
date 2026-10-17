import { toErrorBody } from '@helmsmith/workkit';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { buildCtx } from '../lib/context.js';
import {
  auditProject,
  type Ctx,
  effortEnv,
  finishEffort,
  reapLeases,
  startEffort,
  statusFor,
} from '../lib/effort.js';
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

/** The same verbs as the CLI, with the same JSON the CLI's --json prints; refusals carry code + details. */
export function buildMcpServer(ctxFactory: () => Promise<Ctx>): McpServer {
  const server = new McpServer({ name: 'work', version: VERSION });

  server.registerTool(
    'work_start',
    {
      description:
        'Start an effort on an area: its worktree on <type>/<area>, synced from the base branch, refreshed, leased (a slot for fullstack, a storybrokr instance for frontend with a story) and running. Refuses with EFFORT_OPEN (another effort is open; join=true to share it), SCOPE_CONFLICT, SYNC_CONFLICT (resolve in the worktree, rerun with sync=false).',
      inputSchema: {
        area: z.string().describe('a leaf area from helmsmith.config (e.g. org/applications)'),
        type: z.string().describe('feature | chore | fix'),
        mode: z.enum(['frontend', 'fullstack']),
        story: z
          .string()
          .optional()
          .describe(
            'frontend: story file or component folder for storybrokr, relative to its host',
          ),
        join: z
          .boolean()
          .optional()
          .describe('work in the already-open effort instead of refusing'),
        sync: z
          .boolean()
          .optional()
          .describe('fetch and merge the base branch first (default true)'),
      },
    },
    async ({ area, type, mode, story, join, sync }) =>
      guard(async () => startEffort(await ctxFactory(), { area, type, mode, story, join, sync })),
  );

  server.registerTool(
    'work_status',
    {
      description:
        'Per area: the open effort, its leases, how far behind the base branch it is, pending notices; plus every lease of the project.',
      inputSchema: { area: z.string().optional() },
    },
    async ({ area }) => guard(async () => statusFor(await ctxFactory(), area)),
  );

  server.registerTool(
    'work_finish',
    {
      description:
        "Stop the effort's runner, release its leases, push its branch, leave commons notices. The worktree and branch stay. Refuses DIRTY_WORKTREE unless park=true (commits as wip).",
      inputSchema: { area: z.string(), park: z.boolean().optional() },
    },
    async ({ area, park }) => guard(async () => finishEffort(await ctxFactory(), { area, park })),
  );

  server.registerTool(
    'work_reap',
    {
      description:
        'Expire idle leases: stop only what they started, release them, park their efforts. dryRun lists without touching.',
      inputSchema: { dryRun: z.boolean().optional() },
    },
    async ({ dryRun }) => guard(async () => reapLeases(await ctxFactory(), { dryRun })),
  );

  server.registerTool(
    'work_audit',
    {
      description:
        'Findings: dirty or unpushed area worktrees, foreign worktrees, aging leases, drift from the base branch, stale notices, archive size.',
      inputSchema: {},
    },
    async () => guard(async () => auditProject(await ctxFactory())),
  );

  server.registerTool(
    'work_env',
    {
      description:
        "The slot-derived variables of an area's open effort (PORT_*, SLOT, LOG_DIR, WORKTREE, BRANCH, MODE).",
      inputSchema: { area: z.string() },
    },
    async ({ area }) => guard(async () => effortEnv(await ctxFactory(), area)),
  );

  return server;
}

export async function runStdio(): Promise<void> {
  const server = buildMcpServer(() => buildCtx({ quiet: true }));
  await server.connect(new StdioServerTransport());
}
