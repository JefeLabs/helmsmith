import type { StateDefinition, TaskNode } from '../config/schema.js';
import { findTaskById } from '../config/state-engine.js';
import { applyReadiness, flattenTasks, recomputeAllReadiness } from '../readiness/index.js';

export interface RemoveResult {
  removedIds: string[];
  tasks: TaskNode[];
}

/**
 * Recursively collect a task's ID and all of its descendant IDs.
 */
export function collectDescendantIds(task: TaskNode): string[] {
  const ids: string[] = [task.id];
  for (const child of task.children) {
    ids.push(...collectDescendantIds(child));
  }
  return ids;
}

/**
 * Remove a task from a task tree by ID.
 * Searches recursively through children arrays.
 * Returns true if the task was found and removed.
 */
export function removeFromTree(tasks: TaskNode[], targetId: string): boolean {
  for (let i = 0; i < tasks.length; i++) {
    if (tasks[i].id === targetId) {
      tasks.splice(i, 1);
      return true;
    }
    if (tasks[i].children.length > 0) {
      const found = removeFromTree(tasks[i].children, targetId);
      if (found) return true;
    }
  }
  return false;
}

/**
 * Remove all dependency references to any ID in the removedIds set
 * from all tasks in the tree.
 */
export function cleanupDependencies(tasks: TaskNode[], removedIds: Set<string>): void {
  const flat = flattenTasks(tasks);
  for (const task of flat) {
    task.dependencies = task.dependencies.filter((dep) => !removedIds.has(dep.taskId));
  }
}

/**
 * Execute the remove command: find task, collect descendant IDs,
 * remove from tree, clean up dangling dependencies, recompute readiness.
 */
export function executeRemove(
  tasks: TaskNode[],
  targetId: string,
  states: StateDefinition[],
): RemoveResult {
  const task = findTaskById(tasks, targetId);
  if (!task) {
    throw new Error(`Task "${targetId}" not found.`);
  }

  // Collect all IDs that will be removed
  const removedIds = collectDescendantIds(task);
  const removedSet = new Set(removedIds);

  // Remove from tree
  const removed = removeFromTree(tasks, targetId);
  if (!removed) {
    throw new Error(`Failed to remove task "${targetId}" from the tree.`);
  }

  // Clean up dependency references
  cleanupDependencies(tasks, removedSet);

  // Recompute readiness
  const readinessResults = recomputeAllReadiness(tasks, states);
  applyReadiness(tasks, readinessResults);

  return { removedIds, tasks };
}
