import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { dirname, join } from 'node:path';
import {
  type BindingResolver,
  type CredentialBroker,
  defaultGitHubResolver,
  type GitHubCredentialResolver,
} from '@helmsmith/agent-auth';
import {
  type AdapterFactory,
  type AdapterId,
  type AgentDef,
  type ApprovalClaim,
  type ApprovalRequest,
  type Catalog,
  type CompiledFlowGraph,
  cancelJob,
  type Envelope,
  evalExpression,
  type FlowCatalog,
  type FlowDef,
  findFlow,
  findProduct,
  getJobSteering,
  JobBus,
  type JobIntent,
  type JobRecord,
  mimeFromPath,
  type RegisteredAgent,
  resolveAccepts,
  resumeJob,
  runJob,
  type SuspendRequest,
  steerJob,
  TokenAccumulator,
  type TriggerConfig,
  type UnsupportedFeature,
  validateUnifiedCatalog,
  walkAgents,
} from '@helmsmith/harness-core';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import type { BaseCheckpointSaver } from '@langchain/langgraph';
import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite';
import { runEntryCoordinator } from './coordinator/entry-coordinator.ts';
import { nextCronFire } from './cron.ts';
import {
  enqueue as dispatcherEnqueue,
  fireImmediate as dispatcherFireImmediate,
  onJobTerminal as dispatcherOnJobTerminal,
  statusSnapshot as dispatcherStatusSnapshot,
  evaluateSubmission,
} from './dispatcher.ts';
import {
  fileAtHead,
  fileDiff,
  listAllFiles,
  safeResolveInRepo,
  streamFileContent,
} from './file-routes.ts';
import {
  inlineCatalogLoader,
  readWorkspaceYamlWorktreePolicy,
  type WorktreePolicy,
} from './load-catalog.ts';
import { type LoaderEvent, spawnLoaderJob } from './loader-spawn.ts';
import {
  deletePausedJob,
  loadPausedJobs,
  savePausedJob,
  updatePausedJobClaim,
} from './paused-jobs.ts';
import { runJobInContainer } from './run-job-in-container.ts';
import type { SpawnRepoSpec } from './spawn-worker.ts';

// Re-export the harness-core surface so existing consumers (harness-cli,
// examples) that import from '@helmsmith/harness-server' keep working unchanged.
// New consumers should prefer importing from '@helmsmith/harness-core' directly.
export {
  type AdapterFactory,
  type AdapterId,
  type AgentDef,
  type ApprovalRequest,
  type ApprovalResume,
  bridgeAdapter,
  type Catalog,
  CatalogError,
  type CompiledFlowGraph,
  type ContextSourceDef,
  cancelJob,
  composeSystemPromptWithSteering,
  defaultAdapterFactory,
  type Envelope,
  type FlowCatalog,
  type FlowDef,
  findFlow,
  findProduct,
  getJobSteering,
  JobBus,
  loadCatalog,
  type ProductDef,
  resolveAccepts,
  resumeJob,
  runJob,
  type SuspendRequest,
  steerJob,
  validateUnifiedCatalog,
} from '@helmsmith/harness-core';
export {
  inlineCatalogLoader,
  loadCatalogFromWorkspaceYaml,
} from './load-catalog.ts';
export {
  type LoaderEvent,
  type LoaderJobHandle,
  type LoaderSpawnSpec,
  spawnLoaderJob,
} from './loader-spawn.ts';
export {
  type ConsumeStreamResult,
  consumeJsonlStream,
  type JobCompleteSentinel,
} from './pipeline-jsonl-stream.ts';

export {
  buildJobSpec,
  type RunJobInContainerOptions,
  type RunJobInContainerResult,
  removeContainer,
  runJobInContainer,
} from './run-job-in-container.ts';
export {
  type RunPipelineInContainerOptions,
  type RunPipelineInContainerResult,
  runPipelineInContainer,
} from './run-pipeline-in-container.ts';
export {
  type RunPipelineSubprocessOptions,
  type RunPipelineSubprocessResult,
  runPipelineSubprocess,
  type SubprocessLifecycleEvent,
} from './run-pipeline-subprocess.ts';
export {
  parseDevcontainerUpStdout,
  type RunWorkerOptions,
  type RunWorkerResult,
  resolveSshAgentMount,
  runWorker,
  type SpawnedWorktree,
  type SpawnRepoSpec,
  type SpawnResult,
  spawnWorker,
  type WorkerSpawnSpec,
} from './spawn-worker.ts';
export {
  parseHeadSha,
  type RepoAccessCheck,
  suggestFix,
  type ValidateRepoAccessOptions,
  type ValidateRepoAccessResult,
  validateRepoAccess,
} from './validate-repo-access.ts';

export interface HarnessServerOptions {
  socketPath: string;
  /** Checkpointer override (2.2). Default: a SqliteSaver on
   *  `<workspaceRoot>/.harness/state/checkpoints.sqlite`. Tests can
   *  inject a MemorySaver to avoid disk. */
  checkpointer?: BaseCheckpointSaver;
  /**
   * Optional TCP listener. When set, harness-server binds a second
   * `node:http` server on this port (same request handler as the UDS)
   * — needed so a remote controlplane (separate JVM / container) can
   * reach it for job dispatch (W1) and so the launcher can register
   * `endpoints.tcp`. `0` ⇒ ephemeral port (the actual port is on the
   * returned handle's `tcpPort`). Unset ⇒ UDS-only (the default).
   */
  port?: number;
  /** Bind address for the TCP listener. Default `127.0.0.1`. Set to
   *  `0.0.0.0` when the controlplane lives in another container. */
  host?: string;
  /** Inject a bus to share with the orchestrator. Defaults to a fresh one. */
  bus?: JobBus;
  /**
   * @deprecated Use `loadCatalog` instead.
   *
   * Inline catalog for back-compat with existing tests + simple inline-
   * config callers. When set, treated as a one-shot loader. New code
   * should always use `loadCatalog` so the source can be a YAML file,
   * S3 object, or central Catalog HTTP fetch — operator's choice.
   */
  catalog?: FlowCatalog;
  /**
   * Catalog loader. Called once at server startup; the resolved Catalog
   * (pipelines + products) is read-only for the lifetime of the server.
   * Failure to load fails server startup — no partial catalog operation.
   * Restart-to-refresh; v1.x will add a SIGHUP-style reload signal.
   */
  loadCatalog?: () => Promise<Catalog>;
  /**
   * Credential broker. When provided, registered jobs are orchestrated
   * automatically — runJob fires after registration and walks the agent list.
   * When absent, jobs are registered but never executed (TUI sees pending agents).
   * Tests pass a broker + adapterFactory together to mock invocation.
   */
  broker?: CredentialBroker;
  /** Override adapter construction (testing / custom adapter pools). */
  adapterFactory?: AdapterFactory;
  /**
   * Optional binding resolver. When provided AND an agent declares a
   * non-empty `accepts` list, the orchestrator routes through
   * resolver → bindingToAdapter instead of the legacy adapter-id factory.
   * Per memory `project_per_worker_model_subscription`. When absent,
   * agents fall back to the legacy `adapter` field even if `accepts` is
   * declared — backwards compat for catalogs ahead of the resolver.
   */
  resolver?: BindingResolver;
  /**
   * Optional LangChain BaseChatModel used by the entry coordinator graph
   * to auto-route intent-only submissions (those without `pipeline`) to
   * an appropriate pipeline from the catalog. Per memory
   * `project_langgraph_two_scopes` — coordinator workflows are admin-
   * owned and run inside harness-server with their own LLM.
   *
   * Typical wiring: `createHarnessChatModel(...)` against a Copilot or
   * direct Anthropic binding. When unset, intent-only submissions
   * register the placeholder coordinator agent and produce no pipeline
   * dispatch (current pre-10c behavior).
   */
  coordinatorModel?: BaseChatModel;
  /**
   * Workspace root on disk — used by the container path (slice 9d) to
   * compute worktree + spec.json mount paths. Defaults to
   * `process.cwd()`. Required for `AGENTX_USE_CONTAINER=1` since
   * spawnWorker needs a real workspace dir.
   */
  workspaceRoot?: string;
  /**
   * Default SSH agent forwarding for the container path (slice 9d-6).
   * When set, every container the server spawns gets the SSH agent
   * socket mounted in + SSH_AUTH_SOCK in its env. Per-job submissions
   * can override via body.forwardSshAgent.
   *
   *   - `true`  → auto-detect from process.env.SSH_AUTH_SOCK
   *   - string  → explicit host path
   *   - unset/false → no forwarding (default — pre-9d-6 behavior)
   *
   * Without forwarding, workers can READ the mounted worktrees but
   * can't push branches or open PRs (no GitHub auth).
   */
  forwardSshAgent?: boolean | string;
  /** In-container SSH agent socket path. Default `/ssh-agent.sock`. */
  sshAgentContainerPath?: string;
  /**
   * Path to edge-memory-server's UDS socket. When set, terminal job
   * states (completed / failed / cancelled) trigger a best-effort
   * POST to {@code /v1/memory/cleanup-unconfirmed} scoped to the
   * jobId — closes the F19 lifecycle loop so unconfirmed entries
   * don't accumulate indefinitely.
   *
   * <p>Best-effort means cleanup failures are logged and discarded;
   * a failed cleanup never blocks a job from terminating. Operators
   * can run {@code edge-memory cleanup --scope jobId:X} manually as
   * the fallback.
   *
   * <p>Unset (default) → cleanup hook is a no-op. Existing
   * deployments keep working unchanged; opt-in via this path.
   */
  memorySocketPath?: string;
  /**
   * Maximum number of jobs that may run concurrently on the in-process
   * runJob path. Submissions beyond capacity wait in a FIFO queue;
   * submissions when queue + in-flight ≥ capacity * QUEUE_MULTIPLIER
   * are rejected with 503. The container path is unaffected (each
   * container is its own concurrency boundary).
   *
   * Default: 5 — a sensible per-task cap that leaves headroom for LLM
   * rate limits without starving short-lived jobs. Production
   * deployments tune via this option.
   */
  maxConcurrentJobs?: number;
}

export interface HarnessServerHandle {
  bus: JobBus;
  catalog: Catalog;
  /** The TCP port the server bound, when `opts.port` was set (resolves
   *  the ephemeral port when `opts.port` was `0`). Undefined for
   *  UDS-only servers. */
  tcpPort?: number;
  stop(): Promise<void>;
}

export type { AgentStatus, JobRecord, RegisteredAgent } from '@helmsmith/harness-core';
export {
  buildCheckoutCoordinatorGraph,
  type RunCheckoutCoordinatorArgs,
  type RunCheckoutCoordinatorResult,
  runCheckoutCoordinator,
} from './coordinator/checkout-coordinator.ts';
// Coordinator workflows (admin-owned, run inside harness-server). Per
// memory project_langgraph_two_scopes — these graphs replace the
// hardcoded placeholder COORDINATOR_AGENT records when slice 10c wires
// them into handleSubmitJob.
export {
  buildEntryCoordinatorGraph,
  type CoordinatorPipelineSummary,
  type RunEntryCoordinatorArgs,
  type RunEntryCoordinatorResult,
  runEntryCoordinator,
} from './coordinator/entry-coordinator.ts';

/**
 * Synthetic agents harness-server inserts around every pipelined job's
 * user-defined agents. Both are placeholders today — their adapter
 * bindings will move into config when they become real LLM-driven
 * agents. The shape (an entry in the registered-agent list) is what
 * matters for now: the orchestrator walks them like any other agent,
 * the TUI surfaces them, and pipelines can specialize via overrides
 * down the road.
 *
 * COORDINATOR_AGENT (prepended)
 * -----------------------------
 * Job entry. In v1 the coordinator's "decision" of which pipeline to
 * run is made client-side (the CLI passes the pipeline id). When this
 * becomes a real agent — per project_authority_model_jobs_pipelines:
 * "coordinator chooses, not designs" — it'll inspect the intent and
 * route to a registered pipeline.
 *
 * CHECKOUT_COORDINATOR_AGENT (appended)
 * -------------------------------------
 * Job exit. Symmetric to the entry coordinator. When the pipeline's
 * user-defined agents finish, this synthetic agent owns the post-job
 * lifecycle — per project_memory_promotes_to_context +
 * project_central_grounding_bidirectional:
 *   1. harvest edge-memory for this jobId
 *   2. distill into "what went well / didn't go well / lessons"
 *   3. load the distilled output into edge-context-server (`learned`
 *      source type, via the existing loader infrastructure)
 *   4. promote the new Learning nodes to central-context
 *   5. only after promotion succeeds, mark the job completed
 * v1: placeholder — same status as the entry coordinator. The hook
 * point is in the agent list so step (1)-(5) can layer on without
 * touching the orchestrator. Pipelines that want specialized
 * checkout can override via a `checkout` phase before this synthetic
 * agent runs.
 */
const COORDINATOR_AGENT: AgentDef = {
  id: 'coordinator',
  role: 'Coordinator',
  adapter: 'claude-sdk',
};

const CHECKOUT_COORDINATOR_AGENT: AgentDef = {
  id: 'checkout-coordinator',
  role: 'CheckoutCoordinator',
  adapter: 'claude-sdk',
};

