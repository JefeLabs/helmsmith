/**
 * Phase 4 runtime — compile a FlowDef into a runnable LangGraph StateGraph.
 *
 * Bridge between the static FlowDef catalog (nodes + edges + tags) and
 * an executable graph. Public surface:
 *
 *   - FlowState           — StateGraph schema (jobId, input, output,
 *                           nodes, messages, attempts, lastExit,
 *                           rejectionPayload, steering, cancelRequested,
 *                           changedFiles). Compile-time-asserted against
 *                           flow-spec's FlowRunState wire contract.
 *   - compileFlow         — FlowDef + per-node executor map → compiled
 *                           StateGraph with checkpointer attached.
 *   - buildRouter         — outgoing edges → ConditionalEdgeRouter
 *                           (precedence: reject → error → conditional →
 *                           sequence → fallback → END).
 *   - evalExpression      — predicate evaluator. Supports jsonpath +
 *                           literal + compare + all + any + not. `js`
 *                           throws.
 *   - makeGateExecutor    — built-in for kind:'gate' nodes.
 *   - makeTransformExecutor — built-in for kind:'transform' nodes.
 *   - linearFlowFromAgents — synthesize trigger→agents…→END from a
 *                           flat agent list (legacy compat).
 *
 * Loop tag wrapper (loopWrapper, internal): supports sequential +
 * parallel modes, collection + directory sources. Approval and Suspend
 * tags are handled via topology rewrite (synthetic interrupt nodes).
 *
 * Concerns deliberately NOT here:
 *   - Adapter dispatch / auth / bus events — orchestrator.ts owns these.
 *   - JobRecord mutation — same.
 *   - Per-step-kind dispatch for tool / script / subflow — those live
 *     in tool-executor.ts / script-executor.ts / subflow-executor.ts;
 *     orchestrator.ts wires them into the executor map this file
 *     receives.
 *
 * Canonical runtime coverage: see RUNTIME COVERAGE MATRIX in
 * orchestrator.ts.
 */

import { readdir } from 'node:fs/promises';
import { join as pathJoin } from 'node:path';
import {
  type ApprovalRequest,
  type ApprovalResume,
  evalExpression,
  type FlowRunState,
  type NodeExit,
  resolveExpressionValue,
  schemaViolations,
  type SuspendRequest,
} from '@helmsmith/flow-spec';
import {
  Annotation,
  type BaseCheckpointSaver,
  END,
  interrupt,
  MemorySaver,
  START,
  StateGraph,
} from '@langchain/langgraph';
import type {
  AgentDef,
  ApprovalTag,
  BackoffPolicy,
  Edge,
  Expression,
  FlowDef,
  LoopTag,
  RejectionPayload,
  SuspendTag,
  TaskStep,
  TaskStepPolicy,
} from './catalog.ts';
import type { ChangedFile } from './changed-files.ts';

// Run-side wire shapes moved to @helmsmith/flow-spec (the spec owns the
// run contract, not just the definition contract). Re-exported here so
// existing harness-core consumers keep their import paths.
export type { ApprovalRequest, ApprovalResume, NodeExit, SuspendRequest };
export { evalExpression };

/**
 * StateGraph state schema for compiled flows. Uses Annotation.Root to
 * match the existing entry-coordinator + checkout-coordinator graphs in
 * harness-server. Two channel patterns are reducer-merged (messages,
 * attempts) so multiple parallel paths can write without clobbering;
 * everything else uses last-write-wins.
 */
export const FlowState = Annotation.Root({
  /** The job this graph instance is executing. Threaded into node
   *  executors via the deps map (not the state itself), but kept here
   *  for diagnostic prints + future per-event tagging. */
  jobId: Annotation<string>,
  /** Job/trigger payload. Write-once: seeded by the initial invoke,
   *  later writes are ignored so nodes can never clobber the flow's
   *  input. jsonpath surface: `$.input`. */
  input: Annotation<unknown>({
    reducer: (current, incoming) => (current === null ? incoming : current),
    default: () => null,
  }),
  /** Accumulating text output. Each successful agent step writes here;
   *  the next step reads it as the user prompt. Equivalent to the old
   *  orchestrator's `priorOutput` local. Explicit last-write-wins
   *  reducer (2.4): parallel branches writing in the same superstep
   *  must not throw — but which write wins is NONDETERMINISTIC across
   *  branches, which is why `output` is the legacy channel and joins
   *  consume specific branches via `$.nodes.<id>` input mappings. */
  output: Annotation<string>({
    reducer: (_, n) => n,
    default: () => '',
  }),
  /** Per-node outputs, keyed by node id — written by the withNodeIO
   *  wrapper after every successful node that produced output. Merge-
   *  reducer so parallel branches never clobber. jsonpath surface:
   *  `$.nodes.<id>` (parsed JSON when the node declares output.kind
   *  'json', the raw output string otherwise). */
  nodes: Annotation<Record<string, unknown>>({
    reducer: (acc, partial) => ({ ...acc, ...partial }),
    default: () => ({}),
  }),
  /** Append-only message log. Future use: structured chat history for
   *  agents that work better with full message turns vs raw text. The
   *  reducer concatenates so parallel branches don't clobber. */
  messages: Annotation<unknown[]>({
    reducer: (a, b) => [...a, ...b],
    default: () => [],
  }),
  /** Per-node attempt counter. Reject edges form cycles; the rejecting
   *  node increments its own counter on each pass. The router compares
   *  against the reject edge's maxAttempts. Reducer merges so the
   *  counter survives across the cycle. */
  attempts: Annotation<Record<string, number>>({
    reducer: (acc, partial) => ({ ...acc, ...partial }),
    default: () => ({}),
  }),
  /** Last node's exit signal. Replace-on-write; only the most recent
   *  exit drives routing. */
  lastExit: Annotation<NodeExit | null>({
    reducer: (_, n) => n,
    default: () => null,
  }),
  /** Rejection payload from gate / approval-tagged nodes. Carries reason,
   *  steering, findings, attempt counter. The receiving node (target of
   *  the reject edge) reads this as its primary input context. */
  rejectionPayload: Annotation<RejectionPayload | null>({
    reducer: (_, n) => n,
    default: () => null,
  }),
  /**
   * In-flight operator steering — append-only string array. Operators
   * (or peer agents) push entries via `steerJob(jobId, text, deps)`;
   * the agent executor prepends the joined text into the agent's
   * system prompt on its next adapter invocation. Reducer concatenates
   * so multiple steering pushes accumulate; default is empty.
   *
   * Two access modes for agents:
   *   1. Passive — the agent executor reads this and prepends to the
   *      systemPrompt automatically. Works for any adapter.
   *   2. Active — Bash-capable agents can `harness steering check
   *      --job $HARNESS_JOB_ID` between LLM calls within a single
   *      node, getting fresh steering without waiting for the next
   *      node-tick. SKILL.md teaches the procedure.
   */
  steering: Annotation<string[]>({
    reducer: (a, b) => [...a, ...b],
    default: () => [],
  }),
  /**
   * Cooperative-cancellation flag. `cancelJob(jobId, reason, deps)`
   * sets this true via the checkpointer. The agent executor checks at
   * each node-tick boundary; when set, marks the agent + job as
   * 'cancelled' and short-circuits to a terminal status without
   * invoking the adapter. Hard cancellation (kill the in-flight
   * adapter call) is NOT supported here — that requires per-adapter
   * cancellation primitives the adapter layer doesn't yet expose.
   */
  cancelRequested: Annotation<boolean>({
    reducer: (_, n) => n,
    default: () => false,
  }),
  cancelReason: Annotation<string | null>({
    reducer: (_, n) => n,
    default: () => null,
  }),
  /**
   * RUNTIME-PRIVATE (2.4) — per-node success-completion counter, written
   * by withNodeIO on every successful node exit. The join guard reads it
   * for arrival accounting; NOT part of the FlowRunState wire contract
   * (structural `extends` permits extra channels) and not a jsonpath
   * surface catalogs should rely on. Double-underscore marks it private.
   */
  __completions: Annotation<Record<string, number>>({
    reducer: (acc, partial) => ({ ...acc, ...partial }),
    default: () => ({}),
  }),
  /**
   * RUNTIME-PRIVATE (2.4) — per-join-node skip flag for the current
   * superstep. The join guard sets `true` when the strategy is not yet
   * satisfied (or the join already fired); the node's router reads it
   * and ends that branch's traversal instead of forwarding.
   */
  __joinSkips: Annotation<Record<string, boolean>>({
    reducer: (acc, partial) => ({ ...acc, ...partial }),
    default: () => ({}),
  }),
  /**
   * Staged changes across product repos, populated by the agent
   * executor after each successful node-tick (and surfaced via
   * ApprovalRequest at HITL interrupts). Reducer merges by `id`
   * (`${repo}::${path}`): the latest entry for a path wins, so
   * agents that re-stage a file replace earlier entries cleanly.
   * Entries that no longer appear in a fresh discovery still persist
   * — once observed in state, a file stays in the changedFiles list
   * until the job terminates. Reviewers see the cumulative diff
   * surface, not a momentary snapshot.
   */
  changedFiles: Annotation<ChangedFile[]>({
    reducer: (existing, incoming) => {
      const merged = new Map<string, ChangedFile>();
      for (const c of existing) merged.set(c.id, c);
      for (const c of incoming) merged.set(c.id, c);
      return [...merged.values()];
    },
    default: () => [],
  }),
});

