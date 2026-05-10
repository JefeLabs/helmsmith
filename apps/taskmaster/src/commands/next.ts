import type { StateDefinition, TaskNode } from '../config/schema.js';
import { applyReadiness, findNextTask, recomputeAllReadiness } from '../readiness/index.js';

export interface NextResult {
  /** The highest-priority ready task, or null if none are ready. */
  task: TaskNode | null;
  /** The full task array with updated readiness. */
  tasks: TaskNode[];
}

/**
 * Execute the next command: recompute readiness and return
 * the single highest-priority ready task.
 */
export function executeNext(tasks: TaskNode[], states: StateDefinition[]): NextResult {
  const results = recomputeAllReadiness(tasks, states);
  applyReadiness(tasks, results);
  const task = findNextTask(tasks, states);
  return { task, tasks };
}
