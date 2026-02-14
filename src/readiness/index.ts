export {
  flattenTasks,
  buildTaskMap,
  buildDag,
  detectDanglingRefs,
  fixCycles,
  fixDanglingRefs,
} from './dag.js';

export {
  recomputeAllReadiness,
  applyReadiness,
  buildDelegationManifest,
  findNextTask,
  runValidation,
} from './resolver.js';

export type {
  DagEdge,
  DagResult,
  OrphanResult,
  ReadinessResult,
  FixAction,
  ValidationReport,
  ReadyTaskEntry,
  BlockedTaskEntry,
  ManifestSummary,
  DelegationManifest,
} from './types.js';
