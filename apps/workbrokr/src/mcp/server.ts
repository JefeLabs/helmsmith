import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { toErrorBody } from '../core/index.js';
import { buildCtx } from '../lib/context.js';
import {
  auditProject,
  type Ctx,
  effortEnv,
  finishEffort,
  promoteEffort,
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
export function buildMcpServer(ctxFactory: (projectRoot?: string) => Promise<Ctx>): McpServer {
  const server = new McpServer({ name: 'work', version: VERSION });

  server.registerTool(
    'work_start',
    {
      description:
        'Start an effort on an area (or intra-area task): its worktree on <type>/<area> (or <type>/<area>--<task>), synced from the base branch, refreshed, leased (a slot for fullstack/backend, a storybrokr instance for frontend with a story) and running. Refuses with EFFORT_OPEN (another effort is open; join=true to share it), SCOPE_CONFLICT, SYNC_CONFLICT (resolve in the worktree, rerun with sync=false).',
      inputSchema: {
        area: z.string().describe('a leaf area from helmsmith.config (e.g. org/applications)'),
        task: z
          .string()
          .optional()
          .describe('optional intra-area task slug for parallel sub-efforts (<type>/<area>--<task>)'),
        type: z.string().describe('feature | chore | fix'),
        mode: z.enum(['frontend', 'backend', 'fullstack']),
        scopes: z
          .array(z.string())
          .optional()
          .describe('optional narrowed scope globs for a task sub-effort'),
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
        projectRoot: z.string().optional().describe('optional repository root path override'),
      },
    },
    async ({ area, task, type, mode, scopes, story, join, sync, projectRoot }) =>
      guard(async () =>
        startEffort(await ctxFactory(projectRoot), {
          area,
          task,
          type,
          mode,
          scopes,
          story,
          join,
          sync,
        }),
      ),
  );

  server.registerTool(
    'work_promote',
    {
      description:
        'Promote an open effort in place to backend or fullstack mode, claiming a slot if needed and starting only newly required services.',
      inputSchema: {
        area: z.string().describe('the area of the open effort'),
        task: z.string().optional().describe('optional intra-area task slug'),
        mode: z.enum(['backend', 'fullstack']).describe('target mode to promote into'),
        story: z.string().optional().describe('optional story path'),
        projectRoot: z.string().optional().describe('optional repository root path override'),
      },
    },
    async ({ area, task, mode, story, projectRoot }) =>
      guard(async () => promoteEffort(await ctxFactory(projectRoot), { area, task, mode, story })),
  );

  server.registerTool(
    'work_status',
    {
      description:
        'Per area: the open effort, its leases, how far behind the base branch it is, pending notices; plus every lease of the project.',
      inputSchema: {
        area: z.string().optional(),
        task: z.string().optional(),
        projectRoot: z.string().optional().describe('optional repository root path override'),
      },
    },
    async ({ area, task, projectRoot }) =>
      guard(async () => statusFor(await ctxFactory(projectRoot), area, task)),
  );

  server.registerTool(
    'work_finish',
    {
      description:
        "Stop the effort's runner, release its leases, push its branch (or merge --into-area for task sub-efforts), leave commons notices. Refuses DIRTY_WORKTREE unless park=true (commits as wip).",
      inputSchema: {
        area: z.string(),
        task: z.string().optional().describe('optional intra-area task slug'),
        park: z.boolean().optional(),
        intoArea: z
          .boolean()
          .optional()
          .describe('merge task branch into <type>/<area> instead of pushing to origin'),
        force: z
          .boolean()
          .optional()
          .describe('stop and finish even if other joined participants remain'),
        projectRoot: z.string().optional().describe('optional repository root path override'),
      },
    },
    async ({ area, task, park, intoArea, force, projectRoot }) =>
      guard(async () =>
        finishEffort(await ctxFactory(projectRoot), { area, task, park, intoArea, force }),
      ),
  );

  server.registerTool(
    'work_reap',
    {
      description:
        'Expire idle leases: stop only what they started, release them, park their efforts. dryRun lists without touching.',
      inputSchema: {
        dryRun: z.boolean().optional(),
        projectRoot: z.string().optional().describe('optional repository root path override'),
      },
    },
    async ({ dryRun, projectRoot }) =>
      guard(async () => reapLeases(await ctxFactory(projectRoot), { dryRun })),
  );

  server.registerTool(
    'work_audit',
    {
      description:
        'Findings: dirty or unpushed area worktrees, foreign worktrees, aging leases, drift from the base branch, stale notices, archive size.',
      inputSchema: {
        projectRoot: z.string().optional().describe('optional repository root path override'),
      },
    },
    async ({ projectRoot }) => guard(async () => auditProject(await ctxFactory(projectRoot))),
  );

  server.registerTool(
    'work_env',
    {
      description:
        "The slot-derived variables of an area's open effort (PORT_*, SLOT, LOG_DIR, WORKTREE, BRANCH, MODE).",
      inputSchema: {
        area: z.string(),
        task: z.string().optional(),
        projectRoot: z.string().optional().describe('optional repository root path override'),
      },
    },
    async ({ area, task, projectRoot }) =>
      guard(async () => effortEnv(await ctxFactory(projectRoot), area, task)),
  );

  return server;
}

export async function runStdio(): Promise<void> {
  const server = buildMcpServer((projectRoot) => buildCtx({ projectRoot, quiet: true }));
  await server.connect(new StdioServerTransport());
}
