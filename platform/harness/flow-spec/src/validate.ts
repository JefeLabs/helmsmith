/**
 * Structural validation for the flow catalog. Moved verbatim from
 * harness-core's catalog.ts — fail-loud CatalogError with path-prefixed
 * messages so YAML/JSON sources surface bad-config locations.
 *
 * Only `validateFlowCatalog` and `validateUnifiedCatalog` are public;
 * the per-shape helpers stay module-private, as they were in
 * harness-core.
 */
import {
  type Catalog,
  CatalogError,
  type CompareOp,
  type FlowCatalog,
  type FlowDef,
} from './types.ts';

/**
 * A spec feature that validates but that the current runtime does not
 * execute. Reported through `ValidateOptions.onUnsupported` so loaders
 * can warn (harness-core's loadCatalog does, via console.warn) and
 * designer UIs can badge the node. Reporting never changes
 * accept/reject behavior — a catalog with unsupported features is
 * still a *valid* catalog; it just won't do everything it says.
 *
 * Current feature ids: `policy`, `joinStrategy`, `terminal-fail`,
 * `trigger-<kind>` (any non-manual trigger), `expression-js`,
 * `parallel-fan-out` (second+ sequence edge from one node),
 * `node-output-schema` (output.kind 'json' declares a schema — parse
 * happens, schema enforcement doesn't), `effect` (classification
 * recorded, not consulted on replay/retry), `subflow-version-pin`
 * (version recorded, resolution stays by flowId). Remove an id from
 * `reportUnsupportedFeatures` in the same change that makes the
 * runtime execute it — the reporting list IS the honest coverage
 * boundary.
 */
export interface UnsupportedFeature {
  /** Path-prefixed location, same convention as CatalogError messages. */
  where: string;
  /** Stable feature id (see list above). */
  feature: string;
  /** One sentence of runtime truth — what actually happens instead. */
  detail: string;
}

export interface ValidateOptions {
  onUnsupported?: (feature: UnsupportedFeature) => void;
}

export function validateFlowCatalog(
  value: unknown,
  path: string,
  opts?: ValidateOptions,
): asserts value is FlowCatalog {
  if (!value || typeof value !== 'object') {
    throw new CatalogError(`${path}: top-level must be an object`);
  }
  const obj = value as Record<string, unknown>;
  if (!Array.isArray(obj.flows)) {
    throw new CatalogError(`${path}: missing "flows" array`);
  }
  const ids = new Set<string>();
  for (const [i, f] of obj.flows.entries()) {
    validateFlow(f, `${path}: flows[${i}]`, opts);
    const flow = f as unknown as Record<string, unknown>;
    if (ids.has(flow.id as string)) {
      throw new CatalogError(`${path}: duplicate flow id "${flow.id}"`);
    }
    ids.add(flow.id as string);
  }
}

/**
 * Validate a single FlowDef: kind discriminator + output contract +
 * nodes (each TaskStep) + edges (referential integrity + cardinality
 * rules + acyclicity except along reject edges) + exactly-one-trigger.
 */
