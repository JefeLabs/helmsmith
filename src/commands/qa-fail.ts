import type { TaskNode, StateDefinition, QAFeedbackEntry } from '../config/schema.js';
import { findTaskById, isClosedState, isActiveState } from '../config/state-engine.js';
import { flattenTasks } from '../readiness/dag.js';
import { recomputeAllReadiness, applyReadiness } from '../readiness/index.js';

export interface QAFailOpts {
  testType: QAFeedbackEntry['testType'];
  description: string;
  cause?: string;
  severity?: QAFeedbackEntry['severity'];
  reporter?: string;
  cascade?: boolean;
  force?: boolean;
}

export interface QAFailResult {
  task: TaskNode;
  oldStatus: string;
  feedbackEntry: QAFeedbackEntry;
  taggedDependents: string[];
  pulledBackDependents: string[];
  tasks: TaskNode[];
}

/**
 * Find all direct dependents of a task — tasks that have a blocks/produces
 * dependency pointing to the given taskId.
 */
function findDirectDependents(tasks: TaskNode[], taskId: string): TaskNode[] {
  const flat = flattenTasks(tasks);
  return flat.filter((t) =>
    t.dependencies.some(
      (d) => d.taskId === taskId && (d.type === 'blocks' || d.type === 'produces'),
    ),
  );
}

/**
 * Determine the pull-back target status for a dependent that was `done`.
 * Uses the first active-category state that isn't qa-failed or blocked.
 */
function getPullBackStatus(states: StateDefinition[]): string {
  const review = states.find((s) => s.name === 'review');
  if (review) return 'review';
  const inProgress = states.find((s) => s.name === 'in-progress');
  if (inProgress) return 'in-progress';
  // Fallback: first active state
  const firstActive = states.find((s) => s.category === 'active' && s.name !== 'qa-failed' && s.name !== 'blocked');
  return firstActive?.name ?? 'in-progress';
}

/**
 * Execute the qa-fail command:
 * 1. Find task, validate transition to qa-failed
 * 2. Append QAFeedbackEntry with result: 'fail'
 * 3. Set status to qa-failed, add qa-failed-source tag
 * 4. Tag direct dependents with qa-review-needed; pull back done dependents
 * 5. Optionally cascade qa-failed to children
 * 6. Recompute readiness
 */
// --- Batch types ---

export interface QAFailBatchEntry {
  taskId: string;
  testType: QAFeedbackEntry['testType'];
  description: string;
  cause?: string;
  severity?: QAFeedbackEntry['severity'];
  reporter?: string;
}

export interface QAFailBatchResult {
  entries: Array<{
    taskId: string;
    oldStatus: string;
    feedbackEntry: QAFeedbackEntry;
    taggedDependents: string[];
    pulledBackDependents: string[];
  }>;
  errors: Array<{
    taskId: string;
    error: string;
  }>;
  tasks: TaskNode[];
  summary: {
    failed: number;
    critical: number;
    major: number;
    minor: number;
    dependentsTagged: number;
    dependentsPulledBack: number;
  };
}

/**
 * Process multiple QA failures atomically:
 * 1. Process all failures (status change, feedback, tagging, pull-back) without readiness recompute
 * 2. Deduplicate dependent tagging (if T-2 depends on both T-1 and T-3, tagged once)
 * 3. Single recomputeAllReadiness + applyReadiness at the end
 * 4. Invalid task IDs are collected as errors — valid entries still process
 */
