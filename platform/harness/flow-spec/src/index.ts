/**
 * Curated public surface of @helmsmith/flow-spec.
 *
 * Every symbol here is a deliberate part of the wire contract (or, for
 * the fixture sets, the conformance data every implementation replays).
 * Adding a symbol to this list IS the API-review point — new exports in
 * the modules below stay package-private until someone names them here,
 * and harness-core's `catalog.ts` re-export is curated the same way.
 * Runtime dispatch seams (function types that can't be stored or
 * rendered, e.g. ToolResolver) belong in harness-core, not here.
 */
export { evalExpression, resolveExpressionValue, resolveJsonPath } from './expression.ts';
export {
  EXPRESSION_CASES,
  type ExpressionCase,
  SCHEMA_CASES,
  type SchemaCase,
  UNSUPPORTED_CASES,
  type UnsupportedCase,
  VALIDATION_CASES,
  type ValidationCase,
} from './fixtures.ts';
export { type FlowOutputParseResult, parseFlowOutput } from './output.ts';
export { schemaViolations, validateSchemaShape } from './schema.ts';
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
  type FallbackEdge,
  type FlowCatalog,
  type FlowDef,
  type FlowOutputContract,
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
  type RejectEdge,
  type RejectionPayload,
  type RetryPolicy,
  resolveAccepts,
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
  walkAgents,
} from './types.ts';
export {
  type UnsupportedFeature,
  type ValidateOptions,
  validateFlowCatalog,
  validateUnifiedCatalog,
} from './validate.ts';