function validateFlow(
  value: unknown,
  where: string,
  opts?: ValidateOptions,
): asserts value is FlowDef {
  if (!value || typeof value !== 'object') {
    throw new CatalogError(`${where} must be an object`);
  }
  const flow = value as Record<string, unknown>;
  if (typeof flow.id !== 'string' || !flow.id) {
    throw new CatalogError(`${where}.id must be a non-empty string`);
  }
  if (flow.version !== undefined && (typeof flow.version !== 'string' || !flow.version)) {
    throw new CatalogError(`${where}.version must be a non-empty string when present`);
  }

  // kind discriminator (optional, default 'work')
  if (flow.kind !== undefined) {
    const validKinds = new Set(['work', 'job-definition', 'post-job']);
    if (typeof flow.kind !== 'string' || !validKinds.has(flow.kind)) {
      throw new CatalogError(
        `${where}.kind must be one of: ${[...validKinds].join(', ')} (got ${JSON.stringify(flow.kind)})`,
      );
    }
  }
  const kind = (flow.kind as string | undefined) ?? 'work';

  if (flow.output !== undefined) {
    validateFlowOutputContract(flow.output, `${where}.output`);
  }
  if (kind === 'job-definition') {
    const out = flow.output as { kind?: string } | undefined;
    if (!out || out.kind !== 'job-intent') {
      throw new CatalogError(`${where}: kind 'job-definition' requires output.kind 'job-intent'`);
    }
  }

  if (!Array.isArray(flow.nodes) || flow.nodes.length === 0) {
    throw new CatalogError(`${where}.nodes must be a non-empty array`);
  }
  if (!Array.isArray(flow.edges)) {
    throw new CatalogError(`${where}.edges must be an array (may be empty)`);
  }

  // Validate each node + collect ids
  const nodeIds = new Set<string>();
  const nodeKinds = new Map<string, string>();
  const nodeTags = new Map<string, Record<string, unknown> | undefined>();
  let triggerCount = 0;
  for (const [j, n] of (flow.nodes as unknown[]).entries()) {
    const nodeWhere = `${where}.nodes[${j}]`;
    validateNode(n, nodeWhere);
    const node = n as Record<string, unknown>;
    if (nodeIds.has(node.id as string)) {
      throw new CatalogError(`${where} has duplicate node id "${node.id}"`);
    }
    nodeIds.add(node.id as string);
    nodeKinds.set(node.id as string, node.kind as string);
    nodeTags.set(node.id as string, node.tags as Record<string, unknown> | undefined);
    if (node.kind === 'trigger') triggerCount++;
  }

  if (triggerCount === 0) {
    throw new CatalogError(`${where}: exactly one node must have kind 'trigger' (got 0)`);
  }
  if (triggerCount > 1) {
    throw new CatalogError(
      `${where}: exactly one node must have kind 'trigger' (got ${triggerCount})`,
    );
  }

  // Validate each edge + cardinality rules + referential integrity
  const outgoingByType = new Map<string, Map<string, number>>(); // from → (type → count)
  const incomingCount = new Map<string, number>();
  const errorCatchAllBySource = new Map<string, number>();
  for (const [j, e] of (flow.edges as unknown[]).entries()) {
    const edgeWhere = `${where}.edges[${j}]`;
    validateEdge(e, edgeWhere);
    const edge = e as Record<string, unknown>;
    if (!nodeIds.has(edge.from as string)) {
      throw new CatalogError(`${edgeWhere}.from references unknown node "${edge.from}"`);
    }
    if (!nodeIds.has(edge.to as string)) {
      throw new CatalogError(`${edgeWhere}.to references unknown node "${edge.to}"`);
    }
    const fromMap = outgoingByType.get(edge.from as string) ?? new Map<string, number>();
    fromMap.set(edge.type as string, (fromMap.get(edge.type as string) ?? 0) + 1);
    outgoingByType.set(edge.from as string, fromMap);
    incomingCount.set(edge.to as string, (incomingCount.get(edge.to as string) ?? 0) + 1);

    // Edge-cardinality rules. Error edges: any number of named ones
    // (`on` matchers), at most one catch-all (no/empty `on`) — the
    // router falls back to the catch-all when no matcher hits.
    if (edge.type === 'error') {
      const on = edge.on as unknown[] | undefined;
      if (on === undefined || on.length === 0) {
        const n = (errorCatchAllBySource.get(edge.from as string) ?? 0) + 1;
        errorCatchAllBySource.set(edge.from as string, n);
        if (n > 1) {
          throw new CatalogError(
            `${edgeWhere}: at most one catch-all 'error' edge (no "on" list) allowed per source node`,
          );
        }
      }
    }
    if (edge.type === 'fallback' && (fromMap.get('fallback') ?? 0) > 1) {
      throw new CatalogError(`${edgeWhere}: at most one 'fallback' edge allowed per source node`);
    }
    if (edge.type === 'reject' && (fromMap.get('reject') ?? 0) > 1) {
      throw new CatalogError(`${edgeWhere}: at most one 'reject' edge allowed per source node`);
    }

    // Reject edges may only originate from gate or approval-tagged nodes
    if (edge.type === 'reject') {
      const fromKind = nodeKinds.get(edge.from as string);
      const fromTags = nodeTags.get(edge.from as string);
      const isGate = fromKind === 'gate';
      const hasApproval = !!(fromTags && (fromTags as Record<string, unknown>).approval);
      if (!isGate && !hasApproval) {
        throw new CatalogError(
          `${edgeWhere}: reject edges may only originate from kind:'gate' nodes or Approval-tagged nodes (source "${edge.from}" is kind:'${fromKind}' without approval tag)`,
        );
      }

      // onMaxAttempts.escalate target must be a known node
      if (edge.onMaxAttempts !== undefined) {
        const oma = edge.onMaxAttempts as Record<string, unknown>;
        if (oma.kind === 'escalate' && typeof oma.to === 'string' && !nodeIds.has(oma.to)) {
          throw new CatalogError(
            `${edgeWhere}.onMaxAttempts.to references unknown node "${oma.to}"`,
          );
        }
      }
    }
  }

  // Trigger constraints: no incoming edges, ≥1 outgoing
  for (const node of flow.nodes as Array<Record<string, unknown>>) {
    if (node.kind !== 'trigger') continue;
    if ((incomingCount.get(node.id as string) ?? 0) > 0) {
      throw new CatalogError(`${where}: trigger node "${node.id}" must have no incoming edges`);
    }
    const out = outgoingByType.get(node.id as string);
    const totalOut = out ? [...out.values()].reduce((a, b) => a + b, 0) : 0;
    if (totalOut === 0) {
      throw new CatalogError(
        `${where}: trigger node "${node.id}" must have at least one outgoing edge`,
      );
    }
  }

  // DAG check: only reject edges may form cycles. Run cycle detection
  // on the (sequence | conditional | fallback | error) sub-graph.
  const dagAdjacency = new Map<string, string[]>();
  for (const e of flow.edges as Array<Record<string, unknown>>) {
    if (e.type === 'reject') continue; // reject edges are cycle-allowed
    const from = e.from as string;
    const to = e.to as string;
    const list = dagAdjacency.get(from) ?? [];
    list.push(to);
    dagAdjacency.set(from, list);
  }
  if (hasCycle(dagAdjacency)) {
    throw new CatalogError(
      `${where}: cycle detected on non-reject edges (only reject edges may form cycles for retry-with-context loops)`,
    );
  }

  if (opts?.onUnsupported) {
    reportUnsupportedFeatures(flow, where, opts.onUnsupported);
  }
}

/**
 * Post-validation scan for spec features the runtime does not execute.
 * Runs only when a callback is supplied, on a flow that already passed
 * structural validation — so casts here are safe. Kept separate from
 * the shape validators above so the moved-verbatim validation logic
 * stays byte-comparable with its harness-core history.
 */
