/**
 * `@helmsmith/flow-spec/definition` — the AUTHORING surface: flow
 * definition types, the flow validator, the expression evaluator, and
 * the schema subset. This is what a designer UI needs, without the
 * run-side wire shapes (`./run`) or tenancy/git shapes (`./tenancy`)
 * riding along. The root entry (`.`) remains the full union plus the
 * conformance fixtures — nothing moved, these entries re-curate.
 */
export { evalExpression, resolveExpressionValue, resolveJsonPath } from './expression.ts';
export { schemaViolations, validateSchemaShape } from './schema.ts';
export {
  type AdapterId,
  type AgentConfig,
  type AgentDef,
  type ApprovalTag,
  type Assertion,
  type BackoffPolicy,
  type BootstrapStep,
  CatalogError,
  type CliToolDef,
  type CompareOp,
  type ConditionalEdge,
  type Duration,
  type Edge,
  type ErrorEdge,
  type Expression,
  type FallbackEdge,
  type FlowCatalog,
  type FlowDef,
  type FlowOutputContract,
  findFlow,
  type GateConfig,
  type HttpToolDef,
  type LoopTag,
  type McpToolDef,
  type MergePrConfig,
  type NodeOutputContract,
  type PublishConfig,
  type PushAndOpenPrConfig,
  type RejectEdge,
  type RetryPolicy,
  resolveAccepts,
  type ScriptConfig,
  type SequenceEdge,
  type SteeringInputSchema,
  type SubflowConfig,
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
} from './validate.ts';
