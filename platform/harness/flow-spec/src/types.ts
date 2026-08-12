/**
 * @helmsmith/flow-spec — the flow wire contract.
 *
 * Every type in this file is part of the spec: the shape stored in
 * controlplane's catalog tables, edited by the flow designer, and
 * executed by harness-core. This package is browser-safe by contract —
 * zero runtime dependencies, no `node:*` imports. Node-side concerns
 * (loadCatalog's fs read) live in harness-core, which depends on this
 * package and re-exports it; the dependency never points the other way.
 *
 * Runtime coverage of step kinds / tags / edges / expressions: see the
 * "RUNTIME COVERAGE MATRIX" comment block at the top of harness-core's
 * `orchestrator.ts`, and the honest three-column version in
 * `docs/superpowers/specs/2026-08-07-flow-spec-design-review.md`.
 */
export type AdapterId = 'claude-sdk' | 'opencode-cli';

export interface AgentDef {
  /** Stable id for streaming/registration. Unique within a pipeline. */
  id: string;
  /** Human-readable label (TUI middle column, logs). */
  role: string;
  /** Which adapter implementation runs this agent. */
  adapter: AdapterId;
  /** Optional system prompt; if omitted, the adapter's default applies. */
  systemPrompt?: string;
  /**
   * Optional adapter-specific configuration. Passed through to the adapter
   * factory; the adapter is responsible for interpreting the shape. Use this
   * for per-agent overrides like model name, endpoint URL (for opencode-cli
   * with a self-hosted backend), reasoning effort, timeout, etc.
   */
  config?: Record<string, unknown>;
  /**
   * Priority-ordered list of `<provider>:<model>` bindings this agent will
   * accept. Per project memory `project_per_worker_model_subscription`, the
   * harness-server resolves this list against the configured AuthStore /
   * Secrets Manager + the LLMProvider registry at spawn time and binds the
   * agent to the first satisfiable entry. Mixed cloud+local pipelines are
   * the natural payoff: a summarizer can lead with `local-qwen:qwen3` while
   * a code-reviewer holds out for `anthropic:claude-haiku-4-5`.
   *
   * Two equivalent shapes (per memory `project_set_scoped_accepts`):
   *
   *   1. Flat array: `["anthropic:claude-haiku-4-5", "local-qwen:qwen3"]`
   *      — single global priority list. Treated as `{default: [...]}`.
   *
   *   2. Named sets: `{ default: [...], cheap: [...], frontier: [...],
   *      bench-claude: [...], bench-gpt: [...] }` — pick one set per-job
   *      via the `set` field on the job submission. Falls back to
   *      `default` when the active set isn't declared on this agent.
   *      Selecting per-job (not per-server) lets a single running harness
   *      serve different sets concurrently — natural for benchmarking
   *      and per-customer policy.
   *
   * Validation is structural only (each leaf entry must be a non-empty
   * `<provider>:<model>` string). Whether each entry actually exists in
   * the registry is checked at resolve time.
   *
   * Use `resolveAccepts(agent, setName)` to project to a flat list. The
   * orchestrator does this when registering agents for a job.
   */
  accepts?: readonly string[] | Readonly<Record<string, readonly string[]>>;
  /**
   * Per-agent runtime-fallback policy. Names of `AdapterError` subclasses
   * (matched against `error.name`) that should trigger fall-through to
   * the next satisfiable binding when the current binding throws.
   *
   * Unset → uses the default recoverable set (BillingError,
   * RateLimitError, NetworkError, ProviderError). AuthError + ConfigError
   * are excluded by default because they signal structural problems
   * (revoked key, missing model) — silent retry across providers is
   * usually the wrong action; surface to the operator instead.
   *
   * Set to `[]` to disable fallback entirely for this agent (any error
   * is terminal, even if other accept-list entries are satisfiable).
   *
   * Per slice 13c per-agent customization: catalog authors who want
   * "never silently switch providers when an auth error occurs"
   * default behavior get it for free; pipelines that explicitly want
   * cross-provider auth retry opt in via `fallbackOn: [...,
   * 'AuthError']`.
   */
  fallbackOn?: readonly string[];
  /**
   * Skills this agent depends on. References items from the
   * `@helmsmith/skillzkit` catalog — the procurement flow (workspace-cli)
   * resolves each entry to markdown files + transitive dependencies and
   * copies them into `<workspace>/.claude/{commands,skills}/` so the
   * agent can invoke them at runtime.
   *
   * skillzkit's catalog has two top-level types: SKILLs (router agents
   * that classify natural-language requests + dispatch to commands) and
   * Commands (everything else — slash commands, workflows, tools,
   * integrations, atomic tasks). The categories below mirror that split
   * plus skillzkit's sub-classification under `.claude/commands/`:
   *
   *   - `routers`      — SKILL names (router agents). Lookup by name
   *                       (e.g. `skillzkit-product-router`)
   *   - `tools`        — local CLIs / utilities (e.g. `core:tools:npm`,
   *                       `core:tools:gh`, `core:tools:jq`)
   *   - `integrations` — remote services the agent connects to (e.g.
   *                       `core:integrations:figma`, `core:integrations:linear`)
   *   - `tasks`        — atomic action commands (smaller unit than workflow)
   *   - `workflows`    — multi-step procedures from skillzkit's Workflow
   *                       catalog (e.g. `engineer:feature-build`,
   *                       `product:greenfield`)
   *
   * Validation here is structural only — string non-emptiness + a closed
   * key set. Whether each slug or skill name actually exists in the
   * installed skillzkit catalog is checked at procure time by the
   * workspace-cli, not at catalog parse time (so a catalog can reference
   * skills that aren't yet installed).
   *
   * Skipping this field is fine — agents without skill dependencies don't
   * need any `.claude/` content beyond what the workspace-template ships.
   */
  skillz?: {
    routers?: readonly string[];
    tools?: readonly string[];
    integrations?: readonly string[];
    tasks?: readonly string[];
    workflows?: readonly string[];
  };
}