function reportUnsupportedFeatures(
  flow: Record<string, unknown>,
  where: string,
  report: (f: UnsupportedFeature) => void,
): void {
  for (const [j, n] of (flow.nodes as unknown[]).entries()) {
    const node = n as Record<string, unknown>;
    const at = `${where}.nodes[${j}]`;
    if (node.policy !== undefined) {
      report({
        where: at,
        feature: 'policy',
        detail:
          'retry/timeout/onError are not enforced — the node runs once with executor-default timeouts and errors follow edges',
      });
    }
    if (node.joinStrategy !== undefined) {
      report({
        where: at,
        feature: 'joinStrategy',
        detail: 'multiple incoming edges use LangGraph defaults; all/any/nOfM is not implemented',
      });
    }
    if (node.terminal === 'fail') {
      report({
        where: at,
        feature: 'terminal-fail',
        detail: 'terminal nodes always end the flow as success',
      });
    }
    if (node.kind === 'trigger') {
      const kind = (node.config as Record<string, unknown>).kind;
      if (kind !== 'manual') {
        report({
          where: `${at}.config`,
          feature: `trigger-${String(kind)}`,
          detail: 'no runtime fires this trigger; jobs start by manual submission',
        });
      }
    }
    const output = node.output as Record<string, unknown> | undefined;
    if (output?.kind === 'json' && output.schema !== undefined) {
      report({
        where: `${at}.output.schema`,
        feature: 'node-output-schema',
        detail:
          'JSON output is parsed into state.nodes, but the declared schema is not validated against it yet',
      });
    }
    if (node.effect !== undefined) {
      report({
        where: at,
        feature: 'effect',
        detail:
          'effect classification is recorded but the runtime does not yet consult it for replay/retry decisions',
      });
    }
    if (node.kind === 'subflow' && (node.config as Record<string, unknown>).version !== undefined) {
      report({
        where: `${at}.config.version`,
        feature: 'subflow-version-pin',
        detail:
          'subflows resolve by flowId in the loaded catalog; the version pin is recorded but not enforced',
      });
    }
  }

  // Second+ sequence edge from one source node is silently ignored by
  // the runtime router (it follows the first). One report per source.
  const sequenceSources = new Map<string, number>();
  for (const e of flow.edges as Array<Record<string, unknown>>) {
    if (e.type !== 'sequence') continue;
    const from = e.from as string;
    sequenceSources.set(from, (sequenceSources.get(from) ?? 0) + 1);
  }
  for (const [from, count] of sequenceSources) {
    if (count > 1) {
      report({
        where: `${where}.edges (from "${from}")`,
        feature: 'parallel-fan-out',
        detail: `the router follows only the first sequence edge from a node; ${count - 1} of ${count} branches will never run`,
      });
    }
  }

  scanForJsExpressions(flow, where, report);
}

/**
 * Recursive walk for `{ kind: 'js', expression: '...' }` anywhere in a
 * flow — configs, tags, edge conditions, tool args. The evaluator
 * throws on these at runtime, so surface them at load time instead.
 */
function scanForJsExpressions(
  value: unknown,
  path: string,
  report: (f: UnsupportedFeature) => void,
): void {
  if (Array.isArray(value)) {
    for (const [i, item] of value.entries()) {
      scanForJsExpressions(item, `${path}[${i}]`, report);
    }
    return;
  }
  if (!value || typeof value !== 'object') return;
  const obj = value as Record<string, unknown>;
  if (obj.kind === 'js' && typeof obj.expression === 'string') {
    report({
      where: path,
      feature: 'expression-js',
      detail: 'the evaluator throws on js expressions; compose compare/all/any/not instead',
    });
    return;
  }
  for (const [key, sub] of Object.entries(obj)) {
    scanForJsExpressions(sub, `${path}.${key}`, report);
  }
}

/**
 * DFS cycle detection. Returns true if any cycle exists in the directed
 * adjacency. Used to enforce "non-reject edges form a DAG" constraint.
 */
function hasCycle(adjacency: Map<string, string[]>): boolean {
  const WHITE = 0;
  const _GRAY = 1;
  const _BLACK = 2;
  const color = new Map<string, number>();
  for (const node of adjacency.keys()) color.set(node, WHITE);
  for (const node of adjacency.keys()) {
    if (color.get(node) === WHITE) {
      if (dfsCycle(node, adjacency, color)) return true;
    }
  }
  return false;
}

function dfsCycle(
  node: string,
  adjacency: Map<string, string[]>,
  color: Map<string, number>,
): boolean {
  color.set(node, 1); // gray
  for (const next of adjacency.get(node) ?? []) {
    const c = color.get(next) ?? 0;
    if (c === 1) return true; // back edge — cycle
    if (c === 0 && dfsCycle(next, adjacency, color)) return true;
  }
  color.set(node, 2); // black
  return false;
}

/**
 * Validate a single AgentDef. Centralized so legacy `agents[]` and new
 * `AgentStep` validation share the same rules. `agentIds` is a per-pipeline
 * set tracking already-seen agent ids for duplicate detection.
 */
function validateAgentDef(value: unknown, where: string, agentIds: Set<string>): void {
  if (!value || typeof value !== 'object') {
    throw new CatalogError(`${where} must be an object`);
  }
  const agent = value as Record<string, unknown>;
  if (typeof agent.id !== 'string' || !agent.id) {
    throw new CatalogError(`${where}.id must be a non-empty string`);
  }
  if (agentIds.has(agent.id)) {
    throw new CatalogError(`${where} has duplicate agent id "${agent.id}"`);
  }
  agentIds.add(agent.id);
  if (typeof agent.role !== 'string' || !agent.role) {
    throw new CatalogError(`${where}.role must be a non-empty string`);
  }
  if (agent.adapter !== 'claude-sdk' && agent.adapter !== 'opencode-cli') {
    throw new CatalogError(`${where}.adapter must be "claude-sdk" or "opencode-cli"`);
  }
  if (agent.systemPrompt !== undefined && typeof agent.systemPrompt !== 'string') {
    throw new CatalogError(`${where}.systemPrompt must be a string`);
  }
  if (agent.accepts !== undefined) {
    validateAcceptsField(agent.accepts, `${where}.accepts`);
  }
  if (agent.fallbackOn !== undefined) {
    validateFallbackOnField(agent.fallbackOn, `${where}.fallbackOn`);
  }
  if (agent.skillz !== undefined) {
    validateSkillzField(agent.skillz, `${where}.skillz`);
  }
}

/**
 * Validate a single TaskStep (node). Checks `kind` discriminator, per-kind
 * config shape, optional tags (approval/suspend/loop), optional policy,
 * optional joinStrategy, optional terminal field.
 */
const VALID_NODE_KINDS = new Set([
  'agent',
  'tool',
  'script',
  'transform',
  'gate',
  'subflow',
  'trigger',
  'publish',
]);

