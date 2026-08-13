/**
 * `kind: 'subflow'` step-kind executor + compile-time validator.
 *
 * v2 scope (this file):
 *   - Compose flows of ANY step kind — including agent nodes (executors
 *     supplied via `SubflowCompileDeps.agentExecutorFactory`; JobRecord
 *     registration recurses via flow-spec's `walkAgents(flow, resolver)`).
 *   - Approval / Suspend tags inside subflows: interrupt PROPAGATION.
 *     An interrupt-bearing inner compiles as a subgraph (no own
 *     checkpointer) and is invoked with the parent node's config
 *     (getConfig()), so LangGraph namespaces the inner's checkpoints
 *     under the parent's thread and propagates GraphInterrupt natively:
 *     the parent invoke surfaces `__interrupt__` with the inner payload,
 *     and Command({resume}) routes back to the deepest pending inner —
 *     multi-pause and nested-subflow pauses both resume in order. The
 *     server's pause/resume machinery is unchanged.
 *
 * Remaining v2 limits (enforced at parent-compile time by
 * `validateSubflowGraph` — authors learn at compile, not at the first
 * subflow tick):
 *   - A loop-tagged subflow node may not target an interrupt-bearing
 *     inner tree (loop iterations re-enter the node inside ONE node
 *     execution; the parent-config checkpoint namespace can't tell
 *     iterations apart, so pauses would collide).
 *   - Agent ids must be unique across the whole subflow tree (the
 *     JobRecord's RegisteredAgent lookup is flat, keyed by id).
 *
 * State flow:
 *   parent.state.output            ─►  inner.state.output  (passthrough)
 *   parent.state.changedFiles      ─►  inner.state.changedFiles
 *   parent.state.steering          ─►  inner.state.steering
 *   parent.state.cancelRequested   ─►  inner.state.cancelRequested
 *                                  ◄─  inner.state.output       (replaces parent)
 *                                  ◄─  inner.state.changedFiles (merged)
 *                                  ◄─  inner.state.steering     (appended)
 *
 * If `SubflowConfig.input` is set, its values are Expression-resolved
 * against the parent state, JSON-stringified, and used as the inner's
 * initial `output` (overriding the passthrough). Catalog authors who
 * need richer shaping should use a `transform` step before the subflow.
 */
import { getConfig, isGraphInterrupt } from '@langchain/langgraph';
import {
  CatalogError,
  type Expression,
  type FlowDef,
  type SubflowConfig,
  type TaskStep,
} from './catalog.ts';
import {
  type CompileFlowOptions,
  compileFlow,
  type FlowStateT,
  type NodeExecutor,
} from './flow-graph.ts';
import type { CompiledFlowGraph } from './orchestrator.ts';

/**
 * Resolves a `flowId` to its `FlowDef`. Same shape pattern as
 * `ToolResolver`. Returns undefined for unknown ids; the validator
 * surfaces missing flowIds as CatalogError at compile time.
 */
export type FlowResolver = (flowId: string) => FlowDef | undefined;

/**
 * Does this flow's tree (itself + transitively resolvable subflow
 * targets) contain any Approval/Suspend tag? Decides per-child whether
 * the inner compiles as a subgraph with interrupt propagation or keeps
 * the isolated fast path. Unresolvable targets are treated as
 * interrupt-free — `validateSubflowGraph` rejects those separately.
 */
export function treeHasInterruptTags(
  flow: FlowDef,
  resolver: FlowResolver,
  visited: Set<string> = new Set(),
): boolean {
  if (visited.has(flow.id)) return false;
  visited.add(flow.id);
  for (const node of flow.nodes) {
    if (node.tags?.approval || node.tags?.suspend) return true;
    if (node.kind === 'subflow') {
      const inner = resolver((node.config as SubflowConfig).flowId);
      if (inner && treeHasInterruptTags(inner, resolver, visited)) return true;
    }
  }
  return false;
}

/**
 * Walk a parent flow's subflow nodes and validate each inner target
 * recursively. Surfaces cycles, missing flow ids, and the two
 * remaining v2 limits (loop-tagged subflow node over an interrupt-
 * bearing inner tree; duplicate agent ids across the tree) as
 * CatalogError. Catalog authors learn at compile time rather than at
 * first subflow execution.
 *
 * Returns a Map<parentNodeId, FlowDef> of the parent's *direct*
 * subflow children. Nested subflows are validated as part of the
 * recursive walk but NOT included in the returned map — the recursion
 * inside `compileInnerFlow` discovers them again at each level when
 * it builds executors.
 */