// ─── Flow taxonomy (v1 — graph + tags) ───────────────────────────────────
//
// One node primitive (TaskStep), polymorphic via `kind`. Edges carry all
// routing logic. Behavioral modifiers are tags (Approval, Suspend, Loop).
// Reliability concerns are policies. The graph maps 1:1 to LangGraph node
// + conditional-edge execution.
//
// Spec reference: `docs/superpowers/specs/2026-08-07-flow-spec-design-review.md`.
//
// What's NOT in v1:
//   - No `if`, `loop`, `try`, `fork`, `map` step kinds. All replaced by
//     edges (conditional, parallel split/join, error, fallback, reject)
//     and tags (Loop iterates a single node over a collection).
//   - No `fail` / `succeed` step kinds. Terminal nodes are nodes with
//     no outgoing edges; their `terminal` field defaults to 'success'.

/**
 * The single canvas primitive — every node on the flow graph is a TaskStep.
 * Polymorphic via the `kind` discriminator; per-kind config goes in `config`,
 * tags add behavioral modifiers, policy controls reliability, joinStrategy
 * defines how multiple incoming edges combine.
 */
export interface TaskStep {
  /** Stable id; referenced by edges. Unique within a flow. */
  id: string;
  /** Polymorphic discriminator. */
  kind: 'agent' | 'tool' | 'script' | 'transform' | 'gate' | 'subflow' | 'trigger' | 'publish';
  /** Per-kind config (typed by which kind is set). */
  config:
    | AgentConfig
    | ToolConfig
    | ScriptConfig
    | TransformConfig
    | GateConfig
    | SubflowConfig
    | TriggerConfig
    | PublishConfig;
  /**
   * Input mapping — how this node composes its effective input from
   * run state, instead of implicitly consuming the previous node's
   * `output` string. Two forms:
   *
   *   - A single Expression: resolves to the effective input. Strings
   *     pass through raw; other values are JSON-serialized.
   *   - A Record mapping name → Expression: each field resolves against
   *     state and the whole object is JSON-serialized. This is how a
   *     node consumes MORE than one upstream value: `$.input`,
   *     `$.nodes.<id>`, `$.rejectionPayload`, …
   *
   * The single-Expression form is detected by a string `kind` field,
   * so mapping keys must not be named `kind`.
   *
   * Omitted → legacy behavior: the node reads `state.output` as-is.
   */
  input?: Expression | Readonly<Record<string, Expression>>;
  /** Per-node output contract. `json` → the runtime parses the node's
   *  output into `state.nodes[id]` (parse failure exits with errorName
   *  'OutputParseError', routable via an error edge). Omitted / `text`
   *  → `state.nodes[id]` holds the raw output string. */
  output?: NodeOutputContract;
  /** Side-effect classification. Declarative for now (reported via
   *  onUnsupported): the runtime does not yet consult it when deciding
   *  whether a node is safe to re-run on replay/retry. Publish-family
   *  nodes are inherently 'side-effecting'. */
  effect?: 'pure' | 'idempotent' | 'side-effecting';
  /** Behavioral modifier tags. Multiple allowed; render order is
   *  Loop top-left, Approval/Suspend top-right. Approval and Suspend
   *  are mutually exclusive on the same node. */
  tags?: TaskStepTags;
  /** Reliability policy. */
  policy?: TaskStepPolicy;
  /** Strategy for combining multiple incoming edges. Default 'all'. */
  joinStrategy?: 'all' | 'any' | { nOfM: number };
  /** Set on nodes with no outgoing edges. Defaults to 'success'. */
  terminal?: 'success' | 'fail';
}

/**
 * Per-node output contract (distinct from the flow-level
 * FlowOutputContract, which governs the terminal node's emission).
 * `json` makes the node's output addressable as structured data at
 * `$.nodes.<id>` — the enabling contract for gates and conditional
 * edges over agent results. `schema` is declared-but-not-enforced
 * (reported via onUnsupported as 'node-output-schema').
 */
export type NodeOutputContract = { kind: 'text' } | { kind: 'json'; schema?: unknown };

// ─── Per-kind configs ────────────────────────────────────────────────────

/** LLM-driven execution. The dominant kind. */
export interface AgentConfig {
  agent: AgentDef;
}

/** Deterministic tool/API call. References a tool by id (resolved against
 *  the tool catalog or skillzkit). The `args` map is merged with the
 *  ToolDef's own argument template at dispatch time; values may be
 *  Expressions (jsonpath/literal) for state-driven argument synthesis,
 *  same evaluator the conditional-edge router uses.
 *
 *  Example flow-side reference:
 *      { id: "lint", kind: "tool", config: {
 *          toolId: "core:tools:eslint",
 *          args: { path: { kind: "jsonpath", path: "$.output" } } } } */