const VALID_PUBLISH_ACTIONS = new Set(['push-and-open-pr', 'merge-pr']);

function validateNode(value: unknown, where: string): void {
  if (!value || typeof value !== 'object') {
    throw new CatalogError(`${where} must be an object`);
  }
  const node = value as Record<string, unknown>;
  if (typeof node.id !== 'string' || !node.id) {
    throw new CatalogError(`${where}.id must be a non-empty string`);
  }
  if (typeof node.kind !== 'string' || !VALID_NODE_KINDS.has(node.kind)) {
    throw new CatalogError(
      `${where}.kind must be one of: ${[...VALID_NODE_KINDS].join(', ')} (got ${JSON.stringify(node.kind)})`,
    );
  }
  if (!node.config || typeof node.config !== 'object') {
    throw new CatalogError(`${where}.config must be an object`);
  }
  validateNodeConfig(node.kind, node.config, `${where}.config`);

  if (node.input !== undefined) {
    validateInputMapping(node.input, `${where}.input`);
  }
  if (node.output !== undefined) {
    validateNodeOutputContract(node.output, `${where}.output`);
  }
  if (
    node.effect !== undefined &&
    node.effect !== 'pure' &&
    node.effect !== 'idempotent' &&
    node.effect !== 'side-effecting'
  ) {
    throw new CatalogError(
      `${where}.effect must be 'pure', 'idempotent', or 'side-effecting' when present`,
    );
  }
  if (node.tags !== undefined) {
    validateTaskStepTags(node.tags, `${where}.tags`);
  }
  if (node.policy !== undefined) {
    validateTaskStepPolicy(node.policy, `${where}.policy`);
  }
  if (node.joinStrategy !== undefined) {
    validateJoinStrategy(node.joinStrategy, `${where}.joinStrategy`);
  }
  if (node.terminal !== undefined && node.terminal !== 'success' && node.terminal !== 'fail') {
    throw new CatalogError(`${where}.terminal must be 'success' or 'fail' when present`);
  }
}

/**
 * Validate `TaskStep.input` — either a single Expression (detected by a
 * string `kind` field, which is why mapping keys must not be named
 * "kind") or a non-empty Record of name → Expression.
 */
function validateInputMapping(value: unknown, where: string): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CatalogError(`${where} must be an Expression or an object mapping name → Expression`);
  }
  const obj = value as Record<string, unknown>;
  if (typeof obj.kind === 'string') {
    validateExpression(obj, where);
    return;
  }
  const keys = Object.keys(obj);
  if (keys.length === 0) {
    throw new CatalogError(`${where} must declare at least one entry`);
  }
  for (const key of keys) {
    validateExpression(obj[key], `${where}.${key}`);
  }
}

function validateNodeOutputContract(value: unknown, where: string): void {
  if (!value || typeof value !== 'object') {
    throw new CatalogError(`${where} must be an object`);
  }
  const o = value as Record<string, unknown>;
  if (o.kind !== 'text' && o.kind !== 'json') {
    throw new CatalogError(`${where}.kind must be 'text' or 'json' (got ${JSON.stringify(o.kind)})`);
  }
  if (o.kind === 'text' && o.schema !== undefined) {
    throw new CatalogError(`${where}.schema is only allowed when kind is 'json'`);
  }
}

function validateNodeConfig(kind: string, config: object, where: string): void {
  const c = config as Record<string, unknown>;
  switch (kind) {
    case 'agent': {
      const agentIds = new Set<string>();
      validateAgentDef(c.agent, `${where}.agent`, agentIds);
      break;
    }
    case 'tool':
      if (typeof c.toolId !== 'string' || !c.toolId) {
        throw new CatalogError(`${where}.toolId must be a non-empty string`);
      }
      break;
    case 'script':
      if (c.language !== 'bash' && c.language !== 'node' && c.language !== 'python') {
        throw new CatalogError(
          `${where}.language must be one of: bash, node, python (got ${JSON.stringify(c.language)})`,
        );
      }
      if (typeof c.source !== 'string') {
        throw new CatalogError(`${where}.source must be a string`);
      }
      if (c.timeoutMs !== undefined && (typeof c.timeoutMs !== 'number' || c.timeoutMs <= 0)) {
        throw new CatalogError(`${where}.timeoutMs must be a positive number when present`);
      }
      if (c.secrets !== undefined) {
        if (!c.secrets || typeof c.secrets !== 'object' || Array.isArray(c.secrets)) {
          throw new CatalogError(
            `${where}.secrets must be an object mapping ENV_NAME → { credentialId }`,
          );
        }
        for (const [envName, ref] of Object.entries(c.secrets as Record<string, unknown>)) {
          if (!envName) {
            throw new CatalogError(`${where}.secrets has an empty env var name`);
          }
          const credentialId =
            ref && typeof ref === 'object'
              ? (ref as Record<string, unknown>).credentialId
              : undefined;
          if (typeof credentialId !== 'string' || !credentialId) {
            throw new CatalogError(
              `${where}.secrets.${envName}.credentialId must be a non-empty string`,
            );
          }
        }
      }
      break;
    case 'transform':
      validateExpression(c.expression, `${where}.expression`);
      break;
    case 'gate':
      if (!Array.isArray(c.assertions) || c.assertions.length === 0) {
        throw new CatalogError(`${where}.assertions must be a non-empty array`);
      }
      for (const [k, a] of (c.assertions as unknown[]).entries()) {
        if (!a || typeof a !== 'object') {
          throw new CatalogError(`${where}.assertions[${k}] must be an object`);
        }
        const assertion = a as Record<string, unknown>;
        validateExpression(assertion.expression, `${where}.assertions[${k}].expression`);
        if (typeof assertion.message !== 'string' || !assertion.message) {
          throw new CatalogError(`${where}.assertions[${k}].message must be a non-empty string`);
        }
      }
      break;
    case 'subflow':
      if (typeof c.flowId !== 'string' || !c.flowId) {
        throw new CatalogError(`${where}.flowId must be a non-empty string`);
      }
      if (c.version !== undefined && (typeof c.version !== 'string' || !c.version)) {
        throw new CatalogError(`${where}.version must be a non-empty string when present`);
      }
      break;
    case 'trigger':
      validateTriggerConfig(c, where);
      break;
    case 'publish':
      validatePublishConfig(c, where);
      break;
  }
}