export async function startHarnessServer(opts: HarnessServerOptions): Promise<HarnessServerHandle> {
  const bus = opts.bus ?? new JobBus();
  // Resolve the catalog at startup. Operators pick the source via
  // loadCatalog; the deprecated inline `catalog` field keeps working
  // by wrapping it in a one-shot loader. Either way the catalog is
  // read-only for the lifetime of this server instance.
  const loader =
    opts.loadCatalog ??
    (opts.catalog
      ? inlineCatalogLoader({ flows: opts.catalog.flows })
      : inlineCatalogLoader({ flows: [] }));
  let catalog: Catalog;
  try {
    catalog = await loader();
  } catch (err) {
    // Fail fast — never serve traffic with a partial catalog.
    throw new Error(`harness-server: catalog load failed at startup — ${(err as Error).message}`);
  }
  const jobs = new Map<string, JobRecord>();
  // TokenAccumulator subscribes to the JobBus per-job and mutates the
  // JobRecord with per-call usage history + running totals (slice 13d).
  // One instance per server, attached lazily as jobs are created.
  const tokens = new TokenAccumulator(jobs);
  const workspaceRoot = opts.workspaceRoot ?? process.cwd();
  // Gate 1d — read worktree lifetime policy at startup. Defaults to
  // keepOnSuccess: true (PRD wording: "clean exit retains worktree
  // volume; cleanup only on explicit reaper pass").
  const worktreePolicy = await readWorkspaceYamlWorktreePolicy(workspaceRoot);
  // 2.2 — durable graph state. One SQLite file per workspace holds every
  // job's checkpointed thread; paused (awaiting-approval / suspended)
  // jobs survive server restarts. Tests can inject their own saver.
  const stateDir = join(workspaceRoot, '.harness', 'state');
  await mkdir(stateDir, { recursive: true });
  const checkpointer =
    opts.checkpointer ?? SqliteSaver.fromConnString(join(stateDir, 'checkpoints.sqlite'));
  const ctx: ServerCtx = {
    bus,
    catalog,
    jobs,
    tokens,
    graphs: new Map(),
    checkpointer,
    stateDir,
    pendingApprovals: new Map(),
    approvalClaims: new Map(),
    pendingSuspends: new Map(),
    approvalTimers: new Map(),
    suspendTimers: new Map(),
    cronTimers: new Map(),
    inFlight: new Set(),
    queue: [],
    capacity: opts.maxConcurrentJobs ?? 5,
    workspaceRoot,
    worktreePolicy,
    githubResolver: defaultGitHubResolver({
      ...(process.env.CONTROLPLANE_URL ? { controlplaneUrl: process.env.CONTROLPLANE_URL } : {}),
    }),
    ...(opts.forwardSshAgent !== undefined ? { forwardSshAgent: opts.forwardSshAgent } : {}),
    ...(opts.sshAgentContainerPath ? { sshAgentContainerPath: opts.sshAgentContainerPath } : {}),
    ...(opts.memorySocketPath ? { memorySocketPath: opts.memorySocketPath } : {}),
    broker: opts.broker,
    adapterFactory: opts.adapterFactory,
    resolver: opts.resolver,
    coordinatorModel: opts.coordinatorModel,
  };

  // 2.2 — rehydrate paused jobs persisted by a previous process. The
  // JobRecord (including its FlowDef) and the pending request surfaces
  // come back here; the compiled graph itself recompiles lazily on the
  // first resume (recompile-on-resume against the durable checkpointer).
  for (const rec of await loadPausedJobs(stateDir)) {
    if (ctx.jobs.has(rec.job.jobId)) continue;
    ctx.jobs.set(rec.job.jobId, rec.job);
    if (rec.kind === 'approval') {
      ctx.pendingApprovals.set(rec.job.jobId, rec.request as ApprovalRequest);
      if (rec.claim) ctx.approvalClaims.set(rec.job.jobId, rec.claim);
      // 2.1 — the SLA clock resumes from the ORIGINAL pause time; an
      // SLA that expired while the server was down fires immediately.
      armSlaTimer(ctx, rec.job.jobId, rec.request as ApprovalRequest, rec.pausedAt);
    } else {
      ctx.pendingSuspends.set(rec.job.jobId, rec.request as SuspendRequest);
      // 2.6 — the wake clock resumes from the ORIGINAL pause time; a
      // timer that expired while the server was down fires immediately.
      armSuspendTimer(ctx, rec.job.jobId, rec.request as SuspendRequest, rec.pausedAt);
    }
  }

  // 3.1 — arm cron timers for schedule-triggered catalog flows.
  armScheduleTriggers(ctx);

  await mkdir(dirname(opts.socketPath), { recursive: true, mode: 0o700 });
  await unlink(opts.socketPath).catch(() => {});

  const handler = (req: IncomingMessage, res: ServerResponse) => route(req, res, ctx);

  const udsServer = createServer(handler);
  await new Promise<void>((resolve, reject) => {
    udsServer.once('error', reject);
    udsServer.listen(opts.socketPath, () => resolve());
  });
  await chmod(opts.socketPath, 0o600);

  // Optional TCP listener (W1) — a second http.Server with the same
  // handler. http.Server can only listen on one address, hence two
  // server instances.
  let tcpServer: ReturnType<typeof createServer> | undefined;
  let tcpPort: number | undefined;
  if (opts.port !== undefined) {
    tcpServer = createServer(handler);
    const s = tcpServer;
    await new Promise<void>((resolve, reject) => {
      s.once('error', reject);
      s.listen(opts.port, opts.host ?? '127.0.0.1', () => resolve());
    });
    const addr = s.address();
    tcpPort = addr && typeof addr === 'object' ? addr.port : opts.port;
  }

  return {
    bus,
    catalog,
    ...(tcpPort !== undefined ? { tcpPort } : {}),
    async stop() {
      // Disarm timers so a stopped server can't fire auto-rejects/wakes.
      for (const jobId of [...ctx.approvalTimers.keys()]) clearSlaTimer(ctx, jobId);
      for (const jobId of [...ctx.suspendTimers.keys()]) clearSuspendTimer(ctx, jobId);
      for (const t of ctx.cronTimers.values()) clearTimeout(t);
      ctx.cronTimers.clear();
      await new Promise<void>((resolve) => udsServer.close(() => resolve()));
      if (tcpServer) await new Promise<void>((resolve) => tcpServer.close(() => resolve()));
      await unlink(opts.socketPath).catch(() => {});
    },
  };
}

interface QueuedSubmission {
  jobId: string;
  enqueuedAt: number;
  /** Closure that fires the actual runJob invocation when a slot opens.
   *  Captured at enqueue time so the dispatcher doesn't need to re-resolve
   *  broker / factory / resolver later. */
  fire: () => void;
}

interface ServerCtx {
  bus: JobBus;
  catalog: Catalog;
  jobs: Map<string, JobRecord>;
  /** Per-server token accumulator (slice 13d). Attached at job-create
   *  before the orchestrator fires; mutates JobRecord with per-call
   *  history + running totals. Detached when the job ends. */
  tokens: TokenAccumulator;
  /**
   * Per-job compiled-graph cache for resume. runJob populates this when a
   * flow may pause (Approval / Suspend tags); resumeJob fetches from it
   * when the HITL endpoint receives a decision. runJob clears the entry
   * on terminal status — entries here means "this job is paused, holding
   * a checkpointer reference." MemorySaver-based today; if the
   * checkpointer becomes durable (Postgres / SQLite) we can drop this
   * Map entirely and recompile on demand from the FlowDef.
   */
  graphs: Map<string, CompiledFlowGraph>;
  /** Durable checkpointer shared by every graph compile — a SQLite file
   *  at `<workspaceRoot>/.harness/state/checkpoints.sqlite` by default
   *  (2.2). Paused thread state survives restarts; resumeJob recompiles
   *  the graph from `job.flow` against it (recompile-on-resume). */
  checkpointer: BaseCheckpointSaver;
  /** State directory (`<workspaceRoot>/.harness/state`) — home of the
   *  checkpointer DB and the paused-job JSON records. */
  stateDir: string;
  /** Dispatcher: in-flight jobIds (those currently running runJob).
   *  Distinct from jobs (which holds ALL JobRecords including queued,
   *  paused, completed). */
  inFlight: Set<string>;
  /** FIFO queue of submissions waiting for an in-flight slot. */
  queue: QueuedSubmission[];
  /** Concurrency cap on the in-process runJob path. */
  capacity: number;
  /**
   * Latest ApprovalRequest per paused job. Populated by the
   * onAwaitingApproval hook; consumed by GET /v1/jobs/:id/approval so
   * reviewers can fetch the request payload (assignee role, content
   * under review, attempt counter) without subscribing to the SSE
   * stream. Cleared when the job leaves 'awaiting-approval'.
   */
  pendingApprovals: Map<string, ApprovalRequest>;
  /** Advisory-exclusive claims on pending approvals (pessimistic
   *  locking): once held, only the claimant may resume. Mirrors the
   *  paused-job file's `claim` field; cleared with the pending entry. */
  approvalClaims: Map<string, ApprovalClaim>;
  /**
   * Latest SuspendRequest per paused job. Same shape rationale as
   * pendingApprovals but for Suspend-tagged pauses. Wake scheduling
   * (2.6): timer triggers arm suspendTimers; event triggers are matched
   * by POST /v1/events against this map. `GET /v1/jobs/:id/suspend`
   * inspects what's blocked; manual POST /v1/jobs/:id/resume still
   * works.
   */
  pendingSuspends: Map<string, SuspendRequest>;
  /** SLA auto-reject timers, one per pending approval (2.1). Armed when
   *  a job pauses at an approval (or is rehydrated with one), cleared
   *  on resume/terminal. Timers are unref'd — they never hold the
   *  process open. */
  approvalTimers: Map<string, NodeJS.Timeout>;
  /** Suspend wake-up timers, one per pending timer-triggered suspend
   *  (2.6). Same lifecycle as approvalTimers; re-armed at boot from the
   *  original pausedAt, so a timer that expired while the server was
   *  down fires immediately. Event-triggered suspends have no timer —
   *  they wake through POST /v1/events. */
  suspendTimers: Map<string, NodeJS.Timeout>;
  /** Cron wake timers, one per schedule-triggered flow (3.1). Armed at
   *  boot, re-armed after each fire (long gaps re-check every 24h),
   *  cleared on stop. Unref'd. */
  cronTimers: Map<string, NodeJS.Timeout>;
  /** Workspace root for the container path (slice 9d-4). Defaults to
   *  process.cwd() at server start. */
  workspaceRoot: string;
  /** Server-wide default SSH agent forwarding (slice 9d-6). Per-job
   *  submissions can override via body.forwardSshAgent. */
  forwardSshAgent?: boolean | string;
  sshAgentContainerPath?: string;
  /** Path to edge-memory-server's UDS socket. When set, terminal
   *  job states fire a best-effort cleanup-unconfirmed call. Unset
   *  → cleanup is a no-op (operator can run the CLI manually). */
  memorySocketPath?: string;
  broker?: CredentialBroker;
  adapterFactory?: AdapterFactory;
  resolver?: BindingResolver;
  coordinatorModel?: BaseChatModel;
  /** Gate 2 — GitHub credential resolver for `kind: 'publish'` nodes
   *  (`push-and-open-pr`, `merge-pr`). A cascade: local `gh auth` first,
   *  controlplane-issued App token as fallback when `CONTROLPLANE_URL`
   *  is set. Built once at server start. Passed into runJob's
   *  RunJobDeps; the in-container path (harness-pipeline-cli) wires its
   *  own — TODO when remote workers land. */
  githubResolver: GitHubCredentialResolver;
  /** Gate 1d — worktree/container lifetime policy read from
   *  `harness-workspace.yml`'s `workspace.worktree` section. Drives
   *  the `removeContainerOnSuccess` / `removeContainerOnFailure` flags
   *  passed to runJobInContainer. `keepOnSuccess: true` (the PRD
   *  default) means the container persists after clean exit; cleanup
   *  is the reaper's job (Gate 1d.2). */
  worktreePolicy: WorktreePolicy;
}