export interface ToolConfig {
  toolId: string;
  args?: Record<string, unknown>;
}

// ─── ToolDef (resolver-side definition) ───────────────────────────────────
//
// `ToolConfig` (above) is the *flow-side reference* — what a step in the
// catalog says it wants to invoke. `ToolDef` is the *resolver-side
// definition* — what the harness actually calls. The link is `toolId`.
//
// Resolution flow:
//   FlowDef → TaskStep(kind:'tool') → ToolConfig.toolId
//                                        ↓
//                         RunJobDeps.toolResolver(toolId)
//                                        ↓
//                                    ToolDef
//                                        ↓
//                         dispatch by kind (cli|http|mcp)
//
// ToolDefs are sourced from skillzkit (per memory
// `project_skillzkit_is_skill_source_of_truth`); controlplane caches
// them in its catalog table; harness-server pulls the cache and exposes
// the lookup via `RunJobDeps.toolResolver`.

/**
 * Discriminated union of tool dispatch kinds. The runtime executor
 * (`packages/harness-core/src/tool-executor.ts`) reads `kind` to pick
 * the dispatch path. Each variant carries the minimum the executor
 * needs — no JS-runtime config, no per-call sugar that belongs in the
 * resolver.
 */
export type ToolDef = CliToolDef | HttpToolDef | McpToolDef;

/** Local-CLI tool. Spawned via execFile (no shell, no string-
 *  interpolated args). Stdout becomes `state.output` on success;
 *  non-zero exit → error edge unless the code is in `allowExitCodes`. */
export interface CliToolDef {
  id: string;
  kind: 'cli';
  /** Absolute path or a binary on PATH. The executor does NOT search
   *  alternate paths beyond the worker's PATH. */
  cmd: string;
  /** Argument template. Each entry is either a string literal (passed
   *  through as-is) or a name reference of the form `{{argName}}`. The
   *  named values come from the merge of ToolConfig.args + state via
   *  Expression resolution. Missing names cause a config-time failure
   *  rather than a silent empty arg. */
  args?: readonly string[];
  /** Working directory. Default: the worker's cwd. */
  cwd?: string;
  /** Environment overlay merged on top of the worker's environment. */
  env?: Readonly<Record<string, string>>;
  /** Hard timeout. Default 30s. SIGTERM on expiry, SIGKILL after 5s. */
  timeoutMs?: number;
  /** Exit codes treated as success (besides 0). Useful for tools where
   *  non-zero indicates a non-error condition (e.g., `grep` exits 1
   *  when no match). Default: `[0]`. */
  allowExitCodes?: readonly number[];
}

/** REST/JSON HTTP tool. Args are URL-templated + body-templated; auth
 *  comes from the existing CredentialBroker. Response body becomes
 *  `state.output`; non-2xx status → error edge. */
export interface HttpToolDef {
  id: string;
  kind: 'http';
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Endpoint URL. May contain `{{argName}}` placeholders that resolve
   *  against the args map. */
  endpoint: string;
  /** Request body template. Top-level keys are passed verbatim except
   *  where the value is `{ kind: 'jsonpath', path: '$....' }` — those
   *  resolve against state. Ignored on GET/DELETE. */
  bodyTemplate?: Record<string, unknown>;
  /** Static headers merged into the request. Auth headers are added
   *  separately via `auth`. */
  headers?: Readonly<Record<string, string>>;
  /** Optional auth reference. The runtime resolves this through the
   *  CredentialBroker the same way agent bindings do — a single auth
   *  surface for the whole platform. */
  auth?: ToolAuthRef;
  /** Hard timeout. Default 30s. */
  timeoutMs?: number;
}

/** MCP (Model Context Protocol) tool. The runtime spawns the MCP
 *  server (stdio transport) per call — connection pooling is v2 — and
 *  invokes `toolName` with the resolved args. Result content becomes
 *  `state.output`; MCP error → error edge. */
export interface McpToolDef {
  id: string;
  kind: 'mcp';
  /** Either a command-line for stdio MCP servers (`["npx", "-y",
   *  "@modelcontextprotocol/server-filesystem", "/path"]`) or an HTTP
   *  URL for SSE transport. The executor picks transport based on
   *  whether the value looks like a URL. */
  server: string | readonly string[];
  /** Tool name to invoke on the MCP server. */
  toolName: string;
  /** Optional auth reference (used for HTTP-transport MCP servers
   *  needing a bearer token). */
  auth?: ToolAuthRef;
  /** Hard timeout for the call. Default 60s (higher than CLI/HTTP
   *  because MCP startup includes server initialization). */
  timeoutMs?: number;
}

/** Reference to a credential the broker can fulfill. Mirrors the
 *  shape used by agent bindings — same broker, same audit trail. */
export interface ToolAuthRef {
  /** Auth scheme. `bearer` injects `Authorization: Bearer <token>`;
   *  `header` writes the token to a named header (`name`); `basic`
   *  composes user:pass. */
  scheme: 'bearer' | 'header' | 'basic';
  /** Credential id the broker resolves at dispatch time. */
  credentialId: string;
  /** Header name when scheme === 'header'. */
  name?: string;
}

