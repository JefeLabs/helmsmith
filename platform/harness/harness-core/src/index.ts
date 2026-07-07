/**
 * @helmsmith/harness-core — orchestration primitives for running pipelines.
 *
 * Cutting principle: only what an in-process consumer (CLI, tests, future
 * IDE extensions) needs to execute a pipeline lives here. Transport (UDS/HTTP),
 * worker spawning, and the coordinator agent stay in @helmsmith/harness-server.
 */

export {
  type BindingToSpecOptions,
  bindingNeedsOpenCode,
  bindingToSpec,
  defaultLocalEndpointResolver,
} from './binding-to-spec.ts';
export {
  type AdapterId,
  type AgentConfig,
  type AgentDef,
  type ApprovalTag,
  type Assertion,
  type BackoffPolicy,
  type Catalog,
  CatalogError,
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
  findFlow,
  findProduct,
  type GateConfig,
  type HttpToolDef,
  type JobIntent,
  type LoopTag,
  loadCatalog,
  type McpToolDef,
  type MergePrConfig,
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
  type SuspendTag,
  type TaskStep,
  type TaskStepPolicy,
  type TaskStepTags,
  type ToolAuthRef,
  type ToolConfig,
  type ToolDef,
  type ToolResolver,
  type TransformConfig,
  type TriggerConfig,
  validateUnifiedCatalog,
  walkAgents,
} from './catalog.ts';
export {
  type ChangedFile,
  discoverChangedFiles,
  mimeFromPath,
  parseGitDiffNameStatus,
  runGit,
} from './changed-files.ts';
export {
  type ApprovalRequest,
  type ApprovalResume,
  buildRouter,
  type CompileFlowOptions,
  compileFlow,
  evalExpression,
  FlowState,
  type FlowStateT,
  linearFlowFromAgents,
  makeGateExecutor,
  makeTransformExecutor,
  type NodeExecutor,
  type NodeExit,
  type SuspendRequest,
} from './flow-graph.ts';
export type { AgentStatus, AgentTokens, JobRecord, RegisteredAgent } from './job.ts';
export {
  type AdapterEvent,
  AdapterEventBus,
  type AdapterEventSource,
  bridgeAdapter,
  type Envelope,
  type EventTokenUsage,
  JobBus,
} from './job-bus.ts';
export {
  type AdapterFactory,
  type CompiledFlowGraph,
  cancelJob,
  composeSystemPromptWithSteering,
  DEFAULT_FALLBACK_ERRORS,
  defaultAdapterFactory,
  getJobSteering,
  type RunJobDeps,
  resumeJob,
  runJob,
  steerJob,
} from './orchestrator.ts';
export { makePublishExecutor } from './publish-executor.ts';
export { makeScriptExecutor } from './script-executor.ts';
export {
  compileNonAgentFlow,
  type FlowResolver,
  makeSubflowExecutor,
  type SubflowCompileDeps,
  validateSubflowGraph,
} from './subflow-executor.ts';
export { TokenAccumulator } from './token-accumulator.ts';
export {
  type McpResult,
  makeToolExecutor,
  type ToolExecutorDeps,
} from './tool-executor.ts';