function validatePublishConfig(c: Record<string, unknown>, where: string): void {
  if (typeof c.action !== 'string' || !VALID_PUBLISH_ACTIONS.has(c.action)) {
    throw new CatalogError(
      `${where}.action must be one of: ${[...VALID_PUBLISH_ACTIONS].join(', ')} (got ${JSON.stringify(c.action)})`,
    );
  }
  if (c.action === 'push-and-open-pr') {
    if (c.repo !== undefined && (typeof c.repo !== 'string' || !c.repo)) {
      throw new CatalogError(`${where}.repo must be a non-empty string when present`);
    }
    if (c.title !== undefined && typeof c.title !== 'string') {
      throw new CatalogError(`${where}.title must be a string when present`);
    }
    if (c.body !== undefined && typeof c.body !== 'string') {
      throw new CatalogError(`${where}.body must be a string when present`);
    }
    if (c.base !== undefined && (typeof c.base !== 'string' || !c.base)) {
      throw new CatalogError(`${where}.base must be a non-empty string when present`);
    }
    if (c.draft !== undefined && typeof c.draft !== 'boolean') {
      throw new CatalogError(`${where}.draft must be a boolean when present`);
    }
  } else {
    // merge-pr
    if (
      c.method !== undefined &&
      c.method !== 'merge' &&
      c.method !== 'squash' &&
      c.method !== 'rebase'
    ) {
      throw new CatalogError(
        `${where}.method must be one of: merge, squash, rebase (got ${JSON.stringify(c.method)})`,
      );
    }
    if (c.deleteBranch !== undefined && typeof c.deleteBranch !== 'boolean') {
      throw new CatalogError(`${where}.deleteBranch must be a boolean when present`);
    }
  }
}

function validateTriggerConfig(c: Record<string, unknown>, where: string): void {
  switch (c.kind) {
    case 'webhook':
      if (typeof c.path !== 'string' || !c.path) {
        throw new CatalogError(`${where}.path must be a non-empty string`);
      }
      if (c.method !== undefined && c.method !== 'GET' && c.method !== 'POST') {
        throw new CatalogError(`${where}.method must be 'GET' or 'POST' when present`);
      }
      break;
    case 'schedule':
      if (typeof c.cron !== 'string' || !c.cron) {
        throw new CatalogError(`${where}.cron must be a non-empty string`);
      }
      break;
    case 'manual':
      // No additional fields.
      break;
    case 'event':
      if (typeof c.eventType !== 'string' || !c.eventType) {
        throw new CatalogError(`${where}.eventType must be a non-empty string`);
      }
      if (c.matcher !== undefined) {
        validateExpression(c.matcher, `${where}.matcher`);
      }
      break;
    case 'message':
      if (typeof c.channel !== 'string' || !c.channel) {
        throw new CatalogError(`${where}.channel must be a non-empty string`);
      }
      break;
    default:
      throw new CatalogError(
        `${where}.kind must be one of: webhook, schedule, manual, event, message (got ${JSON.stringify(c.kind)})`,
      );
  }
}

function validateTaskStepTags(value: unknown, where: string): void {
  if (!value || typeof value !== 'object') {
    throw new CatalogError(`${where} must be an object`);
  }
  const tags = value as Record<string, unknown>;
  if (tags.approval !== undefined && tags.suspend !== undefined) {
    throw new CatalogError(
      `${where}: approval and suspend tags are mutually exclusive on the same node`,
    );
  }
  if (tags.approval !== undefined) {
    validateApprovalTag(tags.approval, `${where}.approval`);
  }
  if (tags.suspend !== undefined) {
    validateSuspendTag(tags.suspend, `${where}.suspend`);
  }
  if (tags.loop !== undefined) {
    validateLoopTag(tags.loop, `${where}.loop`);
  }
}

function validateApprovalTag(value: unknown, where: string): void {
  if (!value || typeof value !== 'object') {
    throw new CatalogError(`${where} must be an object`);
  }
  const t = value as Record<string, unknown>;
  if (typeof t.assigneeRole !== 'string' || !t.assigneeRole) {
    throw new CatalogError(`${where}.assigneeRole must be a non-empty string`);
  }
  if (typeof t.slaMs !== 'number' || t.slaMs <= 0) {
    throw new CatalogError(`${where}.slaMs must be a positive number`);
  }
  if (t.concurrency !== 'pessimistic') {
    throw new CatalogError(
      `${where}.concurrency must be 'pessimistic' (only mode supported in v1)`,
    );
  }
}

function validateSuspendTag(value: unknown, where: string): void {
  if (!value || typeof value !== 'object') {
    throw new CatalogError(`${where} must be an object`);
  }
  const t = value as Record<string, unknown>;
  if (!t.trigger || typeof t.trigger !== 'object') {
    throw new CatalogError(`${where}.trigger must be an object`);
  }
  const trig = t.trigger as Record<string, unknown>;
  if (trig.kind === 'timer') {
    if (typeof trig.durationMs !== 'number' || trig.durationMs <= 0) {
      throw new CatalogError(`${where}.trigger.durationMs must be a positive number`);
    }
  } else if (trig.kind === 'event') {
    if (typeof trig.eventType !== 'string' || !trig.eventType) {
      throw new CatalogError(`${where}.trigger.eventType must be a non-empty string`);
    }
    if (trig.matcher !== undefined) {
      validateExpression(trig.matcher, `${where}.trigger.matcher`);
    }
  } else {
    throw new CatalogError(
      `${where}.trigger.kind must be 'timer' or 'event' (got ${JSON.stringify(trig.kind)})`,
    );
  }
}