/** Code execution. The script's source body is dropped to a temp file
 *  and run via the language's interpreter; state.output is piped to
 *  the script as stdin (UTF-8 string), and the script's stdout becomes
 *  the new state.output. A curated FlowRunState view (incl. `input`,
 *  excl. `nodes`/`messages`/`changedFiles` for env-size reasons) is
 *  exposed as JSON via the `HARNESS_STATE_JSON` environment variable —
 *  scripts needing a node's output should declare an `input` mapping,
 *  which arrives on stdin. Non-zero exit routes to the node's error
 *  edge. */
export interface ScriptConfig {
  language: 'bash' | 'node' | 'python';
  source: string;
  env?: Record<string, string>;
  /** Credential references resolved through the CredentialBroker at
   *  dispatch time and injected as environment variables — the same
   *  auth surface tools use, so secrets never appear literally in
   *  catalogs. Keys are env var names; resolved values win over any
   *  same-named `env` entry. */
  secrets?: Readonly<Record<string, { credentialId: string }>>;
  /** Hard timeout for the script run. Default 30s. SIGTERM on expiry,
   *  SIGKILL after a short grace period if the child ignores SIGTERM. */
  timeoutMs?: number;
}

/** Pure data shaping. Evaluates an expression against current flow state. */
export interface TransformConfig {
  expression: Expression;
}

/** Quality gate. Runs assertions; emits 'pass' (sequence edge) or 'reject'
 *  (reject edge) based on whether all assertions hold. */
export interface GateConfig {
  assertions: Assertion[];
}

export interface Assertion {
  expression: Expression;
  /** Human-readable message embedded in the rejection payload when this
   *  assertion fails. */
  message: string;
}

/** Invoke another flow as a sub-flow. The parent pauses until the
 *  sub-flow terminates; sub-flow output flows in as this node's output. */
export interface SubflowConfig {
  flowId: string;
  /** Optional version pin against the target flow's `version`.
   *  Recorded but not enforced yet — subflows resolve by flowId in the
   *  loaded catalog (reported via onUnsupported as
   *  'subflow-version-pin'). */
  version?: string;
  input?: Record<string, unknown>;
}

/** Entry point. Exactly one trigger node per flow. */
export type TriggerConfig =
  | { kind: 'webhook'; path: string; method?: 'GET' | 'POST' }
  | { kind: 'schedule'; cron: string; tz?: string }
  | { kind: 'manual' }
  | { kind: 'event'; eventType: string; matcher?: Expression }
  | { kind: 'message'; channel: string };

/**
 * Delivery of the flow's output to an external destination. The
 * `publish-*` family — `push-and-open-pr`, `merge-pr`, and (future)
 * `upload-to-s3`, `export-to-figma`, … — keeps the "how the work ships"
 * decision in the authored flow graph rather than baked into the
 * orchestrator. The runtime executor (`publish-executor.ts`) reads
 * `action` to pick the path.
 *
 * GitHub credentials for the `*-pr` actions resolve through a cascade
 * (local `gh` → controlplane-issued App token); the executor takes a
 * `GitHubCredentialResolver` from `RunJobDeps.githubResolver`.
 */
export type PublishConfig = PushAndOpenPrConfig | MergePrConfig;

/**
 * Push the per-job branch to `origin` and open a pull request. Placed
 * after an agent has staged + committed changes in the worktree.
 * Writes `{ prUrl, prNumber, branchName }` into `state.output` (as
 * JSON) and onto the JobRecord (`branchName`, `prUrl`).
 */
export interface PushAndOpenPrConfig {
  action: 'push-and-open-pr';
  /** Which product repo to push — must match a name in
   *  `JobRecord.productRepos`. Omittable when the product has exactly
   *  one repo. */
  repo?: string;
  /** PR title. Defaults to a generated title from the job name/id. */
  title?: string;
  /** PR body (Markdown). Defaults to a generated body referencing the
   *  job and its base ref. */
  body?: string;
  /** Base branch the PR targets. Default: the repo's default branch
   *  (resolved via the GitHub API). */
  base?: string;
  /** Open as a draft PR. Default false. */
  draft?: boolean;
}

/**
 * Merge a pull request opened earlier in the same flow (by a
 * `push-and-open-pr` node). Typically placed immediately after an
 * `approval`-tagged node, so it only runs on the approve edge. Writes
 * `{ mergeSha }` into `state.output` (as JSON) and onto the JobRecord
 * (`mergeSha`). The PR to merge is read from the JobRecord's `prUrl`.
 */
export interface MergePrConfig {
  action: 'merge-pr';
  /** Merge strategy. Default 'squash'. */
  method?: 'merge' | 'squash' | 'rebase';
  /** Delete the head branch after a successful merge. Default true. */
  deleteBranch?: boolean;
}

// ─── Tags (behavioral modifiers) ─────────────────────────────────────────

export interface TaskStepTags {
  approval?: ApprovalTag;
  suspend?: SuspendTag;
  loop?: LoopTag;
}

/** HITL gate. Pauses execution; assigns to a role; injects steering
 *  context on retry. Emits both 'sequence' (approve) and 'reject' edges. */
export interface ApprovalTag {
  /** Org role authorized to approve (e.g., 'tech-lead', 'security-team'). */
  assigneeRole: string;
  /** Time before the approval auto-rejects. */
  slaMs: number;
  /** Optional structured input the reviewer fills in to steer retry. */
  steeringInputs?: SteeringInputSchema;
  /** Concurrency: only 'pessimistic' (single approver locks) in v1. */
  concurrency: 'pessimistic';
}