export function validateSubflowGraph(
  parent: FlowDef,
  resolver: FlowResolver,
): Map<string, FlowDef> {
  const directChildren = new Map<string, FlowDef>();
  // Agent ids must be unique across the WHOLE tree — the JobRecord's
  // RegisteredAgent list is flat and executors look agents up by id.
  // Each flow is agent-checked once: a flow shared by two subflow
  // nodes is one flow with one set of agents (registered once via
  // walkAgents' same dedupe), not a duplication.
  const agentIdsSeen = new Map<string, string>(); // agent id → first location
  const agentCheckedFlows = new Set<string>();

  function checkAgentIds(flow: FlowDef, where: string): void {
    if (agentCheckedFlows.has(flow.id)) return;
    agentCheckedFlows.add(flow.id);
    for (const node of flow.nodes) {
      if (node.kind !== 'agent') continue;
      const prior = agentIdsSeen.get(node.id);
      if (prior) {
        throw new CatalogError(
          `${where}.nodes["${node.id}"]: duplicate agent id "${node.id}" across the subflow tree (first seen at ${prior}) — RegisteredAgent lookup is flat, so every agent id must be unique across parent and inner flows`,
        );
      }
      agentIdsSeen.set(node.id, `${where}.nodes["${node.id}"]`);
    }
  }

  function walk(
    flow: FlowDef,
    where: string,
    ancestorIds: ReadonlySet<string>,
    isRoot: boolean,
  ): void {
    const nextAncestors = new Set([...ancestorIds, flow.id]);
    checkAgentIds(flow, where);

    for (const node of flow.nodes) {
      if (node.kind !== 'subflow') continue;
      const cfg = node.config as SubflowConfig;
      const innerId = cfg.flowId;
      const at = `${where}.nodes["${node.id}"]`;

      if (ancestorIds.has(innerId) || innerId === flow.id) {
        throw new CatalogError(
          `${at} subflow.flowId "${innerId}" forms a cycle (already present in parent chain: ${[...nextAncestors].join(' → ')})`,
        );
      }

      const inner = resolver(innerId);
      if (!inner) {
        throw new CatalogError(
          `${at} subflow.flowId "${innerId}" did not resolve — flow not found in catalog`,
        );
      }

      // Loop iterations re-enter the subflow node within ONE node
      // execution, so the parent-config checkpoint namespace cannot
      // tell iterations apart — inner pauses would collide. Reject
      // the combination rather than corrupt resume routing.
      if (node.tags?.loop && treeHasInterruptTags(inner, resolver)) {
        throw new CatalogError(
          `${at}: loop-tagged subflow node targets "${innerId}", whose tree contains approval/suspend tags — a looped subflow cannot propagate interrupts (iterations would share one pause namespace); move the HITL gate out of the loop or drop the loop tag`,
        );
      }

      // Only the parent's direct subflow children land in the
      // returned map. Deeper levels are still validated via recursion,
      // but the orchestrator's compileInnerFlow rediscovers them
      // when it walks each inner level.
      if (isRoot) {
        directChildren.set(node.id, inner);
      }

      walk(inner, `${at}.subflow:${innerId}`, nextAncestors, false);
    }
  }

  walk(parent, `flow:${parent.id}`, new Set(), true);
  return directChildren;
}

/**
 * Build the per-node executor for a `kind: 'subflow'` TaskStep. The
 * caller (orchestrator.runJob) is responsible for:
 *   1. Calling validateSubflowGraph to surface compile errors.
 *   2. Pre-compiling each inner FlowDef into a CompiledFlowGraph
 *      (typically via compileFlow with the parent's executor map
 *      filtered to inner nodes — though for v1's banned-kind set,
 *      no filter is needed: gate/transform/tool/trigger executors
 *      either come from builtins or from the supplied tool resolver).
 *   3. Passing the compiled inner graph in here.
 *
 * Returns a NodeExecutor with the same shape as agent / tool / gate
 * executors (partial-state delta with lastExit).
 */