export type FlowStateT = typeof FlowState.State;

// Compile-time proof that the runtime state satisfies the spec's
// FlowRunState wire contract. If a channel drifts (name or type), this
// stops compiling — the honest seam between spec and runtime.
type _RunStateCheck = FlowStateT extends FlowRunState ? true : never;
const _runStateCheck: _RunStateCheck = true;
void _runStateCheck;

/**
 * Per-node executor function. Receives the current flow state and returns
 * a partial-state delta. Should NEVER throw under normal flow conditions
 * — instead return `{ lastExit: { kind: 'error', ... } }` so the router
 * can dispatch to the error edge. A genuine throw bypasses error edges
 * and propagates up to the caller (typically `runJob`), terminating the
 * job with status='failed'.
 */
export type NodeExecutor = (state: FlowStateT) => Promise<Partial<FlowStateT>>;

export interface CompileFlowOptions {
  flow: FlowDef;
  /** Map step.id → executor. Caller is responsible for building these
   *  from per-kind logic (agent runner, tool dispatch, gate evaluator,
   *  …). Missing ids fall through to a no-op executor that records a
   *  success exit — useful for steps that are inert pass-throughs. */
  executors: Map<string, NodeExecutor>;
  /** Checkpointer for state persistence. Required for Approval and Suspend
   *  tags (LangGraph's interrupt() needs a checkpointer to persist state
   *  while paused) — defaults to MemorySaver when any node carries either
   *  tag. Caller can pass a Postgres/SQLite saver to make awaiting-
   *  approval / suspended jobs survive process restarts. */
  checkpointer?: BaseCheckpointSaver;
}

/**
 * Compile a FlowDef into a runnable LangGraph. Returns a compiled graph
 * the caller invokes via `graph.invoke(initialState)`.
 *
 * Topology pipeline:
 *   1. Rewrite for Approval/Suspend tags — insert synthetic interrupt
 *      nodes and redirect outgoing edges. Required because LangGraph's
 *      interrupt() re-runs the entire node on resume; isolating the
 *      interrupt in its own node prevents re-running the inner work
 *      (e.g., re-invoking an LLM).
 *   2. Trigger lookup + START edge.
 *   3. Per-node executor — original-step executors come from the
 *      `executors` map; synthetic interrupt nodes carry tag-specific
 *      executors built here. Loop tag is wrapped without a topology
 *      rewrite — it iterates the inner inside a single node.
 *   4. Per-source-node ConditionalEdgeRouter from each node's outgoing
 *      edges (sequence/conditional/error/fallback/reject precedence).
 *   5. Compile with checkpointer — defaults to MemorySaver when any
 *      node carries an Approval or Suspend tag, since interrupt()
 *      requires a checkpointer to persist paused state.
 */