export interface SteeringInputSchema {
  fields: Array<{
    name: string;
    type: 'string' | 'number' | 'boolean';
    required?: boolean;
  }>;
}

/** Durable execution checkpoint. Serializes state, kills the worker,
 *  hydrates a new worker on timer expiration or external signal. */
export type SuspendTag =
  | { trigger: { kind: 'timer'; durationMs: number } }
  | { trigger: { kind: 'event'; eventType: string; matcher?: Expression } };

/** Iterates the same node over a collection. Composes with anything;
 *  Loop+Approval = approval per iteration; Loop+Suspend = durable
 *  iteration checkpoint. */
export interface LoopTag {
  /** Hint about what kind of iterable `path` resolves to. The runtime
   *  uses this to pick a default collector (e.g., 'directory' walks
   *  files; 'collection' iterates an array). */
  source: 'collection' | 'directory';
  /** Expression resolving to the iterable. May reference flow state,
   *  product repos, prior node output, etc. */
  path: Expression;
  /** Sequential = one iteration at a time; parallel = N at once. */
  mode: 'sequential' | 'parallel';
  /** Cap on concurrent iterations when `mode: 'parallel'`. */
  concurrency?: number;
}

// ─── Policy (reliability config; not topology) ───────────────────────────

export interface TaskStepPolicy {
  retry?: RetryPolicy;
  timeout?: Duration;
  /** Behavior when an unhandled error occurs:
   *   - 'propagate' (default) — fail the flow
   *   - 'continue' — log and proceed past this node
   *   - 'fallback' — route to the node's fallback edge if present */
  onError?: 'propagate' | 'continue' | 'fallback';
}

export interface RetryPolicy {
  maxAttempts: number;
  backoff?: BackoffPolicy;
}

export type BackoffPolicy =
  | { kind: 'fixed'; ms: number }
  | { kind: 'exponential'; baseMs: number; maxMs?: number; multiplier?: number };

/** Milliseconds. */
export type Duration = number;

// ─── Edges (carry all routing logic) ─────────────────────────────────────

export type Edge = SequenceEdge | ConditionalEdge | FallbackEdge | ErrorEdge | RejectEdge;

export interface SequenceEdge {
  from: string;
  to: string;
  type: 'sequence';
}

export interface ConditionalEdge {
  from: string;
  to: string;
  type: 'conditional';
  condition: Expression;
}

export interface FallbackEdge {
  from: string;
  to: string;
  type: 'fallback';
}

export interface ErrorEdge {
  from: string;
  to: string;
  type: 'error';
  /** Optional list of `NodeExit.errorName` values this edge handles
   *  (e.g. ['Timeout', 'RateLimitError', 'OutputParseError']). Omitted
   *  (or empty) → catch-all. A source node may declare any number of
   *  named error edges plus at most ONE catch-all; on an error exit the
   *  router picks the first declared edge whose `on` contains the
   *  errorName, falling back to the catch-all. Names are free-form —
   *  they match whatever the executors emit (AdapterError subclass
   *  names, 'UnknownTool', 'Timeout', …), which is runtime vocabulary
   *  the spec cannot close over. */
  on?: readonly string[];
}

/** Emitted only by Approval-tagged nodes and `kind: 'gate'` nodes when
 *  they reject. Carries a structured rejection payload (steering context,
 *  findings, attempt counter). The reject edge is the only edge that may
 *  form a cycle (retry-with-context loops). */
export interface RejectEdge {
  from: string;
  to: string;
  type: 'reject';
  /** Default 3. */
  maxAttempts?: number;
  /** Where to go when maxAttempts is exceeded. Default: fail the flow. */
  onMaxAttempts?: { kind: 'fail' } | { kind: 'escalate'; to: string };
}

/** The runtime payload carried by reject edges. Becomes input context
 *  to the destination node. */
export interface RejectionPayload {
  reason: string;
  /** Reviewer-injected hints (Approval) or assertion-failure message (gate). */
  steering?: string;
  /** Structured gate output. */
  findings?: unknown;
  /** 1-indexed; incremented each loop iteration. */
  attempt: number;
}

// ─── Expression (predicates + iterable resolution) ───────────────────────

/** Comparison operator for `compare` expressions.
 *
 *   ==, != — strict equality / inequality (===, !==); objects compare
 *            by REFERENCE, so structurally equal objects are never ==.
 *   <, <=, >, >= — numeric comparison; either side coerces via Number().
 *                  NaN on either side ⇒ predicate is false.
 *   in       — membership: rhs MUST resolve to an array; predicate is
 *              true iff lhs (raw value) is found via Array.includes
 *              (SameValueZero — NaN self-matches, a runtime-state-only
 *              case since JSON cannot encode NaN). This op is
 *              collection-only; string containment is `contains`.
 *   contains / startsWith / endsWith — string ops: both sides must
 *              resolve to strings, else false (no coercion, mirroring
 *              `in`'s strictness).
 *   matches  — regex test: both sides must resolve to strings; rhs is
 *              compiled via `new RegExp(rhs)` (no flags) and tested
 *              against lhs. An invalid pattern evaluates to false —
 *              the evaluator never throws on bad data. When rhs is a
 *              string literal, the validator additionally rejects
 *              invalid patterns at load time. */
export type CompareOp =
  | '=='
  | '!='
  | '<'
  | '<='
  | '>'
  | '>='
  | 'in'
  | 'contains'
  | 'startsWith'
  | 'endsWith'
  | 'matches';