function validateLoopTag(value: unknown, where: string): void {
  if (!value || typeof value !== 'object') {
    throw new CatalogError(`${where} must be an object`);
  }
  const t = value as Record<string, unknown>;
  if (t.source !== 'collection' && t.source !== 'directory') {
    throw new CatalogError(
      `${where}.source must be 'collection' or 'directory' (got ${JSON.stringify(t.source)})`,
    );
  }
  validateExpression(t.path, `${where}.path`);
  if (t.mode !== 'sequential' && t.mode !== 'parallel') {
    throw new CatalogError(
      `${where}.mode must be 'sequential' or 'parallel' (got ${JSON.stringify(t.mode)})`,
    );
  }
  if (t.concurrency !== undefined && (typeof t.concurrency !== 'number' || t.concurrency <= 0)) {
    throw new CatalogError(`${where}.concurrency must be a positive number when present`);
  }
}

function validateTaskStepPolicy(value: unknown, where: string): void {
  if (!value || typeof value !== 'object') {
    throw new CatalogError(`${where} must be an object`);
  }
  const p = value as Record<string, unknown>;
  if (p.retry !== undefined) {
    if (!p.retry || typeof p.retry !== 'object') {
      throw new CatalogError(`${where}.retry must be an object`);
    }
    const r = p.retry as Record<string, unknown>;
    if (typeof r.maxAttempts !== 'number' || r.maxAttempts <= 0) {
      throw new CatalogError(`${where}.retry.maxAttempts must be a positive number`);
    }
  }
  if (p.timeout !== undefined && (typeof p.timeout !== 'number' || p.timeout < 0)) {
    throw new CatalogError(`${where}.timeout must be a non-negative number when present`);
  }
  if (p.onError !== undefined) {
    const validOnError = new Set(['propagate', 'continue', 'fallback']);
    if (typeof p.onError !== 'string' || !validOnError.has(p.onError)) {
      throw new CatalogError(
        `${where}.onError must be one of: ${[...validOnError].join(', ')} (got ${JSON.stringify(p.onError)})`,
      );
    }
  }
}

function validateJoinStrategy(value: unknown, where: string): void {
  if (value === 'all' || value === 'any') return;
  if (value && typeof value === 'object') {
    const v = value as Record<string, unknown>;
    if (typeof v.nOfM === 'number' && v.nOfM > 0) return;
  }
  throw new CatalogError(
    `${where} must be 'all', 'any', or { nOfM: <positive number> } (got ${JSON.stringify(value)})`,
  );
}

const VALID_COMPARE_OPS = new Set<CompareOp>([
  '==',
  '!=',
  '<',
  '<=',
  '>',
  '>=',
  'in',
  'contains',
  'startsWith',
  'endsWith',
  'matches',
]);

function validateExpression(value: unknown, where: string): void {
  if (!value || typeof value !== 'object') {
    throw new CatalogError(`${where} must be an Expression object`);
  }
  const e = value as Record<string, unknown>;
  switch (e.kind) {
    case 'jsonpath':
      if (typeof e.path !== 'string' || !e.path) {
        throw new CatalogError(`${where}.path must be a non-empty string`);
      }
      break;
    case 'js':
      if (typeof e.expression !== 'string' || !e.expression) {
        throw new CatalogError(`${where}.expression must be a non-empty string`);
      }
      break;
    case 'literal':
      if (!('value' in e)) throw new CatalogError(`${where}.value is required`);
      break;
    case 'compare':
      if (typeof e.op !== 'string' || !VALID_COMPARE_OPS.has(e.op as CompareOp)) {
        throw new CatalogError(
          `${where}.op must be one of: ${[...VALID_COMPARE_OPS].join(', ')} (got ${JSON.stringify(e.op)})`,
        );
      }
      validateExpression(e.lhs, `${where}.lhs`);
      validateExpression(e.rhs, `${where}.rhs`);
      // Load-time regex check for `matches` with a literal pattern —
      // the evaluator silently returns false on invalid patterns (it
      // never throws on data), so reject statically knowable typos here.
      if (e.op === 'matches') {
        const rhs = e.rhs as Record<string, unknown> | undefined;
        if (rhs && rhs.kind === 'literal' && typeof rhs.value === 'string') {
          try {
            new RegExp(rhs.value);
          } catch (err) {
            throw new CatalogError(
              `${where}.rhs is not a valid regular expression: ${(err as Error).message}`,
            );
          }
        }
      }
      break;
    case 'all':
    case 'any':
      if (!Array.isArray(e.exprs)) {
        throw new CatalogError(`${where}.exprs must be an array`);
      }
      // Empty arrays are allowed: `all([])` is the identity element
      // for AND (returns true); `any([])` is the identity element for
      // OR (returns false). Useful as a placeholder during catalog
      // development.
      for (const [i, sub] of (e.exprs as unknown[]).entries()) {
        validateExpression(sub, `${where}.exprs[${i}]`);
      }
      break;
    case 'not':
    case 'exists':
      validateExpression(e.expr, `${where}.expr`);
      break;
    case 'object': {
      if (!e.fields || typeof e.fields !== 'object' || Array.isArray(e.fields)) {
        throw new CatalogError(`${where}.fields must be an object of name → Expression`);
      }
      for (const [k, sub] of Object.entries(e.fields as Record<string, unknown>)) {
        validateExpression(sub, `${where}.fields.${k}`);
      }
      break;
    }
    case 'array':
      if (!Array.isArray(e.items)) {
        throw new CatalogError(`${where}.items must be an array`);
      }
      for (const [i, sub] of (e.items as unknown[]).entries()) {
        validateExpression(sub, `${where}.items[${i}]`);
      }
      break;
    default:
      throw new CatalogError(
        `${where}.kind must be one of: jsonpath, js, literal, compare, all, any, not, exists, object, array (got ${JSON.stringify(e.kind)})`,
      );
  }
}