export function compileFlow(opts: CompileFlowOptions) {
  const { executors } = opts;

  // Step 1: rewrite topology for Approval/Suspend tags.
  const flow = rewriteFlowForInterruptTags(opts.flow);

  const trigger = flow.nodes.find((n) => n.kind === 'trigger');
  if (!trigger) {
    throw new Error(`flow "${flow.id}" has no trigger node`);
  }

  // biome-ignore lint/suspicious/noExplicitAny: builder type evolves per addNode call (LangGraph's chained-builder generics rotate the type after each addNode/addEdge). The runtime is correct; the static path-dependent types are too narrow for our dynamic-iteration construction.
  const builder: any = new StateGraph(FlowState);

  // Forward-edge (sequence | conditional) sources per target — the
  // arrival set a declared joinStrategy counts against (2.4).
  const forwardSourcesByTarget = new Map<string, string[]>();
  for (const e of flow.edges) {
    if (e.type !== 'sequence' && e.type !== 'conditional') continue;
    const list = forwardSourcesByTarget.get(e.to) ?? [];
    if (!list.includes(e.from)) list.push(e.from);
    forwardSourcesByTarget.set(e.to, list);
  }

  for (const node of flow.nodes) {
    const baseExec =
      // Synthetic approval / suspend nodes carry tag metadata that the
      // executor reads inline; they aren't in the caller-supplied map.
      // Built-in executors (gate) apply to stateless step kinds that
      // need no runJob deps — caller can still override by putting an
      // explicit entry in the executors map.
      isSyntheticApprovalNode(node)
        ? makeApprovalExecutor(node)
        : isSyntheticSuspendNode(node)
          ? makeSuspendExecutor(node)
          : (executors.get(node.id) ?? builtinExecutor(node) ?? defaultExecutor(node.id));
    const wrapped = withJoinGuard(
      node,
      forwardSourcesByTarget.get(node.id) ?? [],
      withEffectGuard(
        node,
        withPolicy(node, withNodeIO(node, wrapWithTags(node, withInputMapping(node, baseExec)))),
      ),
    );
    builder.addNode(node.id, wrapped);
  }

  builder.addEdge(START, trigger.id);

  const edgesBySource = groupEdgesBySource(flow.edges);
  for (const node of flow.nodes) {
    const out = edgesBySource.get(node.id) ?? [];
    if (out.length === 0) {
      builder.addEdge(node.id, END);
      continue;
    }
    builder.addConditionalEdges(node.id, buildRouter(node.id, out, node.policy?.onError));
  }

  // Step 5: attach checkpointer.
  //
  // Always attach one (defaulting to MemorySaver) — not just for flows
  // with Approval/Suspend tags. Reasoning: the steerJob / cancelJob
  // primitives use graph.updateState() to write to the checkpointer
  // mid-flight, and operators expect to steer ANY in-flight job, not
  // only the ones with HITL gates. Without a checkpointer attached,
  // updateState throws.
  //
  // Cost: per-tick checkpoint writes (small for in-process MemorySaver,
  // ~Map.set). The graph is already cached on deps.graphs for the
  // lifetime of the job, so the checkpointer adds negligible memory
  // beyond what we already retain.
  //
  // Caller-supplied checkpointer wins, as before — production swaps in
  // PostgresSaver / SqliteSaver via opts.checkpointer.
  const checkpointer = opts.checkpointer ?? new MemorySaver();

  return builder.compile({ checkpointer });
}

/**
 * Build a ConditionalEdgeRouter for a single source node, given its
 * outgoing edges. Edge precedence (validator guarantees max 1 of each
 * error/fallback/reject):
 *
 *   1. exit.kind === 'reject' + reject edge present → cycle back if
 *      attempts < maxAttempts; else escalate or throw per onMaxAttempts.
 *   2. exit.kind === 'error' + error edge present → route to error
 *      target. No error edge → throw (propagates to runJob).
 *   3. Success path: try conditional edges in declaration order;
 *      first predicate match wins.
 *   4. Sequence edge as default forward.
 *   5. Fallback edge as catchall when nothing else fires.
 *   6. END.
 */
export function buildRouter(
  nodeId: string,
  out: readonly Edge[],
  onError?: TaskStepPolicy['onError'],
): (state: FlowStateT) => string | string[] {
  const seqs = out.filter((e) => e.type === 'sequence');
  const conds = out.filter(
    (e): e is Extract<Edge, { type: 'conditional' }> => e.type === 'conditional',
  );
  const fb = out.find((e) => e.type === 'fallback');
  const errs = out.filter((e): e is Extract<Edge, { type: 'error' }> => e.type === 'error');
  const rej = out.find((e): e is Extract<Edge, { type: 'reject' }> => e.type === 'reject');

  return (state: FlowStateT): string | string[] => {
    // A pending (or already-fired) join skipped this trigger — end this
    // branch's traversal; the satisfying arrival forwards normally (2.4).
    if (state.__joinSkips?.[nodeId]) return END;

    const exit = state.lastExit;

    if (exit?.kind === 'reject' && rej) {
      const max = rej.maxAttempts ?? 3;
      const attempts = state.attempts[nodeId] ?? 0;
      if (attempts < max) {
        return rej.to;
      }
      const onMax = rej.onMaxAttempts;
      if (onMax?.kind === 'escalate') {
        return onMax.to;
      }
      throw new Error(`reject limit reached for node "${nodeId}" (${attempts}/${max} attempts)`);
    }

    if (exit?.kind === 'error') {
      // Named matchers first (first declared match wins), catch-all
      // (no/empty `on`) as fallback. Validator guarantees ≤1 catch-all.
      const name = exit.errorName;
      const named = name
        ? errs.find((e) => e.on !== undefined && e.on.length > 0 && e.on.includes(name))
        : undefined;
      const target = named ?? errs.find((e) => e.on === undefined || e.on.length === 0);
      if (target) return target.to;
      // policy.onError 'fallback' (2.3): an error no error edge handles
      // routes to the node's fallback edge instead of failing the flow.
      // ('continue' never reaches here — the policy wrapper converts the
      // exit to success before the router runs.)
      if (onError === 'fallback' && fb) return fb.to;
      throw new Error(
        `unhandled error at node "${nodeId}": ${exit.errorMessage ?? exit.errorName ?? 'unknown'}`,
      );
    }

    for (const c of conds) {
      if (evalExpression(c.condition, state)) {
        return c.to;
      }
    }
    // Fan-out (2.4): every sequence edge fires — LangGraph runs the
    // targets as parallel branches. Single edge stays a plain string.
    if (seqs.length === 1) return seqs[0]!.to;
    if (seqs.length > 1) return seqs.map((e) => e.to);
    if (fb) return fb.to;
    return END;
  };
}

function groupEdgesBySource(edges: readonly Edge[]): Map<string, Edge[]> {
  const m = new Map<string, Edge[]>();
  for (const edge of edges) {
    const arr = m.get(edge.from) ?? [];
    arr.push(edge);
    m.set(edge.from, arr);
  }
  return m;
}

function defaultExecutor(nodeId: string): NodeExecutor {
  return async () => ({ lastExit: { nodeId, kind: 'success' } });
}

/**
 * Per-step-kind built-in executor for stateless kinds that need no
 * external dependencies (no adapter, no broker, no subprocess).
 *
 *   - gate: evaluates GateConfig.assertions against state. Emits
 *     success when ALL hold; reject + RejectionPayload when ANY fails.
 *   - transform: evaluates TransformConfig.expression against state and
 *     writes the resolved value (stringified) to state.output. Always
 *     emits success — transforms are pure data shaping, not branching.
 *
 * Returns null for kinds that need runJob-supplied executors (agent,
 * tool, script, subflow) or are no-ops handled elsewhere (trigger).
 * Caller can still override any built-in by providing an explicit
 * entry in the executors map.
 */