function route(req: IncomingMessage, res: ServerResponse, ctx: ServerCtx) {
  const service = 'harness';
  const url = (req.url ?? '/').split('?')[0]!.replace(/\/$/, '') || '/';

  // GET /v1/jobs/:id/events — SSE stream. No body to buffer; attach handler now.
  const eventsMatch = req.method === 'GET' && url.match(/^\/v1\/jobs\/([^/]+)\/events$/);
  if (eventsMatch) {
    streamJobEvents(req, res, eventsMatch[1]!, ctx.bus);
    return;
  }

  // ─── Catalog routes ─────────────────────────────────────────────
  // Loaded at startup; writable by admins via PUT /v1/catalog (the
  // designer's save-to-server path — same socket trust model as every
  // other mutation). Writes validate with the real validator, persist
  // to the same .harness/config/flows.json boot reads (restart-
  // consistent), hot-swap the live catalog, and re-arm schedules.
  if (req.method === 'GET' && url === '/v1/catalog') {
    ok(res, { service, catalog: ctx.catalog, ts: new Date().toISOString() });
    return;
  }
  // Layout sidecar (designer node positions). Deliberately NOT part of
  // the catalog wire shape — FlowDef carries no editor concerns — but
  // stored server-side so arrangements travel between machines and
  // teammates. flowId → stepId → {x, y}, persisted next to flows.json.
  if (req.method === 'GET' && url === '/v1/catalog/layout') {
    void readLayoutSidecar(ctx)
      .then((layouts) => ok(res, { service, layouts, ts: new Date().toISOString() }))
      .catch(() => ok(res, { service, layouts: {}, ts: new Date().toISOString() }));
    return;
  }
  if (req.method === 'GET' && url === '/v1/catalog/flows') {
    ok(res, {
      service,
      flows: ctx.catalog.flows,
      count: ctx.catalog.flows.length,
      ts: new Date().toISOString(),
    });
    return;
  }
  const flowMatch = req.method === 'GET' && url.match(/^\/v1\/catalog\/flows\/([^/]+)$/);
  if (flowMatch) {
    const found = findFlow(ctx.catalog, flowMatch[1]!);
    if (!found) {
      notFound(res, `flow not found: ${flowMatch[1]}`);
      return;
    }
    ok(res, { service, flow: found, ts: new Date().toISOString() });
    return;
  }
  if (req.method === 'GET' && url === '/v1/catalog/products') {
    const products = ctx.catalog.products ?? [];
    ok(res, {
      service,
      products,
      count: products.length,
      ts: new Date().toISOString(),
    });
    return;
  }
  const productMatch = req.method === 'GET' && url.match(/^\/v1\/catalog\/products\/([^/]+)$/);
  if (productMatch) {
    const found = findProduct(ctx.catalog, productMatch[1]!);
    if (!found) {
      notFound(res, `product not found: ${productMatch[1]}`);
      return;
    }
    ok(res, { service, product: found, ts: new Date().toISOString() });
    return;
  }

  // GET /v1/jobs/:id/agents — registered agent list for a job
  const agentsMatch = req.method === 'GET' && url.match(/^\/v1\/jobs\/([^/]+)\/agents$/);
  if (agentsMatch) {
    const job = ctx.jobs.get(agentsMatch[1]!);
    if (!job) {
      notFound(res, `job not found: ${agentsMatch[1]}`);
      return;
    }
    ok(res, { service, jobId: job.jobId, agents: job.agents, ts: new Date().toISOString() });
    return;
  }

  // GET /v1/jobs/:id/approval — pending ApprovalRequest payload (for HITL UIs).
  // 404 when the job has no pending approval. Suspend has its own route.
  const approvalMatch = req.method === 'GET' && url.match(/^\/v1\/jobs\/([^/]+)\/approval$/);
  if (approvalMatch) {
    const id = approvalMatch[1]!;
    const request = ctx.pendingApprovals.get(id);
    if (!request) {
      notFound(res, `no pending approval for job: ${id}`);
      return;
    }
    ok(res, {
      service,
      jobId: id,
      request,
      claim: ctx.approvalClaims.get(id) ?? null,
      ts: new Date().toISOString(),
    });
    return;
  }

  // POST|DELETE /v1/jobs/:id/approval/claim — advisory-exclusive claim
  // on a pending approval (the pessimistic-locking half of
  // ApprovalTag.concurrency). Claiming is optional — an unclaimed
  // approval resumes as before — but once held, only the claimant may
  // resume; competing claims 409. Persisted with the paused job so the
  // lock survives restarts. No body needed, so handled pre-parse.
  const claimMatch =
    (req.method === 'POST' || req.method === 'DELETE') &&
    url.match(/^\/v1\/jobs\/([^/]+)\/approval\/claim$/);
  if (claimMatch) {
    const id = claimMatch[1]!;
    const request = ctx.pendingApprovals.get(id);
    if (!request) {
      notFound(res, `no pending approval for job: ${id}`);
      return;
    }
    const actor = req.headers['x-actor-id'];
    if (typeof actor !== 'string' || actor.length === 0) {
      badRequest(res, 'x-actor-id header is required to claim or release an approval');
      return;
    }
    const existing = ctx.approvalClaims.get(id);
    if (req.method === 'DELETE') {
      if (!existing) {
        notFound(res, `no claim to release on job: ${id}`);
        return;
      }
      if (existing.actor !== actor) {
        forbidden(
          res,
          `approval for job "${id}" is claimed by "${existing.actor}" — only the claimant may release`,
        );
        return;
      }
      ctx.approvalClaims.delete(id);
      void updatePausedJobClaim(ctx.stateDir, id, undefined).catch(() => {});
      ok(res, { service, jobId: id, released: true, ts: new Date().toISOString() });
      return;
    }
    const role = req.headers['x-actor-role'];
    if (typeof role !== 'string' || role !== request.assigneeRole) {
      forbidden(
        res,
        `role ${typeof role === 'string' ? `"${role}"` : '(none)'} is not authorized; ` +
          `claiming the approval for job "${id}" requires role "${request.assigneeRole}"`,
      );
      return;
    }
    if (existing && existing.actor !== actor) {
      conflict(
        res,
        `approval for job "${id}" is already claimed by "${existing.actor}" since ${existing.claimedAt}`,
      );
      return;
    }
    const claim: ApprovalClaim = existing ?? { actor, role, claimedAt: new Date().toISOString() };
    ctx.approvalClaims.set(id, claim);
    void updatePausedJobClaim(ctx.stateDir, id, claim).catch(() => {});
    ok(res, { service, jobId: id, claim, ts: new Date().toISOString() });
    return;
  }

  // GET /v1/jobs/:id/suspend — pending SuspendRequest payload. Mirrors the
  // approval route. Timer suspends wake themselves and event suspends
  // wake via POST /v1/events (2.6); this read surface remains for
  // inspection, and the manual resume (cron, event
  // handler, or operator) calls POST /v1/jobs/:id/resume manually.
  const suspendMatch = req.method === 'GET' && url.match(/^\/v1\/jobs\/([^/]+)\/suspend$/);
  if (suspendMatch) {
    const id = suspendMatch[1]!;
    const request = ctx.pendingSuspends.get(id);
    if (!request) {
      notFound(res, `no pending suspend for job: ${id}`);
      return;
    }
    ok(res, { service, jobId: id, request, ts: new Date().toISOString() });
    return;
  }

  // GET /v1/jobs/:id/files — full file listing for the job's product
  // repos with change overlay. Reviewer's entry point for browsing
  // what the agent did. Returns 200 even for jobs with no changes
  // (lists files at HEAD).
  const filesListMatch = req.method === 'GET' && url.match(/^\/v1\/jobs\/([^/]+)\/files$/);
  if (filesListMatch) {
    const id = filesListMatch[1]!;
    const job = ctx.jobs.get(id);
    if (!job) {
      notFound(res, `job not found: ${id}`);
      return;
    }
    handleFilesList(res, job).catch((err: Error) => {
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // GET /v1/jobs/:id/files/:repo/<path>/content — raw file bytes.
  // GET /v1/jobs/:id/files/:repo/<path>/diff    — unified diff vs HEAD.
  // The path captures multiple slash-separated segments; the trailing
  // /content or /diff suffix delimits.
  const fileEndpointMatch =
    req.method === 'GET' &&
    url.match(/^\/v1\/jobs\/([^/]+)\/files\/([^/]+)\/(.+)\/(content|diff)$/);
  if (fileEndpointMatch) {
    const [, jobId, repo, filePath, kind] = fileEndpointMatch;
    const job = ctx.jobs.get(jobId!);
    if (!job) {
      notFound(res, `job not found: ${jobId}`);
      return;
    }
    handleFileEndpoint(
      res,
      job,
      repo!,
      decodeURIComponent(filePath!),
      kind as 'content' | 'diff',
    ).catch((err: Error) => {
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // GET /v1/jobs/:id/steering — current steering array (read surface for
  // active-pull agents, the harness steering CLI, and operator dashboards).
  // Returns an empty array if the job has no steering yet — distinguish
  // from 404 which means "no such job."
  const steeringGetMatch = req.method === 'GET' && url.match(/^\/v1\/jobs\/([^/]+)\/steering$/);
  if (steeringGetMatch) {
    const id = steeringGetMatch[1]!;
    if (!ctx.jobs.has(id)) {
      notFound(res, `job not found: ${id}`);
      return;
    }
    handleGetSteering(res, id, ctx).catch((err: Error) => {
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: err.message }));
      }
    });
    return;
  }

  // GET /v1/dispatcher/status — queue depth, in-flight jobIds, capacity.
  if (req.method === 'GET' && url === '/v1/dispatcher/status') {
    ok(res, {
      service,
      ...dispatcherStatusSnapshot(ctx),
      ts: new Date().toISOString(),
    });
    return;
  }

  let body = '';
  req.on('data', (c) => (body += c.toString()));
  req.on('end', () => {
    const parsed = body ? safeJson(body) : null;

    // POST /v1/jobs — register + store
    if (req.method === 'POST' && url === '/v1/jobs' && parsed && typeof parsed === 'object') {
      // handleSubmitJob is async — when the coordinator model is wired,
      // the call awaits an LLM-driven pipeline-routing decision before
      // responding. Catch any unhandled rejection so a failure becomes
      // a 500 rather than an unhandled-promise crash.
      handleSubmitJob(res, parsed as Record<string, unknown>, ctx).catch((err: Error) => {
        if (!res.headersSent) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    // POST /v1/jobs/:id/resume — feed a Command({resume}) into the cached
    // graph. Body shape:
    //   - For Approval pauses: { decision: 'approve' | 'reject', steering?: ... }
    //   - For Suspend pauses: any value (resume is just the wake signal)
    // Responds 200 immediately and runs the resume in the background; the
    // caller polls GET /v1/jobs/:id (or subscribes to /events) to observe
    // the next status — completed, failed, or paused-again at another
    // interrupt.
    // GET /v1/triggers — ingress inventory (3.1): armed schedules with
    // their next fire time, webhook paths, event subscriptions.
    if (req.method === 'GET' && url === '/v1/triggers') {
      handleListTriggers(res, ctx);
      return;
    }

    // Webhook ingress (3.1): POST|GET /v1/hooks/<path> fires flows whose
    // trigger declares that path (+ method, default POST).
    const hookMatch = url.split('?')[0]?.match(/^\/v1\/hooks\/(.+)$/);
    if (hookMatch && (req.method === 'POST' || req.method === 'GET')) {
      handleWebhook(req, res, url, decodeURIComponent(hookMatch[1] ?? ''), parsed, ctx);
      return;
    }

    // PUT /v1/catalog — the designer's save-to-server path.
    if (req.method === 'PUT' && url === '/v1/catalog/layout' && parsed !== null) {
      handlePutLayout(res, parsed, ctx).catch((err: Error) => {
        if (!res.headersSent) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }
    if (req.method === 'PUT' && url === '/v1/catalog' && parsed !== null) {
      handlePutCatalog(res, parsed, ctx).catch((err: Error) => {
        if (!res.headersSent) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    // POST /v1/messages — message ingress (the message-trigger
    // transport): a chat relay (Slack, Discord, controlplane chat)
    // posts inbound messages here; flows subscribed to the channel
    // start with the message TEXT as their input (conversational
    // intake). One-way in v1 — the relay watches the spawned job.
    if (req.method === 'POST' && url === '/v1/messages' && parsed !== null) {
      handleIngestMessage(res, parsed, ctx);
      return;
    }

    // POST /v1/events — event ingress for suspend wake-ups (2.6).
    if (req.method === 'POST' && url === '/v1/events' && parsed !== null) {
      handleIngestEvent(res, parsed, ctx);
      return;
    }

    const resumeMatch = req.method === 'POST' ? url.match(/^\/v1\/jobs\/([^/]+)\/resume$/) : null;
    if (resumeMatch && parsed !== null) {
      const id = resumeMatch[1]!;
      handleResumeJob(req, res, id, parsed, ctx).catch((err: Error) => {
        if (!res.headersSent) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    // POST /v1/jobs/:id/steering — operator pushes steering text into a
    // running or paused job. Body: { text: string }. Reaches the agent
    // on its next adapter invocation (passive prepend) AND becomes
    // visible to active-pull skill consumers immediately.
    const steeringPostMatch =
      req.method === 'POST' ? url.match(/^\/v1\/jobs\/([^/]+)\/steering$/) : null;
    if (steeringPostMatch && parsed !== null && typeof parsed === 'object') {
      const id = steeringPostMatch[1]!;
      handleSteerJob(res, id, parsed as Record<string, unknown>, ctx).catch((err: Error) => {
        if (!res.headersSent) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    // POST /v1/jobs/:id/cancel — cooperative cancellation. Body:
    // { reason?: string }. Sets state.cancelRequested via the
    // checkpointer; the agent executor short-circuits to status
    // 'cancelled' at the next node-tick boundary.
    const cancelMatch = req.method === 'POST' ? url.match(/^\/v1\/jobs\/([^/]+)\/cancel$/) : null;
    if (cancelMatch) {
      const id = cancelMatch[1]!;
      const cancelBody =
        parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
      handleCancelJob(res, id, cancelBody, ctx).catch((err: Error) => {
        if (!res.headersSent) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }

    // POST /v1/loader-jobs — spawn an agentx-load worker, register it as
    // a JobRecord, bridge its events onto the JobBus as 'loader-event'
    // adapter envelopes. Once registered, jobs-tui sees the loader in
    // GET /v1/jobs and the SSE stream picks up its progress envelopes.
    if (
      req.method === 'POST' &&
      url === '/v1/loader-jobs' &&
      parsed &&
      typeof parsed === 'object'
    ) {
      void handleSubmitLoaderJob(res, parsed as Record<string, unknown>, ctx);
      return;
    }

    // GET /v1/jobs — list summaries (newest first)
    if (req.method === 'GET' && url === '/v1/jobs') {
      const list = [...ctx.jobs.values()].reverse();
      ok(res, { service, jobs: list, count: list.length, ts: new Date().toISOString() });
      return;
    }

    // GET /v1/jobs/:id — single job detail
    if (req.method === 'GET' && url.startsWith('/v1/jobs/')) {
      const id = url.slice('/v1/jobs/'.length);
      const job = ctx.jobs.get(id);
      if (!job) {
        notFound(res, `job not found: ${id}`);
        return;
      }
      ok(res, { service, job, ts: new Date().toISOString() });
      return;
    }

    // Everything else — default echo
    ok(res, {
      service,
      method: req.method,
      path: req.url,
      body: parsed,
      ts: new Date().toISOString(),
    });
  });
}

/**
 * Gate 2b — best-effort POST of an ApprovalRequest to the controlplane.
 *
 * Endpoint contract (controlplane side built with the deferred
 * controlplane work):
 *   POST {CONTROLPLANE_URL}/api/jobs/{jobId}/approval-event
 *   body: the ApprovalRequest (carries prUrl + diffSummary when an
 *         upstream publish node ran)
 *
 * No-op when CONTROLPLANE_URL is unset. All errors swallowed — the
 * harness-server UDS (`GET /v1/jobs/:id/approval`) is the source of
 * truth; this is a convenience mirror for the web HITL view.
 */
function emitApprovalToControlplane(jobId: string, request: ApprovalRequest): void {
  const base = process.env.CONTROLPLANE_URL?.replace(/\/$/, '');
  if (!base) return;
  void fetch(`${base}/api/jobs/${encodeURIComponent(jobId)}/approval-event`, {
    method: 'POST',
    headers: controlplaneHeaders(),
    body: JSON.stringify(request),
  }).catch(() => {
    // swallowed — UDS surface remains authoritative
  });
}

/**
 * W1d — best-effort push of a job-level status transition to the
 * controlplane so `GET /api/jobs/:id` reflects the harness-server's
 * truth. No-op when CONTROLPLANE_URL is unset (local-only / TUI-only
 * setups read status from the UDS instead). Errors swallowed — the
 * harness-server's in-memory JobRecord is authoritative; this is the
 * mirror. The controlplane maps harness-server's status vocabulary
 * (received|running|awaiting-approval|suspended|completed|failed|cancelled)
 * to its own JobStatus.
 */
function emitJobStatusToControlplane(jobId: string, status: string, failureReason?: string): void {
  const base = process.env.CONTROLPLANE_URL?.replace(/\/$/, '');
  if (!base) return;
  void fetch(`${base}/api/jobs/${encodeURIComponent(jobId)}/status`, {
    method: 'POST',
    headers: controlplaneHeaders(),
    body: JSON.stringify({ status, ...(failureReason ? { failureReason } : {}) }),
  }).catch(() => {
    // swallowed — UDS / in-memory JobRecord remains authoritative
  });
}

function controlplaneHeaders(): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'X-Org-Id': process.env.AGENTX_ORG_ID ?? 'dev-org',
    'X-User-Id': 'harness-server',
  };
}

async function handleSubmitJob(
  res: ServerResponse,
  body: Record<string, unknown>,
  ctx: ServerCtx,
): Promise<void> {
  const jobId = typeof body.jobId === 'string' ? body.jobId : null;
  let pipelineId = typeof body.pipeline === 'string' ? body.pipeline : null;
  // Job submission may carry a `set` to pick a named accepts-set. Per
  // memory `project_set_scoped_accepts`, this is per-job policy: the
  // same harness can serve different sets concurrently. Defaults to
  // 'default' — agents whose accepts is a flat list ignore the set.
  const setName = typeof body.set === 'string' && body.set ? body.set : 'default';
  // The user's intent / input prompt — used both as the job's initial
  // input AND as the entry coordinator's routing signal when no
  // pipeline is provided.
  const intent = typeof body.input === 'string' ? body.input : '';

  if (!jobId) {
    badRequest(res, 'jobId is required');
    return;
  }

  // Auto-route via the entry coordinator when no pipeline is given AND
  // a coordinator model is configured AND the submission carries an
  // intent. Per memory project_langgraph_two_scopes — coordinator
  // workflows are admin-owned and run inside harness-server (this
  // process) with their own admin-trust LLM. Decision is made BEFORE
  // job registration so the response carries the resolved pipeline id.
  if (!pipelineId && ctx.coordinatorModel && intent) {
    try {
      const decision = await runEntryCoordinator({
        intent,
        catalog: ctx.catalog,
        model: ctx.coordinatorModel,
      });
      if (decision.pipelineId === 'NONE' || !findFlow(ctx.catalog, decision.pipelineId)) {
        const known = ctx.catalog.flows.map((p) => p.id);
        badRequest(
          res,
          `coordinator could not pick a valid pipeline for the intent. ` +
            `Coordinator returned: "${decision.pipelineId}". Known pipelines: ${known.join(', ') || '(none)'}.`,
        );
        return;
      }
      pipelineId = decision.pipelineId;
    } catch (err) {
      badRequest(res, `coordinator routing failed: ${(err as Error).message}`);
      return;
    }
  }

  let agents: RegisteredAgent[];
  // Resolved FlowDef for the picked pipeline — attached to the JobRecord
  // so runJob's graph executor can honor non-linear topology, edge kinds,
  // and tags. When pipelineId is null (registration-only mode) no flow
  // is attached and runJob falls back to linearFlowFromAgents at fire
  // time.
  let resolvedFlow: ReturnType<typeof findFlow>;
  try {
    if (pipelineId) {
      const pipeline = findFlow(ctx.catalog, pipelineId);
      if (!pipeline) {
        const known = ctx.catalog.flows.map((p) => p.id);
        badRequest(
          res,
          `unknown pipeline "${pipelineId}". Known: ${known.join(', ') || '(none registered)'}`,
        );
        return;
      }
      resolvedFlow = pipeline;
      const flatAgents = [...walkAgents(pipeline, (id) => findFlow(ctx.catalog, id))];
      agents = [
        registeredFromDef(COORDINATOR_AGENT, setName),
        ...flatAgents.map((d) => registeredFromDef(d, setName)),
        registeredFromDef(CHECKOUT_COORDINATOR_AGENT, setName),
      ];
    } else {
      // Submit without a pipeline AND no coordinator model — register only
      // the entry coordinator placeholder. Useful for smoke tests and pre-
      // coordinator-rollout deployments. We omit checkout-coordinator
      // here because there's no pipeline output to consolidate.
      agents = [registeredFromDef(COORDINATOR_AGENT, setName)];
    }
  } catch (err) {
    // resolveAccepts throws CatalogError when the requested set is missing
    // and no `default` is declared on the agent — surface as 400 with the
    // actionable message.
    badRequest(res, (err as Error).message);
    return;
  }

  const submittedAt =
    typeof body.submittedAt === 'string' ? body.submittedAt : new Date().toISOString();

  const job: JobRecord = {
    ...body,
    jobId,
    // Reflect the resolved pipeline id when the entry coordinator
    // auto-routed (body.pipeline was undefined; we set pipelineId via
    // runEntryCoordinator). Clients reading the response can then see
    // exactly which pipeline got picked.
    ...(pipelineId ? { pipeline: pipelineId } : {}),
    // Attach the catalog FlowDef so runJob's graph executor honors the
    // declared topology (Approval gates, conditional edges, reject
    // cycles, …) instead of synthesizing a flat linear flow from the
    // agents list. Absent for registration-only submissions.
    ...(resolvedFlow ? { flow: resolvedFlow } : {}),
    // workdirRoot tells the agent executor where product repos live —
    // for the in-process path that's the workspace root. Container
    // path (runJobInContainer) overrides via its own JobRecord setup
    // when the per-job worktree is created.
    workdirRoot: ctx.workspaceRoot,
    status: 'received',
    submittedAt,
    agents,
  };
  // Pre-flight capacity check for the in-process runJob path. Container
  // submissions flow through their own concurrency boundary (one
  // container per job) and bypass the dispatcher. Only deny here when
  // we're certain we'd hit the dispatcher AND it'd reject.
  const willUseContainer =
    process.env.AGENTX_USE_CONTAINER === '1' &&
    ctx.resolver !== undefined &&
    hasContainerRepos(body, job, ctx);
  if (ctx.broker && !willUseContainer) {
    const decision = evaluateSubmission(ctx);
    if (decision.kind === 'reject') {
      res.statusCode = 503;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          error: decision.reason,
          jobId,
          dispatcher: dispatcherStatusSnapshot(ctx),
          ts: new Date().toISOString(),
        }),
      );
      return;
    }
  }

  ctx.jobs.set(jobId, job);

  // Slice 13d: attach the token accumulator BEFORE runJob fires.
  // JobBus drops events when nobody's subscribed for a jobId
  // (job-bus.ts:25-27), so any later attach would miss the first
  // adapter response. Detach happens via runJob's onStatusChange when
  // the job reaches a terminal state.
  ctx.tokens.attach(ctx.bus, jobId);

  ok(res, {
    service: 'harness',
    method: 'POST',
    path: '/v1/jobs',
    body,
    job,
    ts: new Date().toISOString(),
  });

  // Kick off the orchestrator in the background — only if a broker is wired.
  // Without a broker we have no way to authenticate adapter calls, so we leave
  // jobs in `received` state with all agents `pending` (registration-only mode).
  //
  // Slice 9d-4 — when AGENTX_USE_CONTAINER=1 AND a resolver + repos are
  // available, route through the container path (spawnWorker → runWorker →
  // runPipelineInContainer). Otherwise stay on the in-process runJob path
  // that's been the default since slice 6.
  if (ctx.broker) {
    const broker = ctx.broker;
    const adapterFactory = ctx.adapterFactory;
    const resolver = ctx.resolver;
    const githubResolver = ctx.githubResolver;
    const tokens = ctx.tokens;
    const onJobTerminal = (agentId: string | null, status: string) => {
      // Token accumulator detaches on job-level terminal transitions
      // (agentId === null). Same hook works for both paths.
      if (agentId === null && (status === 'completed' || status === 'failed')) {
        tokens.detach(jobId);
        // Clear any leftover pause-state when the job ends (defensive —
        // runJob already drops the cached graph; pending-request maps
        // also get explicit cleanup on resume but a final sweep here
        // catches the failed-after-pause path).
        ctx.pendingApprovals.delete(jobId);
        ctx.approvalClaims.delete(jobId);
        ctx.approvalClaims.delete(jobId);
        ctx.pendingSuspends.delete(jobId);
      }
    };
    const useContainer = process.env.AGENTX_USE_CONTAINER === '1' && resolver !== undefined;

    // Resolve repos for the container path. Priority: explicit
    // body.repos wins; otherwise look up from the catalog product
    // (slice 9d-5). Either source must yield a non-empty list before
    // we route through the container path; otherwise fall through to
    // the in-process path.
    let containerRepos: SpawnRepoSpec[] | null = null;
    if (useContainer) {
      const submissionRepos = parseRepos(body.repos);
      if (submissionRepos !== null && submissionRepos.length > 0) {
        containerRepos = submissionRepos;
      } else if (job.productId) {
        const product = findProduct(ctx.catalog, job.productId);
        if (product?.repos && product.repos.length > 0) {
          // ProductRepo and SpawnRepoSpec are structurally identical;
          // copy the array so callers can't mutate the catalog.
          containerRepos = product.repos.map((r) => ({
            name: r.name,
            cloneUrl: r.cloneUrl,
            ...(r.baseRef ? { baseRef: r.baseRef } : {}),
            ...(r.path ? { path: r.path } : {}),
          }));
        }
      }
    }

    // The dispatcher gates only the in-process path. Container submissions
    // flow through their own concurrency boundary (one container per job).
    if (useContainer && containerRepos !== null && containerRepos.length > 0) {
      const containerProductId = job.productId ?? 'unknown';
      const containerPipeline = pipelineId ?? 'noop';
      // Slice 9d-6: per-job body override wins; server-wide default
      // applies otherwise. `body.forwardSshAgent === false` explicitly
      // turns off forwarding even when the server has it enabled.
      const bodyForward = body.forwardSshAgent;
      const forwardSshAgent =
        bodyForward === true || bodyForward === false || typeof bodyForward === 'string'
          ? bodyForward
          : ctx.forwardSshAgent;
      queueMicrotask(() => {
        void runJobInContainer({
          jobId,
          jobs: ctx.jobs,
          bus: ctx.bus,
          broker,
          resolver: resolver!,
          workspaceRoot: ctx.workspaceRoot,
          repos: containerRepos!,
          productId: containerProductId,
          pipeline: containerPipeline,
          setName,
          // Gate 1d — translate worktree policy into runJobInContainer's
          // container-removal flags. `keepOn*: true` ⇒ never remove
          // automatically; rely on the reaper (Gate 1d.2) instead.
          removeContainerOnSuccess: !ctx.worktreePolicy.keepOnSuccess,
          removeContainerOnFailure: !ctx.worktreePolicy.keepOnFailure,
          ...(forwardSshAgent !== undefined ? { forwardSshAgent } : {}),
          ...(ctx.sshAgentContainerPath
            ? { sshAgentContainerPath: ctx.sshAgentContainerPath }
            : {}),
          onStatusChange: (jid, agentId, status) => {
            onJobTerminal(agentId, status);
            // W1d — push job-level transitions up to the controlplane.
            if (agentId === null) emitJobStatusToControlplane(jid, status);
            // Mirror the in-process F19 cleanup hook for the
            // container path. Terminal job-status (job-level, not
            // agent-level) → best-effort cleanup-unconfirmed.
            if (
              agentId === null &&
              (status === 'completed' || status === 'failed' || status === 'cancelled') &&
              ctx.memorySocketPath
            ) {
              void cleanupJobMemory(ctx.memorySocketPath, jid).catch(() => {});
            }
          },
        });
      });
      return;
    }

    // Dispatch through the in-process dispatcher: bounded concurrency
    // with FIFO queueing. Capacity check has already happened above
    // (we 503'd before responding 200 if the queue overflow threshold
    // was hit) — this fire closure either runs immediately or waits in
    // the queue for a slot. executeRun carries the full hook wiring,
    // shared with JobIntent child spawns (2.9).
    const fire = () => executeRun(ctx, jobId);

    const decision = evaluateSubmission(ctx);
    if (decision.kind === 'fire-immediate') {
      dispatcherFireImmediate(ctx, jobId, fire);
    } else if (decision.kind === 'enqueue') {
      dispatcherEnqueue(ctx, jobId, fire);
    }
    // 'reject' decision is impossible here — capacity was checked before
    // the 200 response. Defensive: if it somehow happens, fall through
    // (the job stays in 'received' state; operator visibility via
    // /v1/dispatcher/status flags it).
  }
}

/**
 * Resume a paused job — feeds the body verbatim into Command({resume}) on
 * the cached compiled graph. Validates the job exists + is paused; then
 * fires resumeJob in the background and returns 202-style ack.
 *
 * Approval body shape: { decision: 'approve' | 'reject', steering?: ... }
 * Suspend body shape: any value (the wake signal — payload unused).
 *
 * The response always returns immediately. Status transitions land on the
 * JobBus / GET /v1/jobs/:id; this endpoint just kicks the resume.
 */
async function handleResumeJob(
  req: IncomingMessage,
  res: ServerResponse,
  jobId: string,
  body: unknown,
  ctx: ServerCtx,
): Promise<void> {
  const job = ctx.jobs.get(jobId);
  if (!job) {
    notFound(res, `job not found: ${jobId}`);
    return;
  }
  if (job.status !== 'awaiting-approval' && job.status !== 'suspended') {
    badRequest(
      res,
      `job "${jobId}" is not paused (status: ${job.status}). Only awaiting-approval / suspended jobs can resume.`,
    );
    return;
  }
  const broker = ctx.broker;
  if (!broker) {
    badRequest(res, 'cannot resume — no credential broker configured on this server');
    return;
  }

  // 2.1 — approval resumes are gated; suspend resumes are just a wake
  // signal (no decision, no role on SuspendTag) and pass through.
  const pending = ctx.pendingApprovals.get(jobId);
  if (job.status === 'awaiting-approval') {
    const decision = (body as { decision?: unknown } | null)?.decision;
    if (decision !== 'approve' && decision !== 'reject') {
      badRequest(
        res,
        `resume body for an approval must carry decision: 'approve' | 'reject' (got ${JSON.stringify(decision)})`,
      );
      return;
    }
    // Role check: the caller must assert the assignee role via the
    // x-actor-role header. This is header-asserted identity over the
    // already-0600-scoped UDS transport — an enforcement point, not
    // authentication; real authn replaces the header source later.
    // The SLA auto-reject timer bypasses this by construction (it
    // calls executeResume directly — the server acting as itself).
    if (pending) {
      const role = req.headers['x-actor-role'];
      if (typeof role !== 'string' || role !== pending.assigneeRole) {
        forbidden(
          res,
          `role ${typeof role === 'string' ? `"${role}"` : '(none)'} is not authorized; ` +
            `approval for job "${jobId}" requires role "${pending.assigneeRole}"`,
        );
        return;
      }
      // Pessimistic lock: once claimed, only the claimant may resume.
      // Unclaimed approvals resume exactly as before (advisory lock).
      // The SLA auto-reject bypasses by construction — it calls
      // executeResume directly, the server acting as itself.
      const claim = ctx.approvalClaims.get(jobId);
      if (claim) {
        const actor = req.headers['x-actor-id'];
        if (typeof actor !== 'string' || actor !== claim.actor) {
          conflict(
            res,
            `approval for job "${jobId}" is claimed by "${claim.actor}" since ${claim.claimedAt} — ` +
              `only the claimant may resume (release via DELETE /v1/jobs/${jobId}/approval/claim)`,
          );
          return;
        }
      }
    }
  }

  const wasApproval = job.status === 'awaiting-approval';

  ok(res, {
    service: 'harness',
    method: 'POST',
    path: `/v1/jobs/${jobId}/resume`,
    body,
    job,
    accepted: wasApproval ? 'approval' : 'suspend',
    ts: new Date().toISOString(),
  });

  executeResume(ctx, jobId, body);
}

/**
 * The single in-process run-execution path (2.9) — shared by the HTTP
 * submit route's dispatcher fire and JobIntent child spawns, so every
 * job gets identical hook wiring: status/controlplane emission,
 * dispatcher-slot release, pause persistence, SLA/suspend timers,
 * pending-request bookkeeping, token detach, memory cleanup, and
 * recursive intent emission.
 */
function executeRun(ctx: ServerCtx, jobId: string): void {
  const broker = ctx.broker;
  if (!broker) return; // registration-only mode — callers gate on this too
  const tokens = ctx.tokens;
  void runJob(jobId, {
    jobs: ctx.jobs,
    bus: ctx.bus,
    broker,
    adapterFactory: ctx.adapterFactory,
    resolver: ctx.resolver,
    // Subflow targets resolve against the live catalog (v2: inner
    // flows may contain agents and approval/suspend tags).
    flowResolver: (id) => findFlow(ctx.catalog, id),
    ...(ctx.githubResolver ? { githubResolver: ctx.githubResolver } : {}),
    graphs: ctx.graphs,
    checkpointer: ctx.checkpointer,
    onStatusChange: (jid, agentId, status) => {
      if (agentId === null && (status === 'completed' || status === 'failed')) {
        tokens.detach(jid);
        ctx.pendingApprovals.delete(jid);
        ctx.approvalClaims.delete(jid);
        ctx.pendingSuspends.delete(jid);
      }
      // W1d — push job-level transitions up to the controlplane.
      if (agentId === null) emitJobStatusToControlplane(jid, status);
      // Free the dispatcher slot on terminal status. Paused statuses
      // (awaiting-approval / suspended) are intentionally NOT terminal —
      // paused jobs continue holding their slot until they actually
      // complete or fail.
      if (
        agentId === null &&
        (status === 'completed' || status === 'failed' || status === 'cancelled')
      ) {
        dispatcherOnJobTerminal(ctx, jid);
        // 2.2 — a terminal job is no longer paused; drop its persisted
        // pause record (no-op when none exists) and any timers.
        void deletePausedJob(ctx.stateDir, jid).catch(() => {});
        clearSlaTimer(ctx, jid);
        clearSuspendTimer(ctx, jid);
        // F19: best-effort cleanup of unconfirmed memory entries scoped
        // to this job. Failures are swallowed — operators can run
        // `edge-memory cleanup --scope jobId:X` as the fallback.
        if (ctx.memorySocketPath) {
          void cleanupJobMemory(ctx.memorySocketPath, jid).catch(() => {
            // already logged inside cleanupJobMemory
          });
        }
      }
    },
    onAwaitingApproval: (jid, request) => {
      ctx.pendingApprovals.set(jid, request);
      persistPause(ctx, jid, 'approval', request);
      armSlaTimer(ctx, jid, request, new Date().toISOString());
      // Gate 2b — best-effort mirror to the controlplane HITL view.
      emitApprovalToControlplane(jid, request);
    },
    onSuspend: (jid, request) => {
      ctx.pendingSuspends.set(jid, request);
      persistPause(ctx, jid, 'suspend', request);
      armSuspendTimer(ctx, jid, request, new Date().toISOString());
    },
    onJobIntents: (jid, intents) => spawnJobsFromIntents(ctx, jid, intents),
  });
}

/**
 * Submit a catalog flow as a new job through the dispatcher (3.1 / 2.9)
 * — the single spawn path shared by JobIntent emission, webhook / event
 * / schedule trigger firing. Registers the flow's agents (accepts-set
 * aware), records lineage/provenance fields when given, and fires via
 * executeRun. Returns the jobId, or an error string when the spawn
 * cannot happen (unresolvable accepts set, dispatcher overflow — the
 * record then stays 'received' for operator visibility).
 */
function spawnFlowJob(
  ctx: ServerCtx,
  flow: FlowDef,
  opts: {
    input: string;
    setName?: string;
    productId?: string;
    config?: Record<string, unknown>;
    parentJobId?: string;
    triggeredBy?: string;
  },
): { jobId: string } | { error: string } {
  const setName = opts.setName ?? 'default';
  let agents: RegisteredAgent[];
  try {
    agents = [
      registeredFromDef(COORDINATOR_AGENT, setName),
      ...[...walkAgents(flow, (id) => findFlow(ctx.catalog, id))].map((d) =>
        registeredFromDef(d, setName),
      ),
      registeredFromDef(CHECKOUT_COORDINATOR_AGENT, setName),
    ];
  } catch (err) {
    return { error: (err as Error).message };
  }
  const jobId = `job_${randomUUID().slice(0, 8)}`;
  const job: JobRecord = {
    jobId,
    pipeline: flow.id,
    ...(opts.productId !== undefined ? { productId: opts.productId } : {}),
    input: opts.input,
    ...(opts.config ? { config: opts.config } : {}),
    flow,
    workdirRoot: ctx.workspaceRoot,
    status: 'received',
    submittedAt: new Date().toISOString(),
    agents,
    ...(opts.parentJobId ? { parentJobId: opts.parentJobId } : {}),
    ...(opts.triggeredBy ? { triggeredBy: opts.triggeredBy } : {}),
  };
  ctx.jobs.set(jobId, job);
  ctx.tokens.attach(ctx.bus, jobId);
  const decision = evaluateSubmission(ctx);
  const fire = () => executeRun(ctx, jobId);
  if (decision.kind === 'fire-immediate') {
    dispatcherFireImmediate(ctx, jobId, fire);
  } else if (decision.kind === 'enqueue') {
    dispatcherEnqueue(ctx, jobId, fire);
  } else {
    return {
      error: `dispatcher at capacity (${decision.reason}) — job ${jobId} left in 'received'`,
    };
  }
  return { jobId };
}

/**
 * JobIntent emission (2.9) — the factory/fleet seam's second half.
 * Called when a job-definition flow completes with enforced intent(s):
 * each intent becomes a child job submitted through the same dispatcher
 * as HTTP submissions. Lineage is recorded both ways (parentJobId /
 * spawnedJobIds); intents that cannot spawn (unknown flowId,
 * unresolvable accepts set) land on parent.spawnErrors and are warned —
 * the parent stays completed: its own work (emitting a well-formed
 * order) succeeded.
 */
function spawnJobsFromIntents(ctx: ServerCtx, parentJobId: string, intents: JobIntent[]): void {
  const parent = ctx.jobs.get(parentJobId);
  const spawned: string[] = [];
  const errors: string[] = [];
  for (const intent of intents) {
    const flow = findFlow(ctx.catalog, intent.flowId);
    if (!flow) {
      errors.push(`intent flowId "${intent.flowId}" is not in the catalog`);
      continue;
    }
    const spawnResult = spawnFlowJob(ctx, flow, {
      input: typeof intent.input === 'string' ? intent.input : JSON.stringify(intent.input),
      setName: intent.set ?? 'default',
      productId: intent.productId,
      ...(intent.config ? { config: intent.config } : {}),
      parentJobId,
    });
    if ('jobId' in spawnResult) {
      spawned.push(spawnResult.jobId);
    } else {
      errors.push(`intent for "${intent.flowId}": ${spawnResult.error}`);
    }
  }
  if (parent) {
    parent.spawnedJobIds = spawned;
    if (errors.length > 0) parent.spawnErrors = errors;
  }
  for (const e of errors) {
    console.warn(`[harness] job ${parentJobId}: intent spawn skipped — ${e}`);
  }
}

/**
 * The single resume-execution path (2.1) — shared by the HTTP route and
 * the SLA auto-reject timer, so both clear the same state and fire the
 * same hooks. Clears the pending request + SLA timer + persisted pause
 * record, re-attaches the token accumulator, and kicks resumeJob on a
 * microtask. resumeJob may surface a NEW request via the hooks if the
 * flow pauses again downstream.
 */
function executeResume(ctx: ServerCtx, jobId: string, resumeValue: unknown): void {
  const broker = ctx.broker;
  if (!broker) {
    // The HTTP route 400s before reaching here; this guards the timer path.
    console.warn(`[harness] cannot resume job ${jobId} — no credential broker configured`);
    return;
  }
  clearSlaTimer(ctx, jobId);
  clearSuspendTimer(ctx, jobId);
  ctx.pendingApprovals.delete(jobId);
  ctx.approvalClaims.delete(jobId);
  ctx.pendingSuspends.delete(jobId);
  // 2.2 — the persisted pause record is stale once we kick resumeJob; a
  // downstream pause writes a fresh one via the hooks below.
  void deletePausedJob(ctx.stateDir, jobId).catch(() => {});

  // Re-attach the token accumulator before resuming. Detach happens via
  // onStatusChange when the job hits a terminal state — same as runJob.
  ctx.tokens.attach(ctx.bus, jobId);

  const resolver = ctx.resolver;
  const adapterFactory = ctx.adapterFactory;
  const tokens = ctx.tokens;
  const onJobTerminal = (agentId: string | null, status: string) => {
    if (agentId === null && (status === 'completed' || status === 'failed')) {
      tokens.detach(jobId);
      clearSlaTimer(ctx, jobId);
      clearSuspendTimer(ctx, jobId);
      ctx.pendingApprovals.delete(jobId);
      ctx.approvalClaims.delete(jobId);
      ctx.pendingSuspends.delete(jobId);
      void deletePausedJob(ctx.stateDir, jobId).catch(() => {});
      // Paused jobs hold their dispatcher slot until a true terminal
      // state — release it here (the run-path release only fires for
      // jobs that never paused; a resumed job ends through THIS hook).
      dispatcherOnJobTerminal(ctx, jobId);
      // F19: same cleanup hook as the initial-submission paths. A
      // resumed job that ultimately completes from this path should
      // also clean up its unconfirmed memory.
      if (ctx.memorySocketPath) {
        void cleanupJobMemory(ctx.memorySocketPath, jobId).catch(() => {});
      }
    }
  };
  queueMicrotask(() => {
    void resumeJob(jobId, resumeValue, {
      jobs: ctx.jobs,
      bus: ctx.bus,
      broker,
      adapterFactory,
      resolver,
      flowResolver: (id) => findFlow(ctx.catalog, id),
      graphs: ctx.graphs,
      // 2.2 — the shared durable checkpointer enables recompile-on-
      // resume after a restart, and the GitHub resolver must ride along
      // so a recompiled graph's publish executors are wired identically
      // to the original runJob compile.
      checkpointer: ctx.checkpointer,
      githubResolver: ctx.githubResolver,
      onStatusChange: (_jid, agentId, status) => onJobTerminal(agentId, status),
      onAwaitingApproval: (jid, request) => {
        ctx.pendingApprovals.set(jid, request);
        persistPause(ctx, jid, 'approval', request);
        armSlaTimer(ctx, jid, request, new Date().toISOString());
      },
      onSuspend: (jid, request) => {
        ctx.pendingSuspends.set(jid, request);
        persistPause(ctx, jid, 'suspend', request);
        armSuspendTimer(ctx, jid, request, new Date().toISOString());
      },
      // 2.9 — a job-definition flow resumed past a pause still emits.
      onJobIntents: (jid, intents) => spawnJobsFromIntents(ctx, jid, intents),
    });
  });
}

/**
 * Arm the approval SLA auto-reject timer (2.1). `pausedAtIso` anchors
 * the deadline so a rehydrated approval resumes its ORIGINAL clock (an
 * already-expired SLA fires immediately). The timer bypasses the HTTP
 * role gate by construction — auto-reject is the server acting as
 * itself, not a caller asserting a role. Unref'd: never holds the
 * process open.
 */
function armSlaTimer(
  ctx: ServerCtx,
  jobId: string,
  request: ApprovalRequest,
  pausedAtIso: string,
): void {
  clearSlaTimer(ctx, jobId);
  const remaining = request.slaMs - (Date.now() - Date.parse(pausedAtIso));
  const timer = setTimeout(
    () => {
      ctx.approvalTimers.delete(jobId);
      const job = ctx.jobs.get(jobId);
      if (!job || job.status !== 'awaiting-approval' || !ctx.pendingApprovals.has(jobId)) return;
      console.warn(
        `[harness] approval SLA of ${request.slaMs}ms expired for job ${jobId} — auto-rejecting`,
      );
      executeResume(ctx, jobId, {
        decision: 'reject',
        steering: `auto-rejected: approval SLA of ${request.slaMs}ms expired with no reviewer decision`,
      });
    },
    Math.max(0, remaining),
  );
  timer.unref?.();
  ctx.approvalTimers.set(jobId, timer);
}

function clearSlaTimer(ctx: ServerCtx, jobId: string): void {
  const timer = ctx.approvalTimers.get(jobId);
  if (timer) {
    clearTimeout(timer);
    ctx.approvalTimers.delete(jobId);
  }
}

/**
 * Arm a suspend wake-up timer (2.6) for timer-triggered suspends.
 * `pausedAtIso` anchors the deadline so a rehydrated suspend resumes
 * its ORIGINAL clock (an already-expired timer fires immediately).
 * Event-triggered suspends have no timer — they wake via
 * POST /v1/events. The wake flows through executeResume, the same path
 * the HTTP resume route uses; the suspend executor discards the resume
 * value, so the payload is purely diagnostic.
 */
function armSuspendTimer(
  ctx: ServerCtx,
  jobId: string,
  request: SuspendRequest,
  pausedAtIso: string,
): void {
  if (request.trigger.kind !== 'timer') return;
  clearSuspendTimer(ctx, jobId);
  const remaining = request.trigger.durationMs - (Date.now() - Date.parse(pausedAtIso));
  const timer = setTimeout(
    () => {
      ctx.suspendTimers.delete(jobId);
      const job = ctx.jobs.get(jobId);
      if (!job || job.status !== 'suspended' || !ctx.pendingSuspends.has(jobId)) return;
      executeResume(ctx, jobId, { wake: 'timer', firedAt: new Date().toISOString() });
    },
    Math.max(0, remaining),
  );
  timer.unref?.();
  ctx.suspendTimers.set(jobId, timer);
}

function clearSuspendTimer(ctx: ServerCtx, jobId: string): void {
  const timer = ctx.suspendTimers.get(jobId);
  if (timer) {
    clearTimeout(timer);
    ctx.suspendTimers.delete(jobId);
  }
}

/**
 * POST /v1/events (2.6) — the v1 event-ingress seam (a webhook relay,
 * cron shim, or the controlplane posts here; a real bus subscription
 * can replace the transport without touching the matching). Wakes every
 * pending event-triggered suspend whose eventType matches and whose
 * declared matcher (if any) passes against the event envelope
 * `{ type, payload }` — the matcher's defined binding surface.
 */
function handleIngestEvent(res: ServerResponse, body: unknown, ctx: ServerCtx): void {
  const event = body as { type?: unknown; payload?: unknown } | null;
  if (!event || typeof event.type !== 'string' || !event.type) {
    badRequest(res, "event ingest requires a non-empty string 'type' (payload optional)");
    return;
  }
  const envelope = { type: event.type, payload: event.payload };
  const woke: string[] = [];
  for (const [jobId, request] of ctx.pendingSuspends) {
    if (request.trigger.kind !== 'event') continue;
    if (request.trigger.eventType !== event.type) continue;
    if (request.trigger.matcher && !evalExpression(request.trigger.matcher, envelope)) continue;
    const job = ctx.jobs.get(jobId);
    if (!job || job.status !== 'suspended') continue;
    woke.push(jobId);
    executeResume(ctx, jobId, { wake: 'event', event: envelope });
  }
  // 3.1 — the same event also STARTS flows whose trigger subscribes to
  // this type (matcher evaluated against the identical envelope).
  const started: string[] = [];
  for (const flow of ctx.catalog.flows) {
    const cfg = triggerConfigOf(flow);
    if (!cfg || cfg.kind !== 'event' || cfg.eventType !== event.type) continue;
    if (cfg.matcher && !evalExpression(cfg.matcher, envelope)) continue;
    const spawnResult = spawnFlowJob(ctx, flow, {
      input: JSON.stringify(envelope),
      triggeredBy: `event:${event.type}`,
    });
    if ('jobId' in spawnResult) {
      started.push(spawnResult.jobId);
    } else {
      console.warn(
        `[harness] event trigger for flow "${flow.id}" could not fire: ${spawnResult.error}`,
      );
    }
  }
  ok(res, {
    service: 'harness',
    method: 'POST',
    path: '/v1/events',
    woke,
    started,
    ts: new Date().toISOString(),
  });
}

/**
 * PUT /v1/catalog — the designer's save-to-server path. Validates with
 * the real validator (400 with the path-prefixed message; the live
 * catalog untouched), persists to .harness/config/flows.json (awaited —
 * the response means it's durable), hot-swaps ctx.catalog, and re-arms
 * schedule triggers against the new flows. Warnings (the remaining
 * report ids) return in the response. In-flight jobs are unaffected:
 * JobRecord.flow is a snapshot taken at submission.
 */
/** flowId → stepId → {x, y} — the designer's layout sidecar shape.
 *  Kept OUT of flow-spec deliberately: it is editor state, not wire
 *  contract (the same three-line shape lives in the designer's
 *  layout-store; duplicating it beats polluting the spec). */
type LayoutSidecar = Record<string, Record<string, { x: number; y: number }>>;

function layoutSidecarPath(ctx: ServerCtx): string {
  return join(ctx.workspaceRoot, '.harness', 'config', 'flows.layout.json');
}

async function readLayoutSidecar(ctx: ServerCtx): Promise<LayoutSidecar> {
  try {
    return JSON.parse(await readFile(layoutSidecarPath(ctx), 'utf8')) as LayoutSidecar;
  } catch {
    return {};
  }
}

function isLayoutSidecar(body: unknown): body is LayoutSidecar {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
  return Object.values(body as Record<string, unknown>).every(
    (flow) =>
      !!flow &&
      typeof flow === 'object' &&
      !Array.isArray(flow) &&
      Object.values(flow as Record<string, unknown>).every(
        (pos) =>
          !!pos &&
          typeof pos === 'object' &&
          typeof (pos as { x?: unknown }).x === 'number' &&
          typeof (pos as { y?: unknown }).y === 'number',
      ),
  );
}

/** Merge semantics mirror the designer's store: incoming flows replace
 *  their stored layout wholesale; unmentioned flows keep theirs. */
async function handlePutLayout(res: ServerResponse, body: unknown, ctx: ServerCtx): Promise<void> {
  if (!isLayoutSidecar(body)) {
    badRequest(
      res,
      'PUT /v1/catalog/layout: body must map flowId → stepId → { x: number, y: number }',
    );
    return;
  }
  const merged = { ...(await readLayoutSidecar(ctx)), ...body };
  const configDir = join(ctx.workspaceRoot, '.harness', 'config');
  await mkdir(configDir, { recursive: true });
  await writeFile(layoutSidecarPath(ctx), `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
  ok(res, {
    service: 'harness',
    method: 'PUT',
    path: '/v1/catalog/layout',
    flowCount: Object.keys(body).length,
    ts: new Date().toISOString(),
  });
}

async function handlePutCatalog(res: ServerResponse, body: unknown, ctx: ServerCtx): Promise<void> {
  const warnings: UnsupportedFeature[] = [];
  try {
    validateUnifiedCatalog(body, 'PUT /v1/catalog', { onUnsupported: (f) => warnings.push(f) });
  } catch (err) {
    badRequest(res, (err as Error).message);
    return;
  }
  const catalog = body as Catalog;
  const configDir = join(ctx.workspaceRoot, '.harness', 'config');
  await mkdir(configDir, { recursive: true });
  await writeFile(join(configDir, 'flows.json'), `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
  ctx.catalog = catalog;
  // Re-arm schedules against the new catalog (stale flows disarm).
  for (const t of ctx.cronTimers.values()) clearTimeout(t);
  ctx.cronTimers.clear();
  armScheduleTriggers(ctx);
  ok(res, {
    service: 'harness',
    method: 'PUT',
    path: '/v1/catalog',
    flowCount: catalog.flows.length,
    warnings,
    ts: new Date().toISOString(),
  });
}

/**
 * Message ingress — the message-trigger transport. Validates
 * `{ channel, text, from? }`, starts every flow whose message trigger
 * subscribes to the channel with `input = text` (the conversational
 * prompt — deliberately NOT a JSON envelope; message triggers exist
 * for intake flows that feed the text straight to an agent).
 */
function handleIngestMessage(res: ServerResponse, body: unknown, ctx: ServerCtx): void {
  const msg = body as { channel?: unknown; text?: unknown; from?: unknown } | null;
  if (!msg || typeof msg.channel !== 'string' || !msg.channel) {
    badRequest(res, "message ingest requires a non-empty string 'channel'");
    return;
  }
  if (typeof msg.text !== 'string' || !msg.text) {
    badRequest(res, "message ingest requires a non-empty string 'text'");
    return;
  }
  const started: string[] = [];
  for (const flow of ctx.catalog.flows) {
    const cfg = triggerConfigOf(flow);
    if (!cfg || cfg.kind !== 'message' || cfg.channel !== msg.channel) continue;
    const spawnResult = spawnFlowJob(ctx, flow, {
      input: msg.text,
      triggeredBy: `message:${msg.channel}`,
    });
    if ('jobId' in spawnResult) {
      started.push(spawnResult.jobId);
    } else {
      console.warn(
        `[harness] message trigger for flow "${flow.id}" could not fire: ${spawnResult.error}`,
      );
    }
  }
  ok(res, {
    service: 'harness',
    method: 'POST',
    path: '/v1/messages',
    started,
    ts: new Date().toISOString(),
  });
}

/** The trigger node's config, or null for flows without one (legacy). */
function triggerConfigOf(flow: FlowDef): TriggerConfig | null {
  const node = flow.nodes.find((n) => n.kind === 'trigger');
  return node ? (node.config as TriggerConfig) : null;
}

/**
 * Webhook ingress (3.1). Fires every flow whose webhook trigger matches
 * the path + method (default POST); the job input is a JSON envelope
 * `{ trigger: 'webhook', path, method, payload }` — POST payload is the
 * request body, GET payload is the query parameters.
 */
function handleWebhook(
  req: IncomingMessage,
  res: ServerResponse,
  url: string,
  hookPath: string,
  parsed: unknown,
  ctx: ServerCtx,
): void {
  const method = req.method === 'GET' ? 'GET' : 'POST';
  const flows = ctx.catalog.flows.filter((flow) => {
    const cfg = triggerConfigOf(flow);
    return cfg?.kind === 'webhook' && cfg.path === hookPath && (cfg.method ?? 'POST') === method;
  });
  if (flows.length === 0) {
    notFound(res, `no flow declares a ${method} webhook trigger for path "${hookPath}"`);
    return;
  }
  const payload =
    method === 'GET'
      ? Object.fromEntries(new URL(url, 'http://localhost').searchParams)
      : (parsed ?? {});
  const started: string[] = [];
  const errors: string[] = [];
  for (const flow of flows) {
    const spawnResult = spawnFlowJob(ctx, flow, {
      input: JSON.stringify({ trigger: 'webhook', path: hookPath, method, payload }),
      triggeredBy: `webhook:${hookPath}`,
    });
    if ('jobId' in spawnResult) started.push(spawnResult.jobId);
    else errors.push(`flow "${flow.id}": ${spawnResult.error}`);
  }
  ok(res, {
    service: 'harness',
    method,
    path: `/v1/hooks/${hookPath}`,
    started,
    ...(errors.length > 0 ? { errors } : {}),
    ts: new Date().toISOString(),
  });
}

/** GET /v1/triggers — operator inventory of the armed ingress surface. */
function handleListTriggers(res: ServerResponse, ctx: ServerCtx): void {
  const schedules: Array<{ flowId: string; cron: string; nextFireAt: string | null }> = [];
  const webhooks: Array<{ flowId: string; path: string; method: string }> = [];
  const events: Array<{ flowId: string; eventType: string }> = [];
  const messages: Array<{ flowId: string; channel: string }> = [];
  for (const flow of ctx.catalog.flows) {
    const cfg = triggerConfigOf(flow);
    if (!cfg) continue;
    if (cfg.kind === 'schedule') {
      let nextFireAt: string | null = null;
      try {
        nextFireAt = nextCronFire(cfg.cron, new Date()).toISOString();
      } catch {
        // unsatisfiable schedule — validator-permitted but never fires
      }
      schedules.push({ flowId: flow.id, cron: cfg.cron, nextFireAt });
    } else if (cfg.kind === 'webhook') {
      webhooks.push({ flowId: flow.id, path: cfg.path, method: cfg.method ?? 'POST' });
    } else if (cfg.kind === 'event') {
      events.push({ flowId: flow.id, eventType: cfg.eventType });
    } else if (cfg.kind === 'message') {
      messages.push({ flowId: flow.id, channel: cfg.channel });
    }
  }
  ok(res, {
    service: 'harness',
    method: 'GET',
    path: '/v1/triggers',
    schedules,
    webhooks,
    events,
    messages,
    ts: new Date().toISOString(),
  });
}

/**
 * Arm cron timers for every schedule-triggered flow (3.1). Schedules
 * run in server-local time (the validator rejects tz). Fires spawn
 * through the shared dispatcher path; each fire re-arms for the next
 * occurrence. Gaps beyond 24h re-check daily (setTimeout's 32-bit cap).
 */
function armScheduleTriggers(ctx: ServerCtx): void {
  for (const flow of ctx.catalog.flows) {
    const cfg = triggerConfigOf(flow);
    if (cfg?.kind === 'schedule') armCronTimer(ctx, flow, cfg.cron);
  }
}

const CRON_TIMER_CHUNK_MS = 24 * 60 * 60 * 1000;

function armCronTimer(ctx: ServerCtx, flow: FlowDef, cron: string): void {
  let next: Date;
  try {
    next = nextCronFire(cron, new Date());
  } catch (err) {
    console.warn(`[harness] schedule for flow "${flow.id}" never fires: ${(err as Error).message}`);
    return;
  }
  const delay = next.getTime() - Date.now();
  const timer =
    delay > CRON_TIMER_CHUNK_MS
      ? setTimeout(() => {
          ctx.cronTimers.delete(flow.id);
          armCronTimer(ctx, flow, cron);
        }, CRON_TIMER_CHUNK_MS)
      : setTimeout(
          () => {
            ctx.cronTimers.delete(flow.id);
            const spawnResult = spawnFlowJob(ctx, flow, {
              input: JSON.stringify({
                trigger: 'schedule',
                cron,
                firedAt: new Date().toISOString(),
              }),
              triggeredBy: `schedule:${cron}`,
            });
            if ('error' in spawnResult) {
              console.warn(
                `[harness] schedule for flow "${flow.id}" could not fire: ${spawnResult.error}`,
              );
            }
            armCronTimer(ctx, flow, cron);
          },
          Math.max(0, delay),
        );
  timer.unref?.();
  ctx.cronTimers.set(flow.id, timer);
}

/**
 * Persist a paused job (2.2) — fire-and-forget: a failed write logs but
 * never fails the pause itself. The record carries the full JobRecord
 * (including the FlowDef) so a restarted server can rehydrate the job
 * and recompile its graph on the first resume.
 */
function persistPause(
  ctx: ServerCtx,
  jobId: string,
  kind: 'approval' | 'suspend',
  request: ApprovalRequest | SuspendRequest,
): void {
  const job = ctx.jobs.get(jobId);
  if (!job) return;
  void savePausedJob(ctx.stateDir, {
    job,
    kind,
    request,
    pausedAt: new Date().toISOString(),
  }).catch((err) => {
    console.warn(`[harness] failed to persist paused job ${jobId}: ${(err as Error).message}`);
  });
}

/**
 * Push operator steering into a job's live state via the LangGraph
 * checkpointer. Body: { text: string }. Validates body shape +
 * job existence; surfaces the new steering immediately on the
 * GET /v1/jobs/:id/steering endpoint and prepends to the agent's
 * systemPrompt at next adapter invocation (passive path).
 */
async function handleSteerJob(
  res: ServerResponse,
  jobId: string,
  body: Record<string, unknown>,
  ctx: ServerCtx,
): Promise<void> {
  if (!ctx.jobs.has(jobId)) {
    notFound(res, `job not found: ${jobId}`);
    return;
  }
  const text = body.text;
  if (typeof text !== 'string' || text.length === 0) {
    badRequest(res, 'body.text is required and must be a non-empty string');
    return;
  }
  const broker = ctx.broker;
  if (!broker) {
    badRequest(res, 'cannot steer — no credential broker configured');
    return;
  }
  try {
    await steerJob(jobId, text, {
      jobs: ctx.jobs,
      bus: ctx.bus,
      broker,
      adapterFactory: ctx.adapterFactory,
      resolver: ctx.resolver,
      graphs: ctx.graphs,
    });
  } catch (err) {
    badRequest(res, (err as Error).message);
    return;
  }
  ok(res, {
    service: 'harness',
    method: 'POST',
    path: `/v1/jobs/${jobId}/steering`,
    jobId,
    accepted: text,
    ts: new Date().toISOString(),
  });
}

/**
 * Mark a job for cooperative cancellation. The agent executor honors
 * the flag at the next node-tick boundary. Body: { reason?: string }.
 * Returns 200 immediately; the actual status transition to 'cancelled'
 * lands asynchronously when the agent reaches its next boundary.
 */
async function handleCancelJob(
  res: ServerResponse,
  jobId: string,
  body: Record<string, unknown>,
  ctx: ServerCtx,
): Promise<void> {
  if (!ctx.jobs.has(jobId)) {
    notFound(res, `job not found: ${jobId}`);
    return;
  }
  const reason = typeof body.reason === 'string' ? body.reason : undefined;
  const broker = ctx.broker;
  if (!broker) {
    badRequest(res, 'cannot cancel — no credential broker configured');
    return;
  }
  try {
    await cancelJob(jobId, reason, {
      jobs: ctx.jobs,
      bus: ctx.bus,
      broker,
      adapterFactory: ctx.adapterFactory,
      resolver: ctx.resolver,
      graphs: ctx.graphs,
    });
  } catch (err) {
    badRequest(res, (err as Error).message);
    return;
  }
  ok(res, {
    service: 'harness',
    method: 'POST',
    path: `/v1/jobs/${jobId}/cancel`,
    jobId,
    reason: reason ?? null,
    ts: new Date().toISOString(),
  });
}

/**
 * Read current steering for a job. Returns the array verbatim — empty
 * when no steering has been pushed. Used by the active-pull skill
 * (`harness steering check`) and by operator dashboards.
 */
async function handleGetSteering(
  res: ServerResponse,
  jobId: string,
  ctx: ServerCtx,
): Promise<void> {
  const broker = ctx.broker;
  if (!broker) {
    ok(res, {
      service: 'harness',
      jobId,
      steering: [],
      ts: new Date().toISOString(),
    });
    return;
  }
  const steering = await getJobSteering(jobId, {
    jobs: ctx.jobs,
    bus: ctx.bus,
    broker,
    adapterFactory: ctx.adapterFactory,
    resolver: ctx.resolver,
    graphs: ctx.graphs,
  });
  ok(res, {
    service: 'harness',
    jobId,
    steering,
    ts: new Date().toISOString(),
  });
}

/**
 * GET /v1/jobs/:id/files — list all files in the job's product repos
 * with a change-status overlay. Used by HITL UIs to render a file
 * tree where reviewers see at a glance which files were touched.
 *
 * Returns empty repos array (200, not 404) when the job has no
 * productRepos or no workdirRoot — caller can treat that as "nothing
 * to browse" without needing to distinguish error cases.
 */
async function handleFilesList(res: ServerResponse, job: JobRecord): Promise<void> {
  const workdirRoot = job.workdirRoot;
  const repos = Array.isArray(job.productRepos) ? job.productRepos : [];
  if (!workdirRoot || repos.length === 0) {
    ok(res, {
      service: 'harness',
      jobId: job.jobId,
      repos: [],
      totalFiles: 0,
      changedFiles: 0,
      ts: new Date().toISOString(),
    });
    return;
  }
  const listing = await listAllFiles(workdirRoot, repos);
  ok(res, {
    service: 'harness',
    jobId: job.jobId,
    ...listing,
    ts: new Date().toISOString(),
  });
}

/**
 * Handle GET /v1/jobs/:id/files/:repo/<path>/(content|diff). Validates
 * repo membership + path-traversal, then dispatches to the
 * file-routes module.
 *
 * Errors:
 *   - 403 when :repo is not in job.productRepos
 *   - 400 when <path> escapes the repo (../ traversal)
 *   - 404 when the file doesn't exist (content) — diff returns 204 if
 *     the path has no changes, 404 if the path doesn't exist anywhere
 *   - 413 when the file exceeds MAX_FILE_BYTES (content only)
 */
async function handleFileEndpoint(
  res: ServerResponse,
  job: JobRecord,
  repo: string,
  filePath: string,
  kind: 'content' | 'diff',
): Promise<void> {
  const workdirRoot = job.workdirRoot;
  if (!workdirRoot) {
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'job has no workdirRoot — file browse unavailable' }));
    return;
  }
  const repos = Array.isArray(job.productRepos) ? job.productRepos : [];
  if (!repos.includes(repo)) {
    res.statusCode = 403;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        error: `repo "${repo}" not in job.productRepos`,
        productRepos: repos,
      }),
    );
    return;
  }
  const absolute = safeResolveInRepo(workdirRoot, repo, filePath);
  if (absolute === null) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'path traversal rejected' }));
    return;
  }

  if (kind === 'diff') {
    const diff = await fileDiff(workdirRoot, repo, filePath);
    if (diff === null) {
      // No changes for this path → 204 No Content. Distinguish from
      // file-not-found by checking HEAD presence.
      const head = await fileAtHead(workdirRoot, repo, filePath);
      if (head === null) {
        // Not in HEAD AND no diff → file doesn't exist anywhere.
        res.statusCode = 404;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'file not found' }));
        return;
      }
      res.statusCode = 204;
      res.end();
      return;
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/x-diff; charset=utf-8');
    res.end(diff);
    return;
  }

  // kind === 'content'
  await streamFileContent(res, absolute, mimeFromPath(filePath));
}

async function handleSubmitLoaderProductJobs(
  res: ServerResponse,
  body: Record<string, unknown>,
  productId: string,
  ctx: ServerCtx,
): Promise<void> {
  const product = findProduct(ctx.catalog, productId);
  if (!product) {
    const known = (ctx.catalog.products ?? []).map((p) => p.id);
    badRequest(res, `unknown product '${productId}'. Known: ${known.join(', ') || '(none)'}`);
    return;
  }
  if (!product.contextSources || product.contextSources.length === 0) {
    badRequest(res, `product '${productId}' has no contextSources declared in the catalog`);
    return;
  }
  // Workspace-default fallbacks come from the request body. Per-source
  // overrides in the catalog (embedderUrl/embedderModel/backend) win.
  const defaultBackend = typeof body.backend === 'string' ? body.backend : undefined;
  const defaultEmbedderUrl = typeof body.embedderUrl === 'string' ? body.embedderUrl : undefined;
  const workspaceRoot = typeof body.workspaceRoot === 'string' ? body.workspaceRoot : null;
  if (!workspaceRoot) {
    badRequest(res, 'workspaceRoot is required for productId-form intent');
    return;
  }

  const submittedAt = new Date().toISOString();
  const spawnedJobIds: string[] = [];
  type QueuedSpec = Parameters<typeof handleSubmitLoaderSingleResolved>[0];
  const queue: QueuedSpec[] = [];
  for (const src of product.contextSources) {
    const backend = src.backend ?? defaultBackend;
    const embedderUrl = src.embedderUrl ?? defaultEmbedderUrl;
    if (!backend || !embedderUrl) {
      // Per-source missing required defaults — skip with a warning event
      // so the rest of the product still loads. We could fail-fast instead,
      // but partial load + reported errors gives the operator more signal
      // than an "all-or-nothing" failure.
      ctx.bus.publish(`product:${productId}`, 'loader', {
        kind: 'error',
        ts: new Date().toISOString(),
        message: `skipped ${src.type}/${src.target}: missing backend or embedder-url`,
      });
      continue;
    }
    // Each source becomes its own job. Short jobIds keep UDS paths under
    // the 104-byte sun_path limit.
    const jobId = `l-${randomUUID().slice(0, 8)}`;
    spawnedJobIds.push(jobId);
    queue.push({
      jobId,
      productId,
      target: resolveProductTarget(src.target, workspaceRoot),
      type: src.type,
      backend,
      backendUser: typeof body.backendUser === 'string' ? body.backendUser : undefined,
      backendPassword: typeof body.backendPassword === 'string' ? body.backendPassword : undefined,
      embedderUrl,
      embedderModel: src.embedderModel,
      embedderDim: src.embedderDim,
      workspaceRoot,
    });
  }

  // Pre-register all queued jobs as 'pending' so GET /v1/jobs reflects
  // the full set immediately. The actual loader spawns are serialized
  // below — concurrent embedder calls are the single most reliable way
  // to crash Docker Model Runner's llama.cpp slot scheduler, so we run
  // loaders one at a time within a product's fan-out.
  for (const spec of queue) {
    ctx.jobs.set(spec.jobId, {
      jobId: spec.jobId,
      name: `load: ${spec.type} (${spec.productId ?? '?'})`,
      productId: spec.productId,
      status: 'received',
      submittedAt,
      agents: [
        {
          id: 'loader',
          role: 'Loader',
          adapter: 'loader-spawn' as AdapterId,
          status: 'pending',
        },
      ],
    } as JobRecord);
  }

  ok(res, {
    service: 'harness',
    method: 'POST',
    path: '/v1/loader-jobs',
    productId,
    spawnedJobIds,
    count: spawnedJobIds.length,
    ts: submittedAt,
  });

  // Run the queue sequentially in the background. Errors surface as
  // per-job status transitions; the response above already told the
  // client which jobIds will run.
  void (async () => {
    for (const spec of queue) {
      try {
        await handleSubmitLoaderSingleResolved(spec, ctx);
      } catch {
        // handleSubmitLoaderSingleResolved already publishes an error
        // event + flips the job status; nothing more to do here.
      }
    }
  })();
}

/** OSS package targets like "react@18.2.0" stay as-is; URLs likewise.
 *  Bare paths get resolved against the workspace root so relative
 *  YAML entries like `./packages/foo` work consistently. */
function resolveProductTarget(target: string, workspaceRoot: string): string {
  if (target.startsWith('/') || target.includes('://')) return target;
  // Treat package@version specifiers as opaque
  if (/^[A-Za-z@][A-Za-z0-9_./@-]*@[A-Za-z0-9._-]+$/.test(target)) return target;
  // Relative path
  return `${workspaceRoot}/${target.replace(/^\.\//, '')}`;
}

interface ResolvedSingleSpec {
  jobId: string;
  productId?: string;
  target: string;
  type: string;
  backend: string;
  backendUser?: string;
  backendPassword?: string;
  embedderUrl: string;
  embedderModel?: string;
  embedderDim?: number;
  workspaceRoot: string;
}

/** Spawns one loader for a fully-resolved spec (used by both the direct
 *  single-source POST and the product fan-out path). */
async function handleSubmitLoaderSingleResolved(
  spec: ResolvedSingleSpec,
  ctx: ServerCtx,
): Promise<void> {
  const submittedAt = new Date().toISOString();
  const loaderAgent: RegisteredAgent = {
    id: 'loader',
    role: 'Loader',
    adapter: 'loader-spawn' as AdapterId,
    status: 'running',
  };
  const job: JobRecord = {
    jobId: spec.jobId,
    name: spec.productId ? `load: ${spec.type} (${spec.productId})` : `load: ${spec.type}`,
    productId: spec.productId,
    status: 'running',
    submittedAt,
    agents: [loaderAgent],
  } as JobRecord;
  ctx.jobs.set(spec.jobId, job);

  const counts = {
    files: 0,
    chunks: 0,
    nodes: 0,
    edges: 0,
    vectors: 0,
    errors: 0,
  };

  let handle: Awaited<ReturnType<typeof spawnLoaderJob>>;
  try {
    handle = await spawnLoaderJob({
      jobId: spec.jobId,
      target: spec.target,
      type: spec.type,
      backend: spec.backend,
      backendUser: spec.backendUser,
      backendPassword: spec.backendPassword,
      embedderUrl: spec.embedderUrl,
      embedderModel: spec.embedderModel,
      embedderDim: spec.embedderDim,
      workspaceRoot: spec.workspaceRoot,
      tmuxPane: process.env.TMUX
        ? { session: process.env.AGENTX_TMUX_SESSION ?? 'agentx', window: 'loaders' }
        : undefined,
    });
  } catch (err) {
    job.status = 'failed';
    loaderAgent.status = 'failed';
    ctx.bus.publish(spec.jobId, 'loader', {
      kind: 'error',
      ts: new Date().toISOString(),
      message: `loader failed to start: ${(err as Error).message}`,
    });
    return;
  }

  handle.subscribe((event: LoaderEvent) => {
    switch (event.kind) {
      case 'item-walked':
        counts.files++;
        break;
      case 'chunk-produced':
        counts.chunks += Number(event.chunkCount ?? 0);
        break;
      case 'node-written':
        counts.nodes++;
        break;
      case 'edge-written':
        counts.edges++;
        break;
      case 'chunk-embedded':
        counts.vectors++;
        break;
      case 'error':
        counts.errors++;
        break;
    }
    const lastItem = typeof event.itemId === 'string' ? event.itemId : undefined;
    ctx.bus.publish(spec.jobId, 'loader', {
      kind: 'loader-event',
      ts: new Date().toISOString(),
      counts: { ...counts },
      lastItem,
      innerKind: event.kind,
    });
  });

  try {
    await handle.whenComplete;
    job.status = 'completed';
    loaderAgent.status = 'completed';
  } catch (err) {
    job.status = 'failed';
    loaderAgent.status = 'failed';
    ctx.bus.publish(spec.jobId, 'loader', {
      kind: 'error',
      ts: new Date().toISOString(),
      message: `loader job ended: ${(err as Error).message}`,
    });
  }
}

async function handleSubmitLoaderJob(
  res: ServerResponse,
  body: Record<string, unknown>,
  ctx: ServerCtx,
): Promise<void> {
  // Two acceptance shapes:
  //   1. {productId, ...defaults} — server resolves from catalog and
  //      fans out one worker per declared contextSource. Client doesn't
  //      need to know what sources exist.
  //   2. {jobId, target, type, backend, embedderUrl, workspaceRoot} —
  //      ad-hoc single-source intent (matches what harness-cli's
  //      single-target form sends today).
  const productId = typeof body.productId === 'string' ? body.productId : null;
  if (productId) {
    return handleSubmitLoaderProductJobs(res, body, productId, ctx);
  }

  const jobId = typeof body.jobId === 'string' ? body.jobId : null;
  const target = typeof body.target === 'string' ? body.target : null;
  const type = typeof body.type === 'string' ? body.type : null;
  const backend = typeof body.backend === 'string' ? body.backend : null;
  const embedderUrl = typeof body.embedderUrl === 'string' ? body.embedderUrl : null;
  const workspaceRoot = typeof body.workspaceRoot === 'string' ? body.workspaceRoot : null;

  if (!jobId || !target || !type || !backend || !embedderUrl || !workspaceRoot) {
    badRequest(
      res,
      'either {productId, ...} or {jobId, target, type, backend, embedderUrl, workspaceRoot} required',
    );
    return;
  }

  // Register the loader as a single-agent job up-front so GET /v1/jobs
  // sees it immediately. The synthetic 'loader' agent is the bridge from
  // the loader's IngestionEvent stream onto the JobBus — there's no real
  // agent process behind it, just our event adapter.
  const submittedAt = new Date().toISOString();
  const loaderAgent: RegisteredAgent = {
    id: 'loader',
    role: 'Loader',
    adapter: 'loader-spawn' as AdapterId,
    status: 'running',
  };
  const job: JobRecord = {
    jobId,
    name: typeof body.name === 'string' ? body.name : `load: ${type}`,
    productId: typeof body.productId === 'string' ? body.productId : undefined,
    status: 'running',
    submittedAt,
    agents: [loaderAgent],
  } as JobRecord;
  ctx.jobs.set(jobId, job);

  // Respond to the client immediately — they asked to start a job, not to
  // block until it finishes. The client polls /v1/jobs/:id or subscribes
  // to /v1/jobs/:id/events for progress.
  ok(res, {
    service: 'harness',
    method: 'POST',
    path: '/v1/loader-jobs',
    body,
    job,
    ts: submittedAt,
  });

  // Counters tracked across all incoming LoaderEvents — published onto
  // the JobBus on every event so the TUI's SSE consumer sees a smooth
  // running total instead of having to replay+aggregate the raw stream.
  const counts = {
    files: 0,
    chunks: 0,
    nodes: 0,
    edges: 0,
    vectors: 0,
    errors: 0,
  };

  let handle: Awaited<ReturnType<typeof spawnLoaderJob>>;
  try {
    handle = await spawnLoaderJob({
      jobId,
      target,
      type,
      backend,
      backendUser: typeof body.backendUser === 'string' ? body.backendUser : undefined,
      backendPassword: typeof body.backendPassword === 'string' ? body.backendPassword : undefined,
      embedderUrl,
      embedderModel: typeof body.embedderModel === 'string' ? body.embedderModel : undefined,
      embedderDim: typeof body.embedderDim === 'number' ? body.embedderDim : undefined,
      workspaceRoot,
      // Auto-tmux: if the harness-server itself was started inside a
      // tmux session, spawn each loader in its own pane in the
      // `loaders` window. The harness-cli that submitted this intent
      // also sets this option when called from tmux; this is the
      // belt-and-suspenders path for when the *server* runs in tmux
      // but the submit comes from a different process (cron, web UI).
      tmuxPane:
        typeof body.tmuxPane === 'object' && body.tmuxPane !== null
          ? (body.tmuxPane as { session: string; window: string })
          : process.env.TMUX
            ? { session: process.env.AGENTX_TMUX_SESSION ?? 'agentx', window: 'loaders' }
            : undefined,
    });
  } catch (err) {
    job.status = 'failed';
    loaderAgent.status = 'failed';
    ctx.bus.publish(jobId, 'loader', {
      kind: 'error',
      ts: new Date().toISOString(),
      message: `loader failed to start: ${(err as Error).message}`,
    });
    return;
  }

  handle.subscribe((event: LoaderEvent) => {
    switch (event.kind) {
      case 'item-walked':
        counts.files++;
        break;
      case 'chunk-produced':
        counts.chunks += Number(event.chunkCount ?? 0);
        break;
      case 'node-written':
        counts.nodes++;
        break;
      case 'edge-written':
        counts.edges++;
        break;
      case 'chunk-embedded':
        counts.vectors++;
        break;
      case 'error':
        counts.errors++;
        break;
    }
    const lastItem = typeof event.itemId === 'string' ? event.itemId : undefined;
    ctx.bus.publish(jobId, 'loader', {
      kind: 'loader-event',
      ts: new Date().toISOString(),
      counts: { ...counts },
      lastItem,
      innerKind: event.kind,
    });
  });

  try {
    await handle.whenComplete;
    job.status = 'completed';
    loaderAgent.status = 'completed';
  } catch (err) {
    job.status = 'failed';
    loaderAgent.status = 'failed';
    ctx.bus.publish(jobId, 'loader', {
      kind: 'error',
      ts: new Date().toISOString(),
      message: `loader job ended: ${(err as Error).message}`,
    });
  }
}

/**
 * Parse the optional `body.repos` field from a job-submission JSON
 * body into an array of `SpawnRepoSpec`. Returns null when the field
 * is missing/not-an-array, an empty array when it's present but
 * empty, and a validated SpawnRepoSpec[] otherwise.
 *
 * Used by the slice 9d-4 container path. The submission body has
 * priority over catalog-derived repo lookups (which don't exist
 * yet — ProductDef in the catalog doesn't carry git repos as of
 * slice 9d-4; that's a future workspace-yaml refactor).
 */
function parseRepos(value: unknown): SpawnRepoSpec[] | null {
  if (!Array.isArray(value)) return null;
  const out: SpawnRepoSpec[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') return null;
    const r = entry as Record<string, unknown>;
    if (typeof r.name !== 'string' || !r.name) return null;
    if (typeof r.cloneUrl !== 'string' || !r.cloneUrl) return null;
    out.push({
      name: r.name,
      cloneUrl: r.cloneUrl,
      ...(typeof r.baseRef === 'string' && r.baseRef ? { baseRef: r.baseRef } : {}),
      ...(typeof r.path === 'string' && r.path ? { path: r.path } : {}),
    });
  }
  return out;
}

/**
 * Pre-flight check: would this submission route through the container
 * runJob path? Used by the dispatcher gate to decide whether the
 * in-process capacity policy applies. Mirrors the resolution logic
 * inside handleSubmitJob (request-body repos take priority; falls back
 * to catalog product repos) without committing to the actual
 * runJobInContainer arguments.
 */
function hasContainerRepos(body: Record<string, unknown>, job: JobRecord, ctx: ServerCtx): boolean {
  const submissionRepos = parseRepos(body.repos);
  if (submissionRepos !== null && submissionRepos.length > 0) return true;
  if (job.productId) {
    const product = findProduct(ctx.catalog, job.productId);
    if (product?.repos && product.repos.length > 0) return true;
  }
  return false;
}

function registeredFromDef(def: AgentDef, setName: string): RegisteredAgent {
  return {
    id: def.id,
    role: def.role,
    adapter: def.adapter,
    systemPrompt: def.systemPrompt,
    status: 'pending',
    config: def.config,
    accepts: resolveAccepts(def, setName),
    fallbackOn: def.fallbackOn,
  };
}

/**
 * SSE-over-UDS stream for a job's events. The TUI / web UI / external system
 * keeps this connection open; every Envelope published onto the bus for `jobId`
 * arrives here as `data: <json>\n\n`.
 *
 * TODO(you): heartbeat policy. Right now there is no keepalive — long idle
 * periods may cause the client (or an intermediate proxy in a future TCP
 * deployment) to close the connection. Decisions:
 *
 *   1. Interval: 5s (snappy but chatty), 15s (typical SSE default), 30s+
 *      (lower CPU, higher risk of intermediate timeouts).
 *   2. Frame: SSE comment line `: heartbeat\n\n` (invisible to clients) vs
 *      a real `event: heartbeat` frame (visible, lets clients log liveness).
 *   3. Stale-write detection: if `res.write(...)` returns false repeatedly,
 *      the client is gone but Node hasn't fired `close` yet — disconnect
 *      after N consecutive backpressured writes? After a write timeout?
 *
 * Constraint: the heartbeat must not block the event loop and must be cleared
 * on `req.close` / `res.close`. ~5–10 lines including the interval setup.
 */
function streamJobEvents(
  req: IncomingMessage,
  res: ServerResponse,
  jobId: string,
  bus: JobBus,
): void {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
  res.write(': connected\n\n');

  const unsubscribe = bus.subscribe(jobId, (envelope: Envelope) => {
    res.write(`data: ${JSON.stringify(envelope)}\n\n`);
  });

  const cleanup = () => {
    unsubscribe();
    res.end();
  };
  req.on('close', cleanup);
  req.on('aborted', cleanup);
}

function ok(res: ServerResponse, payload: Record<string, unknown>): void {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ ok: true, ...payload }));
}