export function makeSubflowExecutor(
  node: TaskStep,
  innerGraph: CompiledFlowGraph,
  opts?: {
    /** The inner tree contains approval/suspend tags: invoke the inner
     *  with the PARENT node's config (getConfig()) so its checkpoints
     *  namespace under the parent thread and its GraphInterrupt
     *  propagates up (rethrown, never mapped to SubflowError). On
     *  parent resume the node re-executes, the inner resumes from its
     *  namespaced checkpoint, and interrupt() returns the resume
     *  value — LangGraph's native subgraph pause machinery. */
    propagateInterrupts?: boolean;
  },
): NodeExecutor {
  if (node.kind !== 'subflow') {
    throw new Error(
      `makeSubflowExecutor: node "${node.id}" has kind "${node.kind}", expected "subflow"`,
    );
  }
  const config = node.config as SubflowConfig;
  const nodeId = node.id;
  const propagateInterrupts = opts?.propagateInterrupts === true;
  // Per-executor invocation counter so Loop+subflow gets a fresh
  // checkpoint thread per iteration rather than reusing the prior
  // pause state. Closure-local state is fine — the executor is built
  // once per parent-job invocation. (Isolated path only: the
  // interrupt-propagating path derives its identity from the parent
  // config, and a counter would break resume — the node re-executes
  // per resume, and its inner must map to the SAME namespace.)
  let invocationCount = 0;

  return async (state) => {
    invocationCount += 1;
    // Isolated path: a deterministic-but-unique thread_id per inner
    // invocation (`${parentJobId}::sub::${parentNodeId}::${seq}` —
    // `::sub::` marks nested threads in checkpointer logs).
    // Propagating path: the parent node's own config, so LangGraph
    // namespaces the inner's checkpoints under the parent thread and
    // routes Command({resume}) back into it.
    const innerConfig = propagateInterrupts
      ? getConfig()
      : { configurable: { thread_id: `${state.jobId}::sub::${nodeId}::${invocationCount}` } };

    // Build inner initial state. Passthrough is the default; an
    // explicit SubflowConfig.input overrides the inner's starting
    // `output` after Expression resolution.
    let innerOutput = state.output;
    if (config.input !== undefined) {
      try {
        innerOutput = stringifyInputOverride(config.input, state);
      } catch (err) {
        return {
          lastExit: {
            nodeId,
            kind: 'error',
            errorName: 'SubflowInputResolutionError',
            errorMessage: (err as Error).message,
          },
        };
      }
    }

    const initialState = {
      jobId: state.jobId,
      output: innerOutput,
      messages: [],
      attempts: {},
      lastExit: null,
      rejectionPayload: null,
      // Pass-down on entry; merge-up on exit.
      steering: state.steering,
      cancelRequested: state.cancelRequested,
      cancelReason: state.cancelReason,
      changedFiles: state.changedFiles,
    };

    let result: Record<string, unknown>;
    try {
      result = await innerGraph.invoke(initialState, innerConfig);
    } catch (err) {
      // An inner pause is not an error: GraphInterrupt must reach the
      // parent graph untouched so the parent pauses (the wrapper chain
      // is already interrupt-transparent — withPolicy et al never
      // catch). Mapping it to SubflowError would silently swallow the
      // approval/suspend.
      if (isGraphInterrupt(err)) throw err;
      return {
        lastExit: {
          nodeId,
          kind: 'error',
          errorName: 'SubflowError',
          errorMessage: (err as Error).message,
        },
      };
    }

    // Map inner result back to a parent-state delta.
    //
    // Inner exits we treat as parent failure:
    //   - kind: 'error' — explicit error from any inner node
    //   - kind: 'reject' — gate rejected without a reject-edge handler
    //     in the inner flow. With no inner handler, the rejection is
    //     unhandled at the subflow boundary, so it propagates as a
    //     parent error. Catalog authors who want to recover should
    //     wire a reject edge inside the subflow.
    //
    // Both modes surface as `kind: 'error'` on the parent so the
    // parent's error edge (if any) catches them uniformly.
    const innerExit = result.lastExit as FlowStateT['lastExit'];
    if (innerExit?.kind === 'error') {
      return {
        lastExit: {
          nodeId,
          kind: 'error',
          errorName: innerExit.errorName ?? 'SubflowError',
          errorMessage:
            innerExit.errorMessage ?? `subflow "${config.flowId}" terminated with error`,
        },
      };
    }
    if (innerExit?.kind === 'reject') {
      const payload = result.rejectionPayload as { reason?: string } | null | undefined;
      return {
        lastExit: {
          nodeId,
          kind: 'error',
          errorName: 'SubflowRejected',
          errorMessage:
            payload?.reason ?? `subflow "${config.flowId}" had an unhandled gate rejection`,
        },
      };
    }

    const innerOutputOut = typeof result.output === 'string' ? result.output : '';
    const innerChangedFiles = Array.isArray(result.changedFiles) ? result.changedFiles : [];
    // steering deltas: only entries the inner ADDED (not the ones we
    // passed down). Compare lengths since the inner's reducer
    // appends — slice off the prefix we sent in.
    const innerSteeringFinal = Array.isArray(result.steering) ? (result.steering as string[]) : [];
    const newSteering = innerSteeringFinal.slice(state.steering.length);

    return {
      output: innerOutputOut,
      lastExit: { nodeId, kind: 'success' },
      ...(innerChangedFiles.length > 0 ? { changedFiles: innerChangedFiles } : {}),
      ...(newSteering.length > 0 ? { steering: newSteering } : {}),
    };
  };
}