function builtinExecutor(node: TaskStep): NodeExecutor | null {
  if (node.kind === 'gate') {
    return makeGateExecutor(node);
  }
  if (node.kind === 'transform') {
    return makeTransformExecutor(node);
  }
  return null;
}

/**
 * Gate executor — runs all assertions against the current state.
 *
 * All pass: returns `{ lastExit: { kind: 'success' } }`. Routing
 * proceeds via sequence/conditional edges as normal.
 *
 * Any fail: returns `{ lastExit: { kind: 'reject' }, rejectionPayload }`
 * with the failed assertion messages joined into `reason` and the
 * structured failures listed in `findings`. The router cycles back via
 * the gate's reject edge (validator restricts reject-source to gate or
 * approval-tagged nodes) with the attempt counter incrementing on the
 * gate node's id.
 *
 * Empty assertions list: trivially passes. Useful for "always-pass"
 * gates used as topology placeholders or as documentation of expected
 * conditions that hold by construction.
 *
 * Exported so tests + future tooling (gate-preview UI) can run it
 * standalone without compiling a full graph.
 */
export function makeGateExecutor(node: TaskStep): NodeExecutor {
  if (node.kind !== 'gate') {
    throw new Error(`makeGateExecutor: node "${node.id}" has kind "${node.kind}", expected "gate"`);
  }
  const config = node.config as {
    assertions?: ReadonlyArray<{ expression: Expression; message: string }>;
  };
  const assertions = config.assertions ?? [];
  const nodeId = node.id;

  return async (state) => {
    const failures: Array<{ message: string; expression: Expression }> = [];
    for (const assertion of assertions) {
      if (!evalExpression(assertion.expression, state)) {
        failures.push({ message: assertion.message, expression: assertion.expression });
      }
    }

    if (failures.length === 0) {
      return { lastExit: { nodeId, kind: 'success' } };
    }

    const attempts = state.attempts[nodeId] ?? 0;
    return {
      attempts: { [nodeId]: attempts + 1 },
      lastExit: { nodeId, kind: 'reject' },
      rejectionPayload: {
        reason: failures.map((f) => f.message).join('; '),
        findings: failures,
        attempt: attempts + 1,
      },
    };
  };
}

/**
 * Transform executor — evaluates the configured Expression against
 * current flow state and writes the resolved value to `state.output`.
 *
 *   - literal: writes expr.value verbatim (stringified for non-strings)
 *   - jsonpath: writes the jsonpath-resolved value (stringified)
 *   - js: throws (no sandbox; same as evalExpression)
 *
 * Always emits success. Transforms are pure data shaping — they don't
 * branch, don't reject, and don't fail under normal conditions.
 *
 * Stringification uses JSON.stringify for non-strings and pass-through
 * for strings; `undefined` results land as the literal string
 * `"undefined"` (catalogs that need "absent" semantics should guard
 * with a gate node first).
 *
 * Use cases: extracting structured fields from a prior agent's output,
 * coercing types between steps, computing derived values from state.
 *
 * Exported so tests + future tooling (catalog dry-run, expression
 * preview UI) can run a transform standalone.
 */
export function makeTransformExecutor(node: TaskStep): NodeExecutor {
  if (node.kind !== 'transform') {
    throw new Error(
      `makeTransformExecutor: node "${node.id}" has kind "${node.kind}", expected "transform"`,
    );
  }
  const config = node.config as { expression: Expression };
  const nodeId = node.id;

  return async (state) => {
    const value = resolveExpressionValue(config.expression, state);
    const output = typeof value === 'string' ? value : JSON.stringify(value);
    return {
      output,
      lastExit: { nodeId, kind: 'success' },
    };
  };
}

/**
 * Wrap a node executor with tag-driven behavior modifiers.
 *
 * Approval and Suspend tags are NOT applied here — they are handled by
 * the topology rewriter (rewriteFlowForInterruptTags) which inserts
 * synthetic interrupt nodes after the original. The original step's
 * executor runs as-is; the synthetic node owns the interrupt.
 *
 * Loop tag IS handled here, as a wrapper. The wrapper resolves the
 * iteration source from state, runs the inner once per item with the
 * item set as `state.output`, and aggregates results. No topology
 * rewrite needed — Loop is a within-node iteration, not a separate
 * graph node.
 */
function wrapWithTags(step: TaskStep, exec: NodeExecutor): NodeExecutor {
  if (!step.tags?.loop) return exec;
  return loopWrapper(step.id, step.tags.loop, exec, step.output?.kind === 'json');
}

/**
 * Innermost node wrapper: when the step declares `input`, resolve the
 * mapping against current state and hand the node an effective
 * `state.output` built from it — a single Expression resolves to its
 * value (strings pass through raw; other values JSON-serialize), a
 * Record resolves each field and serializes the object as JSON. This is
 * how a node consumes MORE than the previous node's output: `$.input`,
 * `$.nodes.<id>`, `$.rejectionPayload`, … Runs inside the Loop wrapper
 * so a looped node's mapping sees the per-item state ($.output is the
 * current item).
 */
function withInputMapping(step: TaskStep, exec: NodeExecutor): NodeExecutor {
  const mapping = step.input;
  if (mapping === undefined) return exec;
  return async (state) => {
    const resolved = resolveInputMapping(mapping, state);
    const effective = typeof resolved === 'string' ? resolved : (JSON.stringify(resolved) ?? '');
    return exec({ ...state, output: effective });
  };
}

function resolveInputMapping(
  mapping: Expression | Readonly<Record<string, Expression>>,
  state: unknown,
): unknown {
  // A string `kind` field marks the single-Expression form (the
  // validator rejects mapping keys named "kind" for this reason).
  if (typeof (mapping as { kind?: unknown }).kind === 'string') {
    return resolveExpressionValue(mapping as Expression, state);
  }
  const out: Record<string, unknown> = {};
  for (const [k, sub] of Object.entries(mapping as Record<string, Expression>)) {
    out[k] = resolveExpressionValue(sub, state);
  }
  return out;
}

/**
 * Join guard (roadmap 2.4) — the runtime consult of TaskStep.joinStrategy.
 * Applied OUTERMOST, only when a node explicitly declares a strategy
 * (an implicit 'all' default would deadlock diamonds whose branches
 * route conditionally — undeclared multi-in nodes keep LangGraph's
 * trigger-per-arrival behavior).
 *
 * Semantics, per trigger of the join node:
 *   - already fired this run (own __completions > 0) → skip.
 *   - arrivals = forward-edge sources with __completions > 0.
 *     'all' requires every source; 'any' requires one; nOfM requires n
 *     (capped at the source count). Short → skip.
 *   - satisfied → execute exactly once.
 * A skip returns only a __joinSkips marker; the node's router reads it
 * and ends that branch's traversal (END) instead of forwarding.
 *
 * v1 caveats (documented in the spec): joins inside reject cycles are
 * unsupported (the once-per-run marker never resets), and an 'all' join
 * whose counted source is conditionally skipped never fires — the flow
 * ends without it (authors declare 'all' only over always-run sources).
 */
