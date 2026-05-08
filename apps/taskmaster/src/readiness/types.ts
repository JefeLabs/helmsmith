import type { SkillValidationIssue } from '../skills/types.js';

/** A single directed edge in the dependency graph. */
export interface DagEdge {
  from: string;
  to: string;
  type: 'blocks' | 'produces' | 'relates';
}

/** Result of building a DAG and running topological sort (Kahn's algorithm). */
export interface DagResult {
  /** Adjacency list: taskId -> list of taskIds it depends on. */
  adjacency: Map<string, string[]>;
  /** Number of incoming edges per node. */
  inDegree: Map<string, number>;
  /** Topologically sorted task IDs (only valid if hasCycle is false). */
  sorted: string[];
  /** Whether the graph contains a cycle. */
  hasCycle: boolean;
  /** Task IDs involved in a cycle (non-zero in-degree after Kahn's). */
  cycleNodes: string[];
}

/** Result of detecting dangling dependency references. */
export interface OrphanResult {
  danglingRefs: {
    taskId: string;
    referencedId: string;
    depIndex: number;
  }[];
}

/** Computed readiness for a single task. */
export interface ReadinessResult {
  taskId: string;
  readiness: 'ready' | 'blocked' | 'pending';
  waitingOn: string[];
}

/** A single fix action taken by validate --fix. */
export interface FixAction {
  type: 'removed_dangling' | 'removed_cycle_edge';
  taskId: string;
  detail: string;
}

/** Combined validation report from the validate command. */
export interface ValidationReport {
  cycles: {
    hasCycle: boolean;
    cycleNodes: string[];
  };
  danglingRefs: OrphanResult['danglingRefs'];
  skillIssues: SkillValidationIssue[];
  isValid: boolean;
  fixes?: FixAction[];
}

/** A ready task entry in the delegation manifest. */
export interface ReadyTaskEntry {
  id: string;
  title: string;
  required_skills: string[];
  complexity: number;
  priority: string;
  outputs: string[];
  dependencies: string[];
}

/** A blocked task entry in the delegation manifest. */
export interface BlockedTaskEntry {
  id: string;
  title: string;
  waiting_on: string[];
}

/** Summary counts in the delegation manifest. */
export interface ManifestSummary {
  total: number;
  ready: number;
  blocked: number;
  in_progress: number;
  completed: number;
}

/** A QA-failed task entry in the delegation manifest. */
export interface QAFailedTaskEntry {
  id: string;
  title: string;
  priority: string;
  complexity: number;
  required_skills: string[];
  latest_feedback: {
    test_type: string;
    description: string;
    severity: string;
    reporter: string;
  };
}

/** Summary counts in the delegation manifest. */
export interface ManifestSummaryWithQA extends ManifestSummary {
  qa_failed: number;
}

/** The full delegation manifest output by the ready command. */
export interface DelegationManifest {
  generated_at: string;
  qa_failed_tasks: QAFailedTaskEntry[];
  ready_tasks: ReadyTaskEntry[];
  blocked_tasks: BlockedTaskEntry[];
  summary: ManifestSummaryWithQA;
}