export function executeQAFailBatch(
  tasks: TaskNode[],
  failures: QAFailBatchEntry[],
  states: StateDefinition[],
  enforceTransitions: boolean,
  opts?: { cascade?: boolean; force?: boolean },
): QAFailBatchResult {
  const validNames = states.map((s) => s.name);
  if (!validNames.includes('qa-failed')) {
    throw new Error('State "qa-failed" is not available in the current state preset.');
  }

  const entries: QAFailBatchResult['entries'] = [];
  const errors: QAFailBatchResult['errors'] = [];
  // Track all dependents globally for deduplication
  const globalTaggedSet = new Set<string>();
  const globalPulledBackSet = new Set<string>();

  for (const failure of failures) {
    const task = findTaskById(tasks, failure.taskId);
    if (!task) {
      errors.push({ taskId: failure.taskId, error: `Task "${failure.taskId}" not found.` });
      continue;
    }

    const oldStatus = task.status;

    // Validate transition (skip if already qa-failed or --force)
    if (task.status !== 'qa-failed' && !opts?.force) {
      if (enforceTransitions) {
        const fromState = states.find((s) => s.name === task.status);
        if (fromState?.transitions !== undefined && !fromState.transitions.includes('qa-failed')) {
          errors.push({
            taskId: failure.taskId,
            error:
              `Cannot transition from "${task.status}" to "qa-failed". ` +
              `Allowed transitions: ${fromState.transitions.join(', ')}.`,
          });
          continue;
        }
      }
    }

    // Build feedback entry
    const feedbackEntry: QAFeedbackEntry = {
      testType: failure.testType,
      result: 'fail',
      description: failure.description,
      cause: failure.cause ?? '',
      severity: failure.severity ?? 'major',
      reporter: failure.reporter ?? 'qa-agent',
      timestamp: new Date().toISOString(),
    };

    // Append feedback
    task.qaFeedback.push(feedbackEntry);

    // Set status
    task.status = 'qa-failed';

    // Add qa-failed-source tag (idempotent)
    if (!task.tags.includes('qa-failed-source')) {
      task.tags.push('qa-failed-source');
    }

    // Cascade to children if requested
    if (opts?.cascade) {
      const cascadeChildren = (node: TaskNode): void => {
        for (const child of node.children) {
          child.status = 'qa-failed';
          if (!child.tags.includes('qa-failed-source')) {
            child.tags.push('qa-failed-source');
          }
          cascadeChildren(child);
        }
      };
      cascadeChildren(task);
    }

    // Tag direct dependents (deduplicated across batch)
    const dependents = findDirectDependents(tasks, failure.taskId);
    const entryTagged: string[] = [];
    const entryPulledBack: string[] = [];

    for (const dep of dependents) {
      if (!dep.tags.includes('qa-review-needed')) {
        dep.tags.push('qa-review-needed');
      }
      // Track per-entry (may include duplicates across entries, that's fine for reporting)
      entryTagged.push(dep.id);
      globalTaggedSet.add(dep.id);

      // Pull back done dependents (only once per dependent)
      if (isClosedState(states, dep.status) && !globalPulledBackSet.has(dep.id)) {
        const pullBackTo = getPullBackStatus(states);
        dep.status = pullBackTo;
        entryPulledBack.push(dep.id);
        globalPulledBackSet.add(dep.id);
      }
    }

    entries.push({
      taskId: failure.taskId,
      oldStatus,
      feedbackEntry,
      taggedDependents: entryTagged,
      pulledBackDependents: entryPulledBack,
    });
  }

  // Single readiness recompute after all mutations
  const readinessResults = recomputeAllReadiness(tasks, states);
  applyReadiness(tasks, readinessResults);

  // Build summary
  const summary = {
    failed: entries.length,
    critical: entries.filter((e) => e.feedbackEntry.severity === 'critical').length,
    major: entries.filter((e) => e.feedbackEntry.severity === 'major').length,
    minor: entries.filter((e) => e.feedbackEntry.severity === 'minor').length,
    dependentsTagged: globalTaggedSet.size,
    dependentsPulledBack: globalPulledBackSet.size,
  };

  return { entries, errors, tasks, summary };
}

export function executeQAFail(
  tasks: TaskNode[],
  targetId: string,
  states: StateDefinition[],
  enforceTransitions: boolean,
  opts: QAFailOpts,
): QAFailResult {
  const task = findTaskById(tasks, targetId);
  if (!task) {
    throw new Error(`Task "${targetId}" not found.`);
  }

  const oldStatus = task.status;
  const validNames = states.map((s) => s.name);

  // Validate that qa-failed exists in the preset
  if (!validNames.includes('qa-failed')) {
    throw new Error('State "qa-failed" is not available in the current state preset.');
  }

  // If already qa-failed, skip transition validation (idempotent)
  if (task.status !== 'qa-failed' && !opts.force) {
    // Validate transition is allowed
    if (enforceTransitions) {
      const fromState = states.find((s) => s.name === task.status);
      if (fromState?.transitions !== undefined && !fromState.transitions.includes('qa-failed')) {
        throw new Error(
          `Cannot transition from "${task.status}" to "qa-failed". ` +
            `Allowed transitions from "${task.status}": ${fromState.transitions.join(', ')}. ` +
            `Use --force to bypass.`,
        );
      }
    }
  }

  // Build feedback entry
  const feedbackEntry: QAFeedbackEntry = {
    testType: opts.testType,
    result: 'fail',
    description: opts.description,
    cause: opts.cause ?? '',
    severity: opts.severity ?? 'major',
    reporter: opts.reporter ?? 'qa-agent',
    timestamp: new Date().toISOString(),
  };

  // Append feedback
  task.qaFeedback.push(feedbackEntry);

  // Set status
  task.status = 'qa-failed';

  // Add qa-failed-source tag (idempotent)
  if (!task.tags.includes('qa-failed-source')) {
    task.tags.push('qa-failed-source');
  }

  // Cascade to children if requested
  if (opts.cascade) {
    const cascadeChildren = (node: TaskNode): void => {
      for (const child of node.children) {
        child.status = 'qa-failed';
        if (!child.tags.includes('qa-failed-source')) {
          child.tags.push('qa-failed-source');
        }
        cascadeChildren(child);
      }
    };
    cascadeChildren(task);
  }

  // Tag direct dependents
  const dependents = findDirectDependents(tasks, targetId);
  const taggedDependents: string[] = [];
  const pulledBackDependents: string[] = [];

  for (const dep of dependents) {
    // Add qa-review-needed tag (idempotent)
    if (!dep.tags.includes('qa-review-needed')) {
      dep.tags.push('qa-review-needed');
    }
    taggedDependents.push(dep.id);

    // Pull back done dependents to an active state
    if (isClosedState(states, dep.status)) {
      const pullBackTo = getPullBackStatus(states);
      dep.status = pullBackTo;
      pulledBackDependents.push(dep.id);
    }
  }

  // Recompute readiness (dependents auto-block because upstream is now non-closed)
  const readinessResults = recomputeAllReadiness(tasks, states);
  applyReadiness(tasks, readinessResults);

  return {
    task,
    oldStatus,
    feedbackEntry,
    taggedDependents,
    pulledBackDependents,
    tasks,
  };
}