/** Generic expression evaluated by the runtime. Tagged-union over evaluators
 *  so we can grow the language additively.
 *
 *  v1 evaluator covers everything except `js`. The boolean composition
 *  primitives (`compare` / `all` / `any` / `not`) are the deliberate
 *  alternative to a JS sandbox: most catalog logic only needs simple
 *  field comparisons + AND/OR/NOT, and these primitives express that
 *  without bringing a sandbox dependency on board. The `js` kind
 *  remains in the type so authors can declare future intent, but the
 *  evaluator throws — there's no in-process JS interpreter wired. */
export type Expression =
  /** JSONPath against flow state, e.g. `{ kind: 'jsonpath', path: '$.input.repos' }`. */
  | { kind: 'jsonpath'; path: string }
  /** Sandboxed JS, e.g. `{ kind: 'js', expression: 'ctx.review.score > 0.8' }`.
   *  Evaluator throws — use compare / all / any / not instead. */
  | { kind: 'js'; expression: string }
  /** Constant value. */
  | { kind: 'literal'; value: unknown }
  /** Binary comparison: lhs op rhs. */
  | { kind: 'compare'; lhs: Expression; op: CompareOp; rhs: Expression }
  /** Logical AND over a list of expressions. Short-circuits. */
  | { kind: 'all'; exprs: readonly Expression[] }
  /** Logical OR over a list of expressions. Short-circuits. */
  | { kind: 'any'; exprs: readonly Expression[] }
  /** Logical NOT of a single expression. */
  | { kind: 'not'; expr: Expression }
  /** Presence check: true iff the inner expression resolves to a value
   *  other than `undefined`. `null` EXISTS (it is a present JSON value);
   *  only a missing path does not. This is the escape hatch from
   *  truthiness — `false`, `0`, and `""` all exist. */
  | { kind: 'exists'; expr: Expression }
  /** Object constructor: each field resolved via resolveExpressionValue.
   *  As a predicate it is always true (containers are truthy). This is
   *  how `transform` steps and `input` mappings shape structured data
   *  from multiple state fields. */
  | { kind: 'object'; fields: Readonly<Record<string, Expression>> }
  /** Array constructor: each item resolved via resolveExpressionValue.
   *  As a predicate it is always true. */
  | { kind: 'array'; items: readonly Expression[] };

// ─── FlowOutputContract (drives JobIntent emission semantics) ────────────

/** Output contract for a flow. Drives validator (e.g., a
 *  `kind: 'job-definition'` flow must declare `output.kind: 'job-intent'`)
 *  and JobStateMachine emission semantics (terminal node output is parsed
 *  against this shape). */
export type FlowOutputContract =
  /** Default for `kind: 'work'` — plain agent text response. */
  | { kind: 'agent-text' }
  /** Required for `kind: 'job-definition'` — terminal node emits a JobIntent. */
  | { kind: 'job-intent' }
  /** Fan-out meta-flows emitting an array of JobIntents. */
  | { kind: 'job-intents'; min?: number; max?: number }
  /** Spec-emitting flows (e.g. `flow-architect`). */
  | { kind: 'flow-spec' }
  /** Generalized typed output. */
  | { kind: 'structured'; schema: unknown };

/** The runtime representation of a JobIntent — what JobDefinitionFlows
 *  emit, what gets submitted to JobStateMachine to launch the actual
 *  work flow. */
export interface JobIntent {
  flowId: string;
  productId: string;
  input: unknown;
  /** Optional: which named accepts-set to use ('default', 'cheap',
   *  'frontier', 'bench-claude', etc.). */
  set?: string;
  /** Per-job overrides (e.g., timeout). Adapter-specific. */
  config?: Record<string, unknown>;
}

// ─── FlowDef ─────────────────────────────────────────────────────────────

export interface FlowDef {
  id: string;
  /** Optional version identity (free-form, semver recommended). Gives
   *  durable checkpoints and subflow pins something stable to name;
   *  uniqueness is still keyed on `id` alone within a catalog. */
  version?: string;
  description?: string;
  /**
   * Flow kind discriminator. Default 'work'.
   *   - 'work' (default) — does product work; agents run for end-user value.
   *   - 'job-definition' — emits a JobIntent (intake conversations).
   *     Must declare `output: { kind: 'job-intent' }`.
   *   - 'post-job' — runs after a job for cleanup/notifications.
   */
  kind?: 'work' | 'job-definition' | 'post-job';
  /** Output contract for the terminal node. Default for `kind: 'work'`
   *  is `{ kind: 'agent-text' }`. JobDefinitionFlows MUST declare
   *  `{ kind: 'job-intent' }`. */
  output?: FlowOutputContract;
  /** All nodes (TaskSteps) in this flow. Exactly one must have
   *  `kind: 'trigger'` (the entry point). */
  nodes: TaskStep[];
  /** All edges between nodes. Routing logic lives here. */
  edges: Edge[];
}

/**
 * Walk a flow's nodes; yield every AgentDef from `kind: 'agent'` nodes.
 * Useful for surfaces that need a flat agent list — token-counting,
 * capability preflight, "register every agent for this job".
 */
export function* walkAgents(flow: FlowDef): Generator<AgentDef> {
  for (const node of flow.nodes) {
    if (node.kind === 'agent') {
      yield (node.config as AgentConfig).agent;
    }
  }
}

