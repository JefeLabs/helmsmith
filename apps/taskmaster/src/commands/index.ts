// --- CRUD commands ---
export { executeAdd, type AddCommandOpts, type AddResult } from './add.js';
export {
  executeRemove,
  collectDescendantIds,
  removeFromTree,
  cleanupDependencies,
  type RemoveResult,
} from './remove.js';
export {
  executeSetStatus,
  cascadeStatus,
  type SetStatusOpts,
  type SetStatusResult,
} from './set-status.js';

// --- QA commands ---
export {
  executeQAFail,
  executeQAFailBatch,
  type QAFailOpts,
  type QAFailResult,
  type QAFailBatchEntry,
  type QAFailBatchResult,
} from './qa-fail.js';
export {
  executeQAClear,
  executeQAClearBatch,
  type QAClearOpts,
  type QAClearResult,
  type QAClearBatchEntry,
  type QAClearBatchResult,
} from './qa-clear.js';

// --- Task viewing ---
export { executeList, type ListOpts, type ListResult } from './list.js';
export { executeShow, type ShowOpts, type ShowResult } from './show.js';
export { executeNext, type NextResult } from './next.js';
export { executeReady, type ReadyOpts, type ReadyResult } from './ready.js';

// --- Task operations ---
export { executeScore, type ScoreOpts, type ScoreResult } from './score.js';
export {
  executeExpand,
  executeExpandAll,
  validateExpandable,
  findExpandCandidates,
  type ExpandOpts,
  type ExpandResult,
  type ExpandAllOpts,
  type ExpandAllResult,
  type ExpandAllCandidate,
} from './expand.js';

// --- Project operations ---
export { executeInit, type InitOpts, type InitResult } from './init.js';
export { executeParse, type ParseOpts, type ParseResult } from './parse.js';
export { executeScan, type ScanSummary } from './scan.js';
export { executeGenerate, type GenerateResult } from './generate.js';
export { executeSync, type SyncOpts, type SyncResult } from './sync.js';
export { executeValidate, type ValidateResult } from './validate.js';
export { executeReport, type ReportOpts, type ReportResult } from './report.js';
export { executeConfigGet, executeConfigSet, executeConfigEdit } from './config-cmd.js';

// --- Auth ---
export {
  executeAuthLogin,
  executeAuthStatus,
  executeAuthSwitch,
  executeAuthLogout,
  type AuthLoginResult,
  type AuthStatusResult,
  type AuthSwitchResult,
  type AuthLogoutResult,
} from './auth.js';

// --- Projects management ---
export {
  executeProjectsList,
  executeProjectsCreate,
  executeProjectsSwitch,
  executeProjectsRemove,
  type ProjectsListResult,
  type ProjectsCreateResult,
} from './projects.js';

// --- Blueprints ---
export {
  executeBlueprintApply,
  executeBlueprintCheck,
  type BlueprintApplyResult,
  type BlueprintCheckResult,
} from './blueprint.js';
