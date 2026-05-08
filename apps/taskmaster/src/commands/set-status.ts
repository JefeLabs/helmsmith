import type { TaskNode, StateDefinition } from '../config/schema.js';
import { findTaskById, validateTransition, isClosedState } from '../config/state-engine.js';
import { recomputeAllReadiness, applyReadiness } from '../readiness/index.js';

export interface SetStatusOpts {
  cascade?: boolean;
  force?: boolean;
}

export interface SetStatusResult {
  task: TaskNode;
  oldStatus: string;
  newStatus: string;
  cascadedCount: number;
  tasks: TaskNode[];
}

/**
 * Recursively set status on all children of a task.
 * Returns the count of children that were updated.
 */
export function cascadeStatus(task: TaskNode, newStatus: string): number {
  let count = 0;
  for (const child of task.children) {
    child.status = newStatus;
    count++;
    count += cascadeStatus(child, newStatus);
  }
  return count;
}

/**
 * Execute the set-status command: validate transition, set status,
 * optionally cascade to children, recompute readiness.
 */
export function executeSetStatus(
  tasks: TaskNode[],
  targetId: string,
  newStatus: string,
  states: StateDefinition[],
  enforceTransitions: boolean,
  opts: SetStatusOpts = {},
): SetStatusResult {
  const task = findTaskById(tasks, targetId);
  if (!task) {
    throw new Error(`Task "${targetId}" not found.`);
  }

  const oldStatus = task.status;
  const validNames = states.map((s) => s.name);

  // QA gate: reject closed transitions while qa-review-needed tag is present
  if (
    task.tags.includes('qa-review-needed') &&
    isClosedState(states, newStatus) &&
    !opts.force
  ) {
    throw new Error(
      `Task "${targetId}" has qa-review-needed tag. ` +
        `Run 'qa-clear ${targetId}' after reviewing impact and rerunning tests.`,
    );
  }

  if (opts.force) {
    // --force bypasses transition rules but validates target state exists
    if (!validNames.includes(newStatus)) {
      throw new Error(
        `Invalid target state "${newStatus}". Valid states: ${validNames.join(', ')}`,
      );
    }
  } else {
    const result = validateTransition(states, oldStatus, newStatus, enforceTransitions);
    if (!result.valid) {
      throw new Error(result.error!);
    }
  }

  // Apply status change
  task.status = newStatus;

  // Cascade to children if requested
  let cascadedCount = 0;
  if (opts.cascade) {
    cascadedCount = cascadeStatus(task, newStatus);
  }

  // Recompute readiness
  const readinessResults = recomputeAllReadiness(tasks, states);
  applyReadiness(tasks, readinessResults);

  return { task, oldStatus, newStatus, cascadedCount, tasks };
}
