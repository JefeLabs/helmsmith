export {
  buildDag,
  buildTaskMap,
  detectDanglingRefs,
  fixCycles,
  fixDanglingRefs,
  flattenTasks,
} from './dag.js';

export {
  applyReadiness,
  buildDelegationManifest,
  findNextTask,
  recomputeAllReadiness,
  runValidation,
} from './resolver.js';

export type {
  BlockedTaskEntry,
  DagEdge,
  DagResult,
  DelegationManifest,
  FixAction,
  ManifestSummary,
  ManifestSummaryWithQA,
  OrphanResult,
  QAFailedTaskEntry,
  ReadinessResult,
  ReadyTaskEntry,
  ValidationReport,
} from './types.js';