function withJoinGuard(
  step: TaskStep,
  forwardSources: readonly string[],
  exec: NodeExecutor,
): NodeExecutor {
  const strategy = step.joinStrategy;
  if (strategy === undefined) return exec;
  const nodeId = step.id;
  const required =
    strategy === 'all'
      ? forwardSources.length
      : strategy === 'any'
        ? 1
        : Math.min(strategy.nOfM, forwardSources.length);

  return async (state) => {
    if ((state.__completions?.[nodeId] ?? 0) > 0) {
      return { __joinSkips: { [nodeId]: true } };
    }
    const arrived = forwardSources.filter((s) => (state.__completions?.[s] ?? 0) > 0).length;
    if (arrived < required) {
      return { __joinSkips: { [nodeId]: true } };
    }
    const delta = await exec(state);
    return { ...delta, __joinSkips: { [nodeId]: false } };
  };
}

/**
 * Policy wrapper (roadmap 2.3) — the runtime consult of TaskStep.policy.
 * Sits outside withNodeIO so retries also cover OutputParseError (an
 * agent that emitted invalid JSON gets re-asked), and inside
 * withEffectGuard so a side-effecting node that already completed is
 * never re-entered at all.
 *
 *   - retry: re-runs the node while it produces an ERROR exit, up to
 *     maxAttempts TOTAL attempts (1 ≡ no retry), sleeping per the
 *     declared backoff between attempts (fixed, or exponential
 *     baseMs·multiplier^(n-1) capped at maxMs; multiplier default 2).
 *     Reject exits are authored flow control — never retried here.
 *   - timeout: per-ATTEMPT deadline. A node that exceeds it exits with
 *     errorName 'Timeout' (error-edge routable, retryable). The losing
 *     executor keeps running detached — NodeExecutor has no AbortSignal
 *     yet (same limitation as loop sibling cancellation); its late
 *     result is discarded.
 *   - onError 'continue': after retries exhaust, convert the error exit
 *     to success (logged) so the flow proceeds past the node.
 *     'fallback' is implemented in buildRouter (it's a routing
 *     decision); 'propagate' is the default behavior unchanged.
 *
 * A GraphInterrupt thrown by a synthetic interrupt node passes through
 * untouched — this wrapper only inspects RETURNED deltas, never
 * catches. (Synthetic nodes carry no policy anyway.)
 */
function withPolicy(step: TaskStep, exec: NodeExecutor): NodeExecutor {
  const policy = step.policy;
  if (!policy) return exec;
  const nodeId = step.id;
  const maxAttempts = policy.retry?.maxAttempts ?? 1;
  const backoff = policy.retry?.backoff;
  const attemptOnce =
    policy.timeout === undefined ? exec : withTimeout(nodeId, policy.timeout, exec);

  return async (state) => {
    let delta = await attemptOnce(state);
    for (let attempt = 1; attempt < maxAttempts && isErrorExit(delta); attempt++) {
      await sleep(backoffDelayMs(backoff, attempt));
      delta = await attemptOnce(state);
    }
    if (isErrorExit(delta) && policy.onError === 'continue') {
      console.warn(
        `[flow] node "${nodeId}" failed (${delta.lastExit?.errorName ?? 'unknown'}) after ${maxAttempts} attempt(s); policy.onError='continue' — proceeding`,
      );
      return { ...delta, lastExit: { nodeId, kind: 'success' } };
    }
    return delta;
  };
}

function isErrorExit(delta: Partial<FlowStateT>): boolean {
  return delta.lastExit?.kind === 'error';
}

function backoffDelayMs(backoff: BackoffPolicy | undefined, attempt: number): number {
  if (!backoff) return 0;
  if (backoff.kind === 'fixed') return backoff.ms;
  const raw = backoff.baseMs * (backoff.multiplier ?? 2) ** (attempt - 1);
  return Math.min(raw, backoff.maxMs ?? Number.POSITIVE_INFINITY);
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    (t as { unref?: () => void }).unref?.();
  });
}

/**
 * Per-attempt timeout: race the executor against a deadline. On expiry,
 * return an error-edge-routable 'Timeout' exit; the loser's eventual
 * result (or rejection) is discarded.
 */