function validateEdge(value: unknown, where: string): void {
  if (!value || typeof value !== 'object') {
    throw new CatalogError(`${where} must be an object`);
  }
  const edge = value as Record<string, unknown>;
  if (typeof edge.from !== 'string' || !edge.from) {
    throw new CatalogError(`${where}.from must be a non-empty string`);
  }
  if (typeof edge.to !== 'string' || !edge.to) {
    throw new CatalogError(`${where}.to must be a non-empty string`);
  }
  const validTypes = new Set(['sequence', 'conditional', 'fallback', 'error', 'reject']);
  if (typeof edge.type !== 'string' || !validTypes.has(edge.type)) {
    throw new CatalogError(
      `${where}.type must be one of: ${[...validTypes].join(', ')} (got ${JSON.stringify(edge.type)})`,
    );
  }
  if (edge.type === 'conditional') {
    validateExpression(edge.condition, `${where}.condition`);
  }
  if (edge.type === 'error' && edge.on !== undefined) {
    if (!Array.isArray(edge.on)) {
      throw new CatalogError(`${where}.on must be an array of error names when present`);
    }
    for (const [k, name] of (edge.on as unknown[]).entries()) {
      if (typeof name !== 'string' || !name) {
        throw new CatalogError(`${where}.on[${k}] must be a non-empty string`);
      }
    }
  }
  if (edge.type === 'reject') {
    if (
      edge.maxAttempts !== undefined &&
      (typeof edge.maxAttempts !== 'number' || edge.maxAttempts <= 0)
    ) {
      throw new CatalogError(`${where}.maxAttempts must be a positive number when present`);
    }
    if (edge.onMaxAttempts !== undefined) {
      if (!edge.onMaxAttempts || typeof edge.onMaxAttempts !== 'object') {
        throw new CatalogError(`${where}.onMaxAttempts must be an object when present`);
      }
      const oma = edge.onMaxAttempts as Record<string, unknown>;
      if (oma.kind === 'fail') {
        // OK
      } else if (oma.kind === 'escalate') {
        if (typeof oma.to !== 'string' || !oma.to) {
          throw new CatalogError(`${where}.onMaxAttempts.to must be a non-empty string`);
        }
      } else {
        throw new CatalogError(
          `${where}.onMaxAttempts.kind must be 'fail' or 'escalate' (got ${JSON.stringify(oma.kind)})`,
        );
      }
    }
  }
}

function validateFlowOutputContract(value: unknown, where: string): void {
  if (!value || typeof value !== 'object') {
    throw new CatalogError(`${where} must be an object`);
  }
  const o = value as Record<string, unknown>;
  const validKinds = new Set([
    'agent-text',
    'job-intent',
    'job-intents',
    'flow-spec',
    'structured',
  ]);
  if (typeof o.kind !== 'string' || !validKinds.has(o.kind)) {
    throw new CatalogError(
      `${where}.kind must be one of: ${[...validKinds].join(', ')} (got ${JSON.stringify(o.kind)})`,
    );
  }
  if (o.kind === 'job-intents') {
    if (o.min !== undefined && (typeof o.min !== 'number' || o.min < 0))
      throw new CatalogError(`${where}.min must be a non-negative number`);
    if (o.max !== undefined && (typeof o.max !== 'number' || o.max < 0))
      throw new CatalogError(`${where}.max must be a non-negative number`);
  }
  if (o.kind === 'structured' && o.schema === undefined) {
    throw new CatalogError(`${where}.schema is required`);
  }
}

/** Validate the optional `skillz` field on an AgentDef. Each category
 *  (tools, integrations, tasks, workflows) is optional; when present it
 *  must be an array of non-empty strings. Slug syntax is not validated
 *  here — that's a runtime concern of the procurement flow. */
function validateSkillzField(value: unknown, where: string): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new CatalogError(`${where} must be an object`);
  }
  const skillz = value as Record<string, unknown>;
  const validKeys = new Set(['routers', 'tools', 'integrations', 'tasks', 'workflows']);
  for (const key of Object.keys(skillz)) {
    if (!validKeys.has(key)) {
      throw new CatalogError(
        `${where} has unknown key "${key}"; allowed: ${[...validKeys].join(', ')}`,
      );
    }
    const list = skillz[key];
    if (list === undefined) continue;
    if (!Array.isArray(list)) {
      throw new CatalogError(`${where}.${key} must be an array of strings`);
    }
    for (const [k, slug] of list.entries()) {
      if (typeof slug !== 'string' || slug.length === 0) {
        throw new CatalogError(`${where}.${key}[${k}] must be a non-empty string`);
      }
    }
  }
}

/** Closed set of valid AdapterError names accepted in `fallbackOn`. Kept
 *  in sync with the class hierarchy in `agent-adapter/src/errors.ts`.
 *  We don't import from agent-adapter to avoid the package-graph cycle
 *  (harness-core ← agent-adapter); validation is done by string match. */
const VALID_FALLBACK_ERROR_NAMES = new Set<string>([
  'AdapterError', // wildcard — falls back on any classified error
  'AuthError',
  'BillingError',
  'RateLimitError',
  'ConfigError',
  'NetworkError',
  'ProviderError',
]);

function validateFallbackOnField(value: unknown, where: string): void {
  if (!Array.isArray(value)) {
    throw new CatalogError(
      `${where} must be an array of AdapterError subclass names ` +
        `(e.g., ["BillingError", "RateLimitError"]) — got ${typeof value}`,
    );
  }
  for (const [k, entry] of value.entries()) {
    if (typeof entry !== 'string' || !entry) {
      throw new CatalogError(`${where}[${k}] must be a non-empty string`);
    }
    if (!VALID_FALLBACK_ERROR_NAMES.has(entry)) {
      throw new CatalogError(
        `${where}[${k}] = "${entry}" is not a known AdapterError subclass. ` +
          `Valid: ${[...VALID_FALLBACK_ERROR_NAMES].sort().join(', ')}`,
      );
    }
  }
}