function notFound(res: ServerResponse, error: string): void {
  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ ok: false, error }));
}

function forbidden(res: ServerResponse, error: string): void {
  res.statusCode = 403;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ error }));
}

function conflict(res: ServerResponse, error: string): void {
  res.writeHead(409, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ ok: false, error }));
}

function badRequest(res: ServerResponse, error: string): void {
  res.writeHead(400, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ ok: false, error }));
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

/**
 * Best-effort cleanup of a job's unconfirmed memory entries.
 *
 * Closes the F19 lifecycle loop: when a job ends, any memory entries
 * the agents wrote with the default {@code feedback: 'unconfirmed'}
 * label that never got tagged (positive/negative) via the consolidation
 * pipeline are scope-deleted here so they don't accumulate forever.
 *
 * Why best-effort: the controlplane's job-completion path is the
 * source of truth; a memory cleanup failure is a hygiene issue, not
 * a correctness issue. If this fails (memory server down, UDS path
 * stale, slow disk), the job still completes cleanly. Operators get
 * the alternative `edge-memory cleanup --scope jobId:X` CLI as the
 * manual fallback, and the next successful cleanup catches up.
 *
 * Errors are logged at warn level (not error) so they don't trigger
 * paging — this is recovery-eligible noise, not a control-plane fault.
 */
async function cleanupJobMemory(socketPath: string, jobId: string): Promise<void> {
  // Use node:http with socketPath because Bun's fetch() doesn't
  // support UDS paths — same constraint the rest of the codebase
  // works around when crossing UDS boundaries to edge-* servers.
  const http = await import('node:http');
  const body = JSON.stringify({ scope: { jobId } });

  await new Promise<void>((resolve) => {
    const req = http.request(
      {
        socketPath,
        path: '/v1/memory/cleanup-unconfirmed',
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body).toString(),
        },
      },
      (res) => {
        // Drain so the connection can be reused; we don't actually
        // need the body content (deletion count goes to logs, not
        // back through harness-server's bus).
        res.on('data', () => {});
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 400) {
            console.warn(
              `harness-server: F19 memory cleanup for job=${jobId} returned status ${res.statusCode}`,
            );
          }
          resolve();
        });
      },
    );
    req.on('error', (err) => {
      console.warn(`harness-server: F19 memory cleanup for job=${jobId} failed: ${err.message}`);
      resolve();
    });
    req.write(body);
    req.end();
  });
}
