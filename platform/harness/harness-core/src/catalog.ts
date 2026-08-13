import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  CatalogError,
  type FlowCatalog,
  type UnsupportedFeature,
  validateFlowCatalog,
} from '@helmsmith/flow-spec';

/**
 * Node-side catalog loading for the harness runtime. The spec itself —
 * types, validation, expression semantics, conformance fixtures — lives
 * in @helmsmith/flow-spec (browser-safe, zero deps) and is re-exported
 * here so existing `./catalog.ts` imports keep working.
 *
 * The re-export list is curated (mirrors flow-spec's own index): the
 * runtime CONTRACT only. The conformance fixture sets are deliberately
 * not re-exported — they are spec data, not runtime API; tests that
 * replay them import from '@helmsmith/flow-spec' directly (see
 * flow-spec-conformance.test.ts). A new flow-spec symbol becomes part
 * of harness-core's surface only by being named here AND in index.ts.
 *
 * The catalog is admin-owned: clients submit *intent* (a flow id +
 * input), they do not design flows.
 *
 * Local layout: `.harness/config/flows.json` at the workspace root.
 * Production sources the same shape from controlplane (Spring Modulith
 * Catalog service) over HTTP — `loadCatalog()` is the local-fs path; the
 * controlplane-fed path lives in harness-server's `load-catalog.ts`.
 *
 * Runtime coverage of step kinds / tags / edges / expressions: see the
 * "RUNTIME COVERAGE MATRIX" comment block at the top of
 * `orchestrator.ts`.
 */
export {
  type AdapterId,
  type AgentConfig,
  type AgentDef,
  type ApprovalRequest,
  type ApprovalResume,
  type ApprovalTag,
  type Assertion,
  type BackoffPolicy,
  type Catalog,
  CatalogError,
  type ChangedFile,
  type CliToolDef,
  type CompareOp,
  type ConditionalEdge,
  type ContextSourceDef,
  type Duration,
  type Edge,
  type ErrorEdge,
  type Expression,
  evalExpression,
  type FallbackEdge,
  type FlowCatalog,
  type FlowDef,
  type FlowOutputContract,
  type FlowOutputParseResult,
  type FlowRunState,
  findFlow,
  findProduct,
  type GateConfig,
  type HttpToolDef,
  type JobIntent,
  type LoopTag,
  type McpToolDef,
  type MergePrConfig,
  type NodeExit,
  type NodeOutputContract,
  type ProductDef,
  type ProductRepo,
  type PublishConfig,
  type PushAndOpenPrConfig,
  parseFlowOutput,
  type RejectEdge,
  type RejectionPayload,
  type RetryPolicy,
  resolveAccepts,
  resolveExpressionValue,
  resolveJsonPath,
  type ScriptConfig,
  type SequenceEdge,
  type SteeringInputSchema,
  type SubflowConfig,
  type SuspendRequest,
  type SuspendTag,
  type TaskStep,
  type TaskStepPolicy,
  type TaskStepTags,
  type ToolAuthRef,
  type ToolConfig,
  type ToolDef,
  type TransformConfig,
  type TriggerConfig,
  type UnsupportedFeature,
  type ValidateOptions,
  validateFlowCatalog,
  validateUnifiedCatalog,
  walkAgents,
} from '@helmsmith/flow-spec';

const EMPTY: FlowCatalog = { flows: [] };

/** One console.warn line per spec feature the runtime does not execute
 *  yet — joinStrategy, terminal:'fail', non-manual triggers, js
 *  expressions, parallel fan-out, unenforced schemas. Loud at load time
 *  so catalog authors learn before a silent no-op ships. */
function warnUnsupported(path: string, f: UnsupportedFeature): void {
  console.warn(
    `[catalog] ${path}: ${f.where}: "${f.feature}" is not executed by the runtime yet — ${f.detail}`,
  );
}

/**
 * Reads the catalog file. Missing file → empty catalog (no throw) so a fresh
 * workspace boots without a config file. Malformed JSON or wrong shape throws
 * `CatalogError` with a path-prefixed message — fail loud on bad config.
 *
 * Catalog `accepts` Record-form (named sets) is preserved through loading.
 * Set selection happens per-job at submission time via `resolveAccepts`.
 */
export async function loadCatalog(workspaceRoot: string): Promise<FlowCatalog> {
  const path = join(workspaceRoot, '.harness', 'config', 'flows.json');
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return EMPTY;
    throw new CatalogError(`failed to read ${path}: ${(err as Error).message}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new CatalogError(`${path}: invalid JSON — ${(err as Error).message}`);
  }

  validateFlowCatalog(parsed, path, { onUnsupported: (f) => warnUnsupported(path, f) });
  return parsed as FlowCatalog;
}