/**
 * One context-source declaration on a product. Mirrors the shape used in
 * `<workspace>/.harness/config/context-sources.yml` and in
 * harness-workspace.yml's per-product `contextSources` block. The loader
 * consumes these one-per-spawned-worker when `harness context load
 * --product X` lands.
 */
export interface ContextSourceDef {
  /** Source-type id from @helmsmith/context-loader-core's catalog
   *  (`code-full`, `prose-markdown`, `oss-code`, …). */
  type: string;
  /** What to ingest: a path, an OSS package@version, or a URL. */
  target: string;
  /** Per-source overrides (winning over workspace defaults). */
  embedderUrl?: string;
  embedderModel?: string;
  embedderDim?: number;
  backend?: string;
}

/**
 * One product repo declaration — name + git clone URL + optional
 * baseRef + optional in-container mount path. Used by spawn-worker
 * (slice 9d) to pre-clone the repo as a bare and add a per-job
 * worktree before the devcontainer boots.
 *
 * Shape mirrors `SpawnRepoSpec` from `@helmsmith/harness-server` (which
 * the spawn primitive owns) — declared here so the catalog can carry
 * the same shape without harness-core having to depend on
 * harness-server. Values cross the package boundary structurally.
 */
export interface ProductRepo {
  /** Local name — also the directory under `/workspace/<name>/` in
   *  the container's synthetic monorepo (PRD F19). */
  name: string;
  /** git clone URL — SSH (`git@github.com:org/repo.git`) or HTTPS
   *  (`https://github.com/org/repo.git`). For private repos under
   *  HTTPS, callers can inject a PAT via `cloneEnv` on the worker
   *  spawn (slice 9d-2-creds) or use the URL form
   *  `https://<token>@github.com/...`. */
  cloneUrl: string;
  /** Optional base ref to clone (default: remote's default branch). */
  baseRef?: string;
  /** Optional in-container mount path. Defaults to `/workspace/<name>/`
   *  per F19's synthetic-monorepo convention. */
  path?: string;
}

/**
 * Product = a tenant boundary with its declared content sources. Per
 * project_authority_model_jobs_pipelines, products are admin-owned shapes
 * the runtime references at job-acceptance time. They live alongside
 * pipelines in the unified Catalog.
 */
export interface ProductDef {
  id: string;
  description?: string;
  contextSources?: ContextSourceDef[];
  /**
   * Per-product git repos. When present, harness-server can resolve
   * `repos` for the container path (slice 9d-4) without the job
   * submission having to carry them — caller submits productId, the
   * server looks up the repo list. Per memory
   * `project_authority_model_jobs_pipelines`: products are admin-
   * owned, so this is the authoritative source of truth for which
   * repos belong to a product.
   *
   * When absent, callers must pass `repos` on the submission body
   * (slice 9d-4 fallback path).
   */
  repos?: ProductRepo[];
}

export interface FlowCatalog {
  flows: FlowDef[];
}

/**
 * Unified Catalog — flows + products. This is the single shape that flows
 * through `loadCatalog: () => Promise<Catalog>`. `FlowCatalog` is the
 * flows-only type; `Catalog` extends it with the additional axes.
 */
export interface Catalog extends FlowCatalog {
  /** Optional in v1 — workspaces without products skip this. */
  products?: ProductDef[];
}

export class CatalogError extends Error {}

/**
 * Project an agent's `accepts` field to a flat list for a given set name.
 *
 *   - undefined accepts → returns undefined (legacy / no-binding agent)
 *   - flat string[] accepts → returned as-is, set name ignored
 *   - Record<set, string[]> accepts → returns accepts[setName] OR
 *     accepts.default OR throws CatalogError
 *
 * Per memory `project_set_scoped_accepts`: this is called per-job at
 * submission time using the `set` field of the job submission. A single
 * running harness can serve different sets concurrently — natural for
 * benchmarking and per-customer policy.
 */
export function resolveAccepts(agent: AgentDef, setName: string): readonly string[] | undefined {
  const a = agent.accepts;
  if (a === undefined) return undefined;
  if (Array.isArray(a)) return a;
  const sets = a as Record<string, readonly string[]>;
  const picked = sets[setName] ?? sets.default;
  if (!picked) {
    throw new CatalogError(
      `agent "${agent.id}" has no "${setName}" set and no "default" set ` +
        `(declared sets: ${Object.keys(sets).join(', ')})`,
    );
  }
  return picked;
}

export function findFlow(catalog: FlowCatalog, id: string): FlowDef | undefined {
  return catalog.flows.find((f) => f.id === id);
}

export function findProduct(catalog: Catalog, id: string): ProductDef | undefined {
  return catalog.products?.find((p) => p.id === id);
}

// ─── Run-side wire shapes ────────────────────────────────────────────────
//
// The DEFINITION shapes above describe what a flow is; the shapes below
// describe what a flow RUN looks like on the wire — the state surface
// expressions bind against, the per-node exit signal routing reads, and
// the HITL request/resume payloads a reviewer UI exchanges with the
// runtime. They live in the spec because every consumer that previews,
// monitors, or approves a run must agree on them with the runtime —
// exactly the same argument as the expression evaluator.

/**
 * Per-node exit signal. Drives error/fallback/reject routing in the
 * conditional-edge router. Set by every node executor; the router reads
 * it to choose the next node id. jsonpath surface: `$.lastExit`.
 */