/**
 * Resolve the `SubflowConfig.input` map against parent state and
 * return a single string suitable for the inner's initial `output`.
 *
 * Each value is either a literal (passed through) or an Expression
 * (jsonpath/literal — `js` throws as elsewhere). The whole map is
 * JSON-stringified so the inner sees a structured-but-string input;
 * inner steps that need fields can use `transform` with jsonpath
 * against `$.output` parsed as JSON.
 *
 * Why not pass the resolved object directly? Because the runtime
 * state's `output` channel is a string. Keeping types narrow at the
 * channel boundary saves a polymorphism story everywhere.
 */
function stringifyInputOverride(input: Record<string, unknown>, state: FlowStateT): string {
  const resolved: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    resolved[k] = isExpression(v) ? evalExpressionToValue(v, state) : v;
  }
  return JSON.stringify(resolved);
}

function isExpression(v: unknown): v is Expression {
  if (!v || typeof v !== 'object') return false;
  const k = (v as { kind?: unknown }).kind;
  return k === 'literal' || k === 'jsonpath' || k === 'js';
}

function evalExpressionToValue(expr: Expression, state: FlowStateT): unknown {
  if (expr.kind === 'literal') return expr.value;
  if (expr.kind === 'jsonpath') return resolveJsonPath(expr.path, state);
  throw new Error('"js" expression kind is not yet supported in subflow input');
}