function withTimeout(nodeId: string, timeoutMs: number, exec: NodeExecutor): NodeExecutor {
  return async (state) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<Partial<FlowStateT>>((resolve) => {
      timer = setTimeout(
        () =>
          resolve({
            lastExit: {
              nodeId,
              kind: 'error',
              errorName: 'Timeout',
              errorMessage: `node "${nodeId}" exceeded policy.timeout of ${timeoutMs}ms`,
            },
          }),
        timeoutMs,
      );
      (timer as { unref?: () => void }).unref?.();
    });
    const attempt = exec(state);
    // A loser that rejects after the deadline won must not surface as an
    // unhandled rejection; a rejection BEFORE the deadline (including
    // GraphInterrupt) still propagates through the race.
    attempt.catch(() => {});
    try {
      return await Promise.race([attempt, deadline]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
}

/**
 * Outermost node wrapper — the runtime consult of `TaskStep.effect`:
 * at-most-once execution for `side-effecting` nodes. When completion
 * evidence exists in `state.nodes[id]` (written by withNodeIO on the
 * node's first successful run), any re-entry — a reject-edge cycle, a
 * checkpointer replay after resume or restart — returns the recorded
 * output instead of re-running the effect. `idempotent` / `pure` /
 * unclassified nodes re-run freely: authors who WANT re-publish
 * semantics mark the node `idempotent` and rely on the executor's
 * natural-key idempotency (publish-executor reuses an existing PR for
 * the same head branch).
 *
 * Granularity notes: synthetic interrupt nodes never carry `effect`
 * (the topology rewriter's synthetic node omits it), and a looped
 * side-effecting node is skipped as a whole unit — at-most-once is per
 * node, not per iteration. A side-effecting node that produced no
 * output leaves no evidence and will re-run; publish nodes always
 * produce output.
 */
function withEffectGuard(step: TaskStep, exec: NodeExecutor): NodeExecutor {
  if (step.effect !== 'side-effecting') return exec;
  const nodeId = step.id;
  return async (state) => {
    const prior = state.nodes?.[nodeId];
    if (prior !== undefined) {
      return {
        output: typeof prior === 'string' ? prior : JSON.stringify(prior),
        lastExit: { nodeId, kind: 'success' },
      };
    }
    return exec(state);
  };
}

/**
 * Records the node's output into the
 * `state.nodes` map (after Loop aggregation, so a looped node records
 * its aggregate). When the step declares `output.kind: 'json'`, the
 * output string is parsed and the PARSED value is recorded — this is
 * what makes `$.nodes.<id>.<field>` routable in gates and conditional
 * edges. Parse failure converts the exit to errorName
 * 'OutputParseError' so the flow can route around it via an error edge
 * (the raw output is kept on `state.output` for debugging).
 */
function withNodeIO(step: TaskStep, exec: NodeExecutor): NodeExecutor {
  const nodeId = step.id;
  const wantsJson = step.output?.kind === 'json';
  return async (state) => {
    // Success-completion accounting (2.4): every successful exit bumps
    // the node's runtime-private counter so join guards can count
    // arrivals even for nodes that produce no output (gates, triggers).
    const completed = (delta: Partial<FlowStateT>): Partial<FlowStateT> =>
      delta.lastExit && delta.lastExit.kind !== 'success'
        ? delta
        : {
            ...delta,
            __completions: { [nodeId]: (state.__completions?.[nodeId] ?? 0) + 1 },
          };
    const delta = await exec(state);
    if (delta.output === undefined) return completed(delta);
    if (delta.lastExit && delta.lastExit.kind !== 'success') return delta;
    if (!wantsJson) return completed({ ...delta, nodes: { [nodeId]: delta.output } });
    let parsed: unknown;
    try {
      parsed = JSON.parse(delta.output);
    } catch (err) {
      return {
        ...delta,
        lastExit: {
          nodeId,
          kind: 'error',
          errorName: 'OutputParseError',
          errorMessage: `declared output.kind 'json' but output is not valid JSON: ${(err as Error).message}`,
        },
      };
    }
    // 2.7 — enforce the declared subset schema against the parsed value.
    // Violations exit with their own errorName (error-edge routable,
    // retryable via policy.retry) and the value is NOT recorded as
    // addressable evidence.
    if (step.output?.kind === 'json' && step.output.schema !== undefined) {
      const issues = schemaViolations(parsed, step.output.schema);
      if (issues.length > 0) {
        return {
          ...delta,
          lastExit: {
            nodeId,
            kind: 'error',
            errorName: 'OutputSchemaViolation',
            errorMessage: `output violates the declared schema: ${issues.join('; ')}`,
          },
        };
      }
    }
    return completed({ ...delta, nodes: { [nodeId]: parsed } });
  };
}

// ─── Topology rewriter (Approval + Suspend tags) ──────────────────────────

/** Suffix appended to a tagged node's id to derive its synthetic
 *  approval node id. Exported only as a constant pattern; no public API
 *  surface depends on the literal value. */
const APPROVAL_SUFFIX = '__approval';
const SUSPEND_SUFFIX = '__suspend';

interface SyntheticApprovalNode extends TaskStep {
  __approvalTag: ApprovalTag;
}
interface SyntheticSuspendNode extends TaskStep {
  __suspendTag: SuspendTag;
}

function isSyntheticApprovalNode(node: TaskStep): node is SyntheticApprovalNode {
  return '__approvalTag' in node;
}
function isSyntheticSuspendNode(node: TaskStep): node is SyntheticSuspendNode {
  return '__suspendTag' in node;
}

/**
 * Rewrite a FlowDef so that every node carrying an Approval or Suspend
 * tag has a synthetic interrupt node inserted immediately after it. The
 * original node's outgoing edges are redirected to start from the
 * synthetic node — so the interrupt becomes the routing decision point.
 *
 * Why: LangGraph's interrupt() re-runs the entire host node on resume.
 * If Approval is wrapped around an LLM agent, the agent runs twice
 * (once before interrupt, once after) — wasteful and non-idempotent.
 * Splitting the work + interrupt into separate nodes means only the
 * interrupt node re-runs on resume; the work runs exactly once.
 *
 * Approval ⊥ Suspend per validator (TaskStepTags.approval and
 * .suspend cannot both be set), so a node gets at most one rewrite.
 * Loop tag is unaffected here — it's a wrapper, not a topology change.
 */
function rewriteFlowForInterruptTags(flow: FlowDef): FlowDef {
  const tagged = flow.nodes.filter(
    (n) => n.tags?.approval !== undefined || n.tags?.suspend !== undefined,
  );
  if (tagged.length === 0) return flow;

  const newNodes: TaskStep[] = [];
  const renames = new Map<string, string>();

  for (const node of flow.nodes) {
    if (node.tags?.approval) {
      const syntheticId = `${node.id}${APPROVAL_SUFFIX}`;
      const synthetic: SyntheticApprovalNode = {
        id: syntheticId,
        kind: 'agent',
        // The synthetic node has no real config; the executor pulls
        // tag data from __approvalTag rather than config.
        config: { agent: { id: syntheticId } as AgentDef },
        __approvalTag: node.tags.approval,
      };
      newNodes.push({ ...node, tags: undefined }, synthetic);
      renames.set(node.id, syntheticId);
    } else if (node.tags?.suspend) {
      const syntheticId = `${node.id}${SUSPEND_SUFFIX}`;
      const synthetic: SyntheticSuspendNode = {
        id: syntheticId,
        kind: 'agent',
        config: { agent: { id: syntheticId } as AgentDef },
        __suspendTag: node.tags.suspend,
      };
      newNodes.push({ ...node, tags: undefined }, synthetic);
      renames.set(node.id, syntheticId);
    } else {
      newNodes.push(node);
    }
  }

  const newEdges: Edge[] = [];
  // For every tagged-original node, insert a sequence edge → synthetic.
  for (const orig of tagged) {
    const syntheticId = renames.get(orig.id);
    if (!syntheticId) continue;
    newEdges.push({ from: orig.id, to: syntheticId, type: 'sequence' });
  }
  // Redirect existing edges that originated from a tagged node — their
  // `from` becomes the synthetic id (the interrupt is the new exit
  // point). Edges TO a tagged node are unchanged (the original still
  // runs first and is still the entry point).
  for (const edge of flow.edges) {
    const newFrom = renames.get(edge.from) ?? edge.from;
    newEdges.push({ ...edge, from: newFrom } as Edge);
  }

  return { ...flow, nodes: newNodes, edges: newEdges };
}

// ─── Tag-node executors ──────────────────────────────────────────────────

/**
 * Pull a `prUrl` out of a node's text `output` when it's the JSON shape
 * a `publish` (push-and-open-pr) node emits. Returns `undefined` for
 * any other output (plain agent text, non-JSON, JSON without a prUrl
 * string) — purely best-effort enrichment, never throws.
 */
function extractPrUrlFromOutput(output: string): string | undefined {
  if (!output || output[0] !== '{') return undefined;
  try {
    const parsed = JSON.parse(output) as Record<string, unknown>;
    return typeof parsed.prUrl === 'string' ? parsed.prUrl : undefined;
  } catch {
    return undefined;
  }
}

/** One-line summary of staged changes for the HITL surface, e.g.
 *  "3 files (2 modified, 1 added)". Returns `undefined` when there are
 *  no changes (the UI then shows nothing rather than "0 files"). */
function summarizeChanges(changes: readonly ChangedFile[]): string | undefined {
  if (changes.length === 0) return undefined;
  const byKind = new Map<string, number>();
  for (const c of changes) byKind.set(c.changeKind, (byKind.get(c.changeKind) ?? 0) + 1);
  const breakdown = [...byKind.entries()].map(([k, n]) => `${n} ${k}`).join(', ');
  const noun = changes.length === 1 ? 'file' : 'files';
  return `${changes.length} ${noun} (${breakdown})`;
}

/**
 * Synthetic Approval node executor.
 *
 * On first execution: calls interrupt(...) with an ApprovalRequest
 * payload. The graph pauses; runJob picks up the interrupt from
 * `result.__interrupt__` and marks the JobRecord 'awaiting-approval'.
 *
 * On resume (Command({resume: ApprovalResume})): interrupt() returns
 * the resume value. The executor:
 *   - 'approve' → success exit (forward via sequence/conditional)
 *   - 'reject' → reject exit + RejectionPayload (route via reject edge;
 *     attempt counter increments on this synthetic node's id)
 */
function makeApprovalExecutor(node: SyntheticApprovalNode): NodeExecutor {
  const tag = node.__approvalTag;
  const nodeId = node.id;
  // Strip the suffix to recover the original (untagged) node id for
  // the user-facing payload.
  const originalId = nodeId.replace(new RegExp(`${APPROVAL_SUFFIX}$`), '');

  return async (state) => {
    const attempts = state.attempts[nodeId] ?? 0;

    // Gate 2b — when an upstream `publish` node (push-and-open-pr) ran,
    // its output is `JSON.stringify({ prUrl, prNumber, branchName })`.
    // Surface `prUrl` on the request so the HITL UI can link to the PR.
    const prUrl = extractPrUrlFromOutput(state.output);
    const diffSummary = summarizeChanges(state.changedFiles);

    const request: ApprovalRequest = {
      kind: 'approval',
      nodeId: originalId,
      assigneeRole: tag.assigneeRole,
      slaMs: tag.slaMs,
      ...(tag.steeringInputs ? { steeringInputs: tag.steeringInputs } : {}),
      content: state.output,
      attempt: attempts + 1,
      changes: state.changedFiles,
      ...(prUrl ? { prUrl } : {}),
      ...(diffSummary ? { diffSummary } : {}),
    };

    const resume = interrupt(request) as ApprovalResume;

    if (resume?.decision === 'approve') {
      // Forward-looking steering on approve: reviewer's steering text
      // appended to state.steering so DOWNSTREAM agents pick it up
      // via the existing passive-prepend path. (Reject cycles use
      // rejectionPayload.steering; approve uses the long-lived
      // state.steering channel — different semantic, same content.)
      const forward =
        typeof resume.steering === 'string' && resume.steering.length > 0
          ? { steering: [resume.steering] }
          : {};
      return {
        attempts: { [nodeId]: attempts + 1 },
        lastExit: { nodeId, kind: 'success' },
        ...forward,
      };
    }

    return {
      attempts: { [nodeId]: attempts + 1 },
      lastExit: { nodeId, kind: 'reject' },
      rejectionPayload: {
        reason: 'rejected by reviewer',
        ...(typeof resume?.steering === 'string' ? { steering: resume.steering } : {}),
        ...(resume?.steering !== undefined && typeof resume.steering !== 'string'
          ? { findings: resume.steering }
          : {}),
        attempt: attempts + 1,
      },
    };
  };
}

/**
 * Synthetic Suspend node executor.
 *
 * Calls interrupt(...) with a SuspendRequest payload. runJob marks the
 * JobRecord 'suspended'. The caller (harness-server) is responsible for
 * scheduling the resume — timer-based via setTimeout/cron, or event-
 * based via subscription.
 *
 * On resume (Command({resume})): the resume value is unused; suspend
 * has no decision, just a wake-up signal. The executor returns success.
 */
function makeSuspendExecutor(node: SyntheticSuspendNode): NodeExecutor {
  const tag = node.__suspendTag;
  const nodeId = node.id;
  const originalId = nodeId.replace(new RegExp(`${SUSPEND_SUFFIX}$`), '');

  return async (state) => {
    const request: SuspendRequest = {
      kind: 'suspend',
      nodeId: originalId,
      trigger: tag.trigger,
      changes: state.changedFiles,
    };
    interrupt(request);
    // Resume value is unused for suspend — wake-up is the signal.
    return {
      lastExit: { nodeId, kind: 'success' },
    };
  };
}

/**
 * Loop tag wrapper. Resolves the iteration source from state, runs the
 * inner executor once per item with `state.output` set to the item, and
 * aggregates outputs. Halts iteration on the first error or reject from
 * the inner.
 *
 * Sources:
 *   - 'collection': tag.path resolves to an array; each element becomes
 *      the inner's `state.output` (stringified for non-strings).
 *   - 'directory':  tag.path resolves to a directory string; readdir-ed
 *      entries become absolute-path items, sorted alphabetically. No
 *      recursive walk in v1 — catalog authors who need a tree should
 *      compose with a `script` step that runs `find` and pipes the
 *      paths back as state.output, then loop over `collection` against
 *      that.
 *
 * Modes:
 *   - 'sequential': one iteration at a time. Halt on first failure.
 *   - 'parallel':   chunked async pool with concurrency = tag.concurrency
 *      ?? 4. Items run in chunks; after each chunk completes, the loop
 *      checks for a failure delta and short-circuits to the first one.
 *      Items already running in the failing chunk are awaited (Promise.
 *      all resolves them; their results are discarded). Subsequent
 *      chunks are skipped. Trade-off: simpler than a per-slot pool, at
 *      the cost of one slow item potentially holding up the pool.
 *
 * The result aggregates iteration outputs joined by `\n---\n`. Per-
 * iteration deltas to `attempts` / `changedFiles` are NOT merged across
 * iterations in v1 — only the LAST iteration's delta survives. Catalog
 * authors who need cross-iteration accumulation should rely on the
 * channel reducers (changedFiles uses one) or use a `transform` step
 * after the loop to project state.
 */
function loopWrapper(
  nodeId: string,
  tag: LoopTag,
  inner: NodeExecutor,
  wantsJson: boolean,
): NodeExecutor {
  // json-declaring looped nodes aggregate a JSON ARRAY — each item's
  // output must itself be valid JSON, and withNodeIO parses the whole
  // aggregate into state.nodes[id] as an array of per-iteration values.
  // (The `\n---\n` text join is never valid JSON, so without this a
  // json loop over 2+ items could only ever exit OutputParseError.)
  const joinOutputs = wantsJson
    ? (outputs: string[]) => `[${outputs.join(',')}]`
    : (outputs: string[]) => outputs.join('\n---\n');
  return async (state) => {
    const itemsOrError = await resolveLoopItems(tag, state, nodeId);
    if (!Array.isArray(itemsOrError)) {
      return { lastExit: itemsOrError };
    }
    const items = itemsOrError;
    const concurrency = Math.max(1, tag.concurrency ?? 4);

    if (tag.mode === 'parallel') {
      return runLoopParallel(items, inner, state, nodeId, concurrency, joinOutputs);
    }
    return runLoopSequential(items, inner, state, nodeId, joinOutputs);
  };
}

/**
 * Resolve the iteration source. Returns either the items array or a
 * NodeExit error so the wrapper can short-circuit. The fs.readdir
 * failure path produces a distinct errorName ('LoopDirectoryError') so
 * catalog authors can wire a specific error edge for missing directories.
 */
async function resolveLoopItems(
  tag: LoopTag,
  state: FlowStateT,
  nodeId: string,
): Promise<unknown[] | NodeExit> {
  if (tag.source === 'collection') {
    const raw = resolveExpressionValue(tag.path, state);
    if (!Array.isArray(raw)) {
      return {
        nodeId,
        kind: 'error',
        errorName: 'LoopPathError',
        errorMessage: `Loop path did not resolve to an array (got ${typeof raw})`,
      };
    }
    return raw;
  }
  // source: 'directory'
  const dirPath = resolveExpressionValue(tag.path, state);
  if (typeof dirPath !== 'string' || dirPath.length === 0) {
    return {
      nodeId,
      kind: 'error',
      errorName: 'LoopPathError',
      errorMessage: `Loop directory path did not resolve to a non-empty string (got ${typeof dirPath})`,
    };
  }
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    // Sorted alphabetical for predictability across runs / OSes —
    // readdir order is filesystem-defined. Emit absolute paths so
    // inner steps can stat / read directly without re-resolving.
    return entries.map((e) => pathJoin(dirPath, e.name)).sort();
  } catch (err) {
    return {
      nodeId,
      kind: 'error',
      errorName: 'LoopDirectoryError',
      errorMessage: `failed to read directory "${dirPath}": ${(err as Error).message}`,
    };
  }
}

async function runLoopSequential(
  items: readonly unknown[],
  inner: NodeExecutor,
  state: FlowStateT,
  nodeId: string,
  joinOutputs: (outputs: string[]) => string,
): Promise<Partial<FlowStateT>> {
  const outputs: string[] = [];
  let lastDelta: Partial<FlowStateT> = {};

  for (const item of items) {
    const delta = await inner(buildItemState(state, item));
    if (delta.lastExit?.kind === 'error' || delta.lastExit?.kind === 'reject') {
      return delta;
    }
    if (typeof delta.output === 'string') outputs.push(delta.output);
    lastDelta = delta;
  }

  return {
    ...lastDelta,
    output: joinOutputs(outputs),
    lastExit: { nodeId, kind: 'success' },
  };
}

async function runLoopParallel(
  items: readonly unknown[],
  inner: NodeExecutor,
  state: FlowStateT,
  nodeId: string,
  concurrency: number,
  joinOutputs: (outputs: string[]) => string,
): Promise<Partial<FlowStateT>> {
  const outputs: string[] = [];
  let lastDelta: Partial<FlowStateT> = {};

  // Process items in chunks of `concurrency`. Each chunk runs in
  // parallel via Promise.all; we check for failures after the chunk
  // completes so all in-flight iterations get to finish (sibling
  // cancellation isn't supported — the inner executor's contract
  // doesn't expose AbortSignal yet). The first failure in arrival
  // order halts subsequent chunks.
  for (let i = 0; i < items.length; i += concurrency) {
    const chunk = items.slice(i, i + concurrency);
    const deltas = await Promise.all(chunk.map((item) => inner(buildItemState(state, item))));
    for (const delta of deltas) {
      if (delta.lastExit?.kind === 'error' || delta.lastExit?.kind === 'reject') {
        return delta;
      }
      if (typeof delta.output === 'string') outputs.push(delta.output);
      lastDelta = delta;
    }
  }

  return {
    ...lastDelta,
    output: joinOutputs(outputs),
    lastExit: { nodeId, kind: 'success' },
  };
}

function buildItemState(state: FlowStateT, item: unknown): FlowStateT {
  const itemInput = typeof item === 'string' ? item : JSON.stringify(item);
  return { ...state, output: itemInput };
}

/**
 * Synthesize a linear FlowDef from a flat agent list. Used by runJob's
 * legacy compatibility path: every existing JobRecord submission
 * provides agents directly, not a FlowDef. The synthesized flow is
 *
 *   trigger:__entry → agents[0] → agents[1] → … → agents[N-1] → END
 *
 * with sequence edges throughout. Coordinator agents are filtered out
 * to match the historical orchestrator behavior (hardcoded skip on
 * id === 'coordinator' / 'checkout-coordinator').
 */
export function linearFlowFromAgents(id: string, agents: readonly { id: string }[]): FlowDef {
  const real = agents.filter((a) => a.id !== 'coordinator' && a.id !== 'checkout-coordinator');
  const TRIGGER_ID = '__trigger';
  const nodes: TaskStep[] = [
    {
      id: TRIGGER_ID,
      kind: 'trigger',
      config: { kind: 'manual' },
    },
    ...real.map(
      (a): TaskStep => ({
        id: a.id,
        kind: 'agent',
        // The executor map looks up by step.id; the AgentDef body isn't
        // consulted here. Synthesize a minimal placeholder.
        config: { agent: { id: a.id } as AgentDef },
      }),
    ),
  ];
  const edges: Edge[] = [];
  let prev = TRIGGER_ID;
  for (const a of real) {
    edges.push({ from: prev, to: a.id, type: 'sequence' });
    prev = a.id;
  }
  return { id, nodes, edges };
}