/**
 * Validates either form of `accepts`: flat array of `<provider>:<model>`
 * strings, OR a Record mapping set name → array of the same shape.
 *
 * Each leaf entry must be a non-empty string with exactly one separating
 * colon and non-empty halves. Set names must be non-empty strings; the
 * Record must declare at least one set.
 */
function validateAcceptsField(value: unknown, where: string): void {
  if (Array.isArray(value)) {
    validateAcceptsList(value, where);
    return;
  }
  if (value && typeof value === 'object') {
    const sets = value as Record<string, unknown>;
    const setNames = Object.keys(sets);
    if (setNames.length === 0) {
      throw new CatalogError(`${where} must declare at least one set (got an empty object)`);
    }
    for (const setName of setNames) {
      if (!setName) {
        throw new CatalogError(`${where} has an empty set name`);
      }
      const list = sets[setName];
      if (!Array.isArray(list)) {
        throw new CatalogError(
          `${where}["${setName}"] must be an array of "<provider>:<model>" strings`,
        );
      }
      validateAcceptsList(list, `${where}["${setName}"]`);
    }
    return;
  }
  throw new CatalogError(
    `${where} must be an array of "<provider>:<model>" strings ` +
      `OR an object mapping set name → array of those strings`,
  );
}

function validateAcceptsList(list: unknown[], where: string): void {
  for (const [k, entry] of list.entries()) {
    if (typeof entry !== 'string' || !entry) {
      throw new CatalogError(`${where}[${k}] must be a non-empty string`);
    }
    const colon = entry.indexOf(':');
    if (colon <= 0 || colon === entry.length - 1) {
      throw new CatalogError(
        `${where}[${k}] must be of the form "<provider>:<model>" or ` +
          `"<tool>:<provider>:<model>" (got "${entry}")`,
      );
    }
  }
}

/**
 * Validates the unified Catalog shape. Reuses flow validation
 * (which is already comprehensive) and adds product-shape checks.
 * Caller-supplied path is included in error messages so YAML/JSON
 * sources surface bad-config locations without the validator needing
 * to know what kind of file it came from.
 */
export function validateUnifiedCatalog(
  value: unknown,
  path: string,
  opts?: ValidateOptions,
): asserts value is Catalog {
  if (!value || typeof value !== 'object') {
    throw new CatalogError(`${path}: top-level must be an object`);
  }
  const obj = value as Record<string, unknown>;
  // Flows is required (even if empty array — distinguishes "I have
  // no flows" from "I forgot the field").
  if (!Array.isArray(obj.flows)) {
    throw new CatalogError(`${path}: missing "flows" array (use [] for none)`);
  }
  // Re-use the flows-only validator.
  validateFlowCatalog({ flows: obj.flows }, path, opts);

  if (obj.products !== undefined) {
    if (!Array.isArray(obj.products)) {
      throw new CatalogError(`${path}: "products" must be an array if present`);
    }
    const ids = new Set<string>();
    for (const [i, p] of obj.products.entries()) {
      if (!p || typeof p !== 'object') {
        throw new CatalogError(`${path}: products[${i}] must be an object`);
      }
      const product = p as Record<string, unknown>;
      if (typeof product.id !== 'string' || !product.id) {
        throw new CatalogError(`${path}: products[${i}].id must be a non-empty string`);
      }
      if (ids.has(product.id)) {
        throw new CatalogError(`${path}: duplicate product id "${product.id}"`);
      }
      ids.add(product.id);
      if (product.contextSources !== undefined) {
        if (!Array.isArray(product.contextSources)) {
          throw new CatalogError(
            `${path}: products[${i}].contextSources must be an array if present`,
          );
        }
        for (const [j, s] of product.contextSources.entries()) {
          if (!s || typeof s !== 'object') {
            throw new CatalogError(
              `${path}: products[${i}].contextSources[${j}] must be an object`,
            );
          }
          const src = s as Record<string, unknown>;
          if (typeof src.type !== 'string' || !src.type) {
            throw new CatalogError(
              `${path}: products[${i}].contextSources[${j}].type must be a non-empty string`,
            );
          }
          if (typeof src.target !== 'string' || !src.target) {
            throw new CatalogError(
              `${path}: products[${i}].contextSources[${j}].target must be a non-empty string`,
            );
          }
        }
      }
      if (product.repos !== undefined) {
        if (!Array.isArray(product.repos)) {
          throw new CatalogError(`${path}: products[${i}].repos must be an array if present`);
        }
        const repoNames = new Set<string>();
        for (const [j, r] of product.repos.entries()) {
          if (!r || typeof r !== 'object') {
            throw new CatalogError(`${path}: products[${i}].repos[${j}] must be an object`);
          }
          const repo = r as Record<string, unknown>;
          if (typeof repo.name !== 'string' || !repo.name) {
            throw new CatalogError(
              `${path}: products[${i}].repos[${j}].name must be a non-empty string`,
            );
          }
          if (repoNames.has(repo.name)) {
            throw new CatalogError(
              `${path}: products[${i}].repos has duplicate name "${repo.name}"`,
            );
          }
          repoNames.add(repo.name);
          if (typeof repo.cloneUrl !== 'string' || !repo.cloneUrl) {
            throw new CatalogError(
              `${path}: products[${i}].repos[${j}].cloneUrl must be a non-empty string`,
            );
          }
          if (repo.baseRef !== undefined && (typeof repo.baseRef !== 'string' || !repo.baseRef)) {
            throw new CatalogError(
              `${path}: products[${i}].repos[${j}].baseRef must be a non-empty string when present`,
            );
          }
          if (repo.path !== undefined && (typeof repo.path !== 'string' || !repo.path)) {
            throw new CatalogError(
              `${path}: products[${i}].repos[${j}].path must be a non-empty string when present`,
            );
          }
        }
      }
    }
  }
}