function resolveJsonPath(path: string, state: unknown): unknown {
  if (path === '$') return state;
  if (!path.startsWith('$.')) return undefined;
  const parts = path.slice(2).split('.');
  let cur: unknown = state;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

/**
 * Dependencies needed to compile an inner subflow target. Mirrors the
 * agent-free subset of RunJobDeps from orchestrator.ts — kept narrow
 * so this helper doesn't pin agent / binding concerns. The
 * orchestrator passes a projection of its own RunJobDeps when
 * invoking.
 */
export interface SubflowCompileDeps {
  flowResolver?: FlowResolver;
  toolResolver?: import('./tool-executor.ts').ToolResolver;
  broker?: import('@helmsmith/agent-auth').CredentialBroker;
  fetchFn?: typeof fetch;
  mcpInvokeFn?: import('./tool-executor.ts').ToolExecutorDeps['mcpInvokeFn'];
  /** Builds the executor for a `kind: 'agent'` node (v2 — agents may
   *  live inside subflows). The orchestrator passes its own
   *  makeAgentExecutor closure so inner agents get the identical
   *  adapter-dispatch/fallback/JobRecord-status pipeline as parent
   *  agents. Absent → inner agent nodes fail loud with
   *  'UnconfiguredAgentFactory' (same pattern as toolResolver). */
  agentExecutorFactory?: (agentNodeId: string) => NodeExecutor;
  /** Checkpointer for the ROOT compile only (e.g. tests compiling a
   *  parent directly through this helper). Nested inner graphs never
   *  take it — interrupt-bearing inners compile as subgraphs
   *  (inheriting the parent's saver through config), and isolated
   *  inners keep their own default. */
  checkpointer?: CompileFlowOptions['checkpointer'];
}

/**
 * Compile a flow whose per-node executors this module can construct
 * itself — tool, subflow, and (v2) agent via the supplied factory;
 * gate / transform / trigger use flow-graph builtins. Recursively
 * compiles nested subflow targets.
 *
 * Checkpointer strategy per inner graph:
 *   - interrupt-bearing inner tree → compiled `asSubgraph` (no own
 *     checkpointer) and executed with the parent's config, so pauses
 *     persist into the parent's saver and resume through the parent's
 *     Command({resume}).
 *   - interrupt-free inner tree → own default saver + per-invocation
 *     thread ids (the v1 isolated path, unchanged — including under
 *     loop tags).
 * The ROOT compile takes `deps.checkpointer` (parents whose pauses
 * must survive restarts pass the durable saver — the orchestrator's
 * own parent compile path already does).
 *
 * Tool executors are constructed via a late-bound import from
 * `./tool-executor.ts` to avoid a static module cycle (subflow ↔
 * tool ↔ flow-graph). The dynamic require lands inside the function
 * body so it executes per-call after the modules have settled.
 */
export function compileInnerFlow(
  flow: FlowDef,
  deps: SubflowCompileDeps,
  internal?: { asSubgraph?: boolean },
): CompiledFlowGraph {
  // Late require: avoids the static cycle that would arise if we
  // imported makeToolExecutor at module scope (tool-executor →
  // catalog → flow-graph; subflow-executor → tool-executor would
  // close it). This stays within harness-core; no runtime overhead
  // beyond the first cache.
  const { makeToolExecutor } = require('./tool-executor.ts') as typeof import('./tool-executor.ts');

  const innerByNodeId = deps.flowResolver
    ? validateSubflowGraph(flow, deps.flowResolver)
    : new Map<string, FlowDef>();

  const nestedGraphs = new Map<string, CompiledFlowGraph>();
  const nestedPropagates = new Map<string, boolean>();
  for (const [nodeId, innerFlow] of innerByNodeId) {
    const propagates = deps.flowResolver
      ? treeHasInterruptTags(innerFlow, deps.flowResolver)
      : false;
    nestedPropagates.set(nodeId, propagates);
    nestedGraphs.set(
      nodeId,
      compileInnerFlow(innerFlow, { ...deps, checkpointer: undefined }, { asSubgraph: propagates }),
    );
  }

  const executors = new Map<string, NodeExecutor>();
  for (const node of flow.nodes) {
    if (node.kind === 'agent') {
      if (!deps.agentExecutorFactory) {
        const id = node.id;
        executors.set(id, async () => ({
          lastExit: {
            nodeId: id,
            kind: 'error',
            errorName: 'UnconfiguredAgentFactory',
            errorMessage: `agent node "${id}" inside subflow cannot dispatch — no agentExecutorFactory`,
          },
        }));
        continue;
      }
      executors.set(node.id, deps.agentExecutorFactory(node.id));
    } else if (node.kind === 'tool') {
      if (!deps.toolResolver) {
        const id = node.id;
        executors.set(id, async () => ({
          lastExit: {
            nodeId: id,
            kind: 'error',
            errorName: 'UnconfiguredToolResolver',
            errorMessage: `tool node "${id}" inside subflow cannot dispatch — no toolResolver`,
          },
        }));
        continue;
      }
      executors.set(
        node.id,
        makeToolExecutor(node, {
          toolResolver: deps.toolResolver,
          broker: deps.broker,
          fetchFn: deps.fetchFn,
          mcpInvokeFn: deps.mcpInvokeFn,
        }),
      );
    } else if (node.kind === 'subflow') {
      const innerGraph = nestedGraphs.get(node.id);
      if (!innerGraph) {
        // Defensive — validateSubflowGraph above must have produced
        // an entry for every subflow node it walked. If not, fail
        // loud rather than silently no-op the nested step.
        const id = node.id;
        executors.set(id, async () => ({
          lastExit: {
            nodeId: id,
            kind: 'error',
            errorName: 'SubflowMissing',
            errorMessage: `nested subflow "${id}" was not pre-compiled — programming error`,
          },
        }));
        continue;
      }
      executors.set(
        node.id,
        makeSubflowExecutor(node, innerGraph, {
          propagateInterrupts: nestedPropagates.get(node.id) === true,
        }),
      );
    }
    // gate / transform / trigger handled by flow-graph builtins.
    // script throws via flow-graph default.
  }

  return compileFlow({
    flow,
    executors,
    ...(internal?.asSubgraph
      ? { asSubgraph: true }
      : deps.checkpointer
        ? { checkpointer: deps.checkpointer }
        : {}),
  }) as CompiledFlowGraph;
}

/** @deprecated Renamed — inner flows may contain agents since v2. */
export const compileNonAgentFlow = compileInnerFlow;
