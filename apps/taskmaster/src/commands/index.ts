// --- CRUD commands ---
export { type AddCommandOpts, type AddResult, executeAdd } from './add.js';
// --- Auth ---
export {
  type AuthLoginResult,
  type AuthLogoutResult,
  type AuthStatusResult,
  type AuthSwitchResult,
  executeAuthLogin,
  executeAuthLogout,
  executeAuthStatus,
  executeAuthSwitch,
} from './auth.js';
// --- Blueprints ---
export {
  type BlueprintApplyResult,
  type BlueprintCheckResult,
  executeBlueprintApply,
  executeBlueprintCheck,
} from './blueprint.js';
export { executeConfigEdit, executeConfigGet, executeConfigSet } from './config-cmd.js';
export {
  type ExpandAllCandidate,
  type ExpandAllOpts,
  type ExpandAllResult,
  type ExpandOpts,
  type ExpandResult,
  executeExpand,
  executeExpandAll,
  findExpandCandidates,
  validateExpandable,
} from './expand.js';
export { executeGenerate, type GenerateResult } from './generate.js';
// --- Project operations ---
export { executeInit, type InitOpts, type InitResult } from './init.js';
// --- Task viewing ---
export { executeList, type ListOpts, type ListResult } from './list.js';
export { executeNext, type NextResult } from './next.js';
export { executeParse, type ParseOpts, type ParseResult } from './parse.js';
// --- Projects management ---
export {
  executeProjectsCreate,
  executeProjectsList,
  executeProjectsRemove,
  executeProjectsSwitch,
  type ProjectsCreateResult,
  type ProjectsListResult,
} from './projects.js';
export {
  executeQAClear,
  executeQAClearBatch,
  type QAClearBatchEntry,
  type QAClearBatchResult,
  type QAClearOpts,
  type QAClearResult,
} from './qa-clear.js';
// --- QA commands ---
export {
  executeQAFail,
  executeQAFailBatch,
  type QAFailBatchEntry,
  type QAFailBatchResult,
  type QAFailOpts,
  type QAFailResult,
} from './qa-fail.js';
export { executeReady, type ReadyOpts, type ReadyResult } from './ready.js';
export {
  cleanupDependencies,
  collectDescendantIds,
  executeRemove,
  type RemoveResult,
  removeFromTree,
} from './remove.js';
export { executeReport, type ReportOpts, type ReportResult } from './report.js';
export { executeScan, type ScanSummary } from './scan.js';
// --- Task operations ---
export { executeScore, type ScoreOpts, type ScoreResult } from './score.js';
export {
  cascadeStatus,
  executeSetStatus,
  type SetStatusOpts,
  type SetStatusResult,
} from './set-status.js';
export { executeShow, type ShowOpts, type ShowResult } from './show.js';
export { executeSync, type SyncOpts, type SyncResult } from './sync.js';
export { executeValidate, type ValidateResult } from './validate.js';