export interface NodeExit {
  nodeId: string;
  kind: 'success' | 'error' | 'reject';
  /** Set when kind === 'error'. Matched by `ErrorEdge.on`. */
  errorName?: string;
  errorMessage?: string;
}

/**
 * One staged change in a product repo. Populated into `state.changedFiles`
 * before HITL interrupts; surfaced to reviewers via ApprovalRequest +
 * the harness-server file routes.
 *
 * The `id` is stable for the same `(repo, path)` within a job — UI
 * components can use it as a React key, content-cache identifier, etc.
 * Renames produce ONE entry with the new path + `previousPath` filled
 * in (matches `git diff --name-status -z` rename rows).
 */
export interface ChangedFile {
  /** Stable id: `${repo}::${path}`. Suitable for URL paths after
   *  encodeURIComponent. */
  id: string;
  /** Repo name (matches an entry from `productRepos` on the JobRecord). */
  repo: string;
  /** Path within the repo (slash-separated, no leading slash). */
  path: string;
  /** Basename of `path` — for UI display. */
  filename: string;
  /** What kind of change this is. Mirrors git's name-status codes
   *  collapsed to readable form. */
  changeKind: 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'type-changed';
  /** Raw git status code (e.g., 'M', 'A', 'D', 'R100'). Preserved for
   *  clients that want git-native semantics. */
  statusCode: string;
  /** For renames/copies, the prior path. Undefined otherwise. */
  previousPath?: string;
  /** MIME type guessed from the file extension. Hint for UI rendering;
   *  not authoritative — clients may sniff content if needed. */
  mimeType: string;
}

/**
 * The routable run-state surface — the shape jsonpath expressions bind
 * against at runtime. This is the data-plane half of the contract: edge
 * conditions, gate assertions, loop paths, tool args, and node input
 * mappings all resolve against a value of this shape. harness-core's
 * FlowState channels must remain structurally assignable to this
 * (compile-time-asserted there).
 */
export interface FlowRunState {
  jobId: string;
  /** Job/trigger payload. Seeded once at start; never overwritten by
   *  nodes. jsonpath surface: `$.input`. */
  input: unknown;
  /** Latest text output (legacy single channel; last-write-wins). Each
   *  successful node writes here; the next node reads it as its default
   *  input. jsonpath surface: `$.output`. */
  output: string;
  /** Per-node outputs, keyed by node id. Structured (parsed JSON) when
   *  the node declares `output.kind: 'json'`; the raw output string
   *  otherwise. jsonpath surface: `$.nodes.<id>`. */
  nodes: Record<string, unknown>;
  /** Append-only message log (reducer-merged; safe under parallelism). */
  messages: unknown[];
  /** Per-node attempt counter (reject-edge cycles increment). */
  attempts: Record<string, number>;
  lastExit: NodeExit | null;
  rejectionPayload: RejectionPayload | null;
  /** Operator steering — append-only. */
  steering: string[];
  cancelRequested: boolean;
  cancelReason: string | null;
  changedFiles: ChangedFile[];
}

/**
 * Payload surfaced when an Approval-tagged node pauses for review. The
 * reviewer (or harness-server's HITL UI) inspects this, decides
 * approve/reject, and resumes with an `ApprovalResume`.
 */
export interface ApprovalRequest {
  /** Discriminator — distinguishes approval from suspend interrupts. */
  kind: 'approval';
  /** The original (untagged) node id whose output is being reviewed. */
  nodeId: string;
  /** Org role authorized to approve (from the ApprovalTag). */
  assigneeRole: string;
  /** Time-to-respond before the harness auto-rejects. harness-server
   *  arms an auto-reject timer from this value when the job pauses,
   *  re-armed across restarts from the original pause time (an SLA
   *  that expired while the server was down fires immediately). */
  slaMs: number;
  /** Optional structured input schema the reviewer fills in. */
  steeringInputs?: ApprovalTag['steeringInputs'];
  /** The output text the reviewer is approving — pulled from
   *  `state.output` at interrupt time. */
  content: string;
  /** 1-indexed attempt counter — increments each time the gate runs. */
  attempt: number;
  /** Staged file changes the reviewer can inspect. Empty when no agent
   *  has staged changes (or no product repos are wired). */
  changes: ChangedFile[];
  /** URL of the pull request opened by an upstream `publish` node
   *  (`push-and-open-pr`), when one ran before this gate. */
  prUrl?: string;
  /** Short human-readable summary of the staged diff (e.g. "3 files,
   *  +42 −7"), derived from `changes` at interrupt time. */
  diffSummary?: string;
}

/** Reviewer's answer to an ApprovalRequest. */
export interface ApprovalResume {
  decision: 'approve' | 'reject';
  /** Reviewer-provided steering text (free-form) or structured fields
   *  matching `steeringInputs`. Becomes the rejectionPayload.steering
   *  on reject; appended to `state.steering` on approve. */
  steering?: unknown;
}

/**
 * Payload surfaced when a Suspend-tagged node pauses. The caller is
 * responsible for scheduling the resume — timer-based or event-based.
 * The resume value is unused (suspend has no decision; resume is the
 * "wake up" signal itself).
 */
export interface SuspendRequest {
  kind: 'suspend';
  nodeId: string;
  trigger: SuspendTag['trigger'];
  /** Staged file changes pending review while the job is suspended. */
  changes: ChangedFile[];
}
