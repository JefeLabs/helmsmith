import type { TaskNode } from '../config/schema.js';
import type { DagResult, FixAction, OrphanResult } from './types.js';

/**
 * Recursively flatten a hierarchical task tree into a flat array.
 * Returns references to the original TaskNode objects (mutations propagate).
 */
export function flattenTasks(tasks: TaskNode[]): TaskNode[] {
  const result: TaskNode[] = [];

  function collect(nodes: TaskNode[]): void {
    for (const node of nodes) {
      result.push(node);
      if (node.children.length > 0) {
        collect(node.children);
      }
    }
  }

  collect(tasks);
  return result;
}

/**
 * Build a lookup map from task ID to TaskNode.
 * Operates on a flat task list (call flattenTasks first).
 */
export function buildTaskMap(tasks: TaskNode[]): Map<string, TaskNode> {
  const map = new Map<string, TaskNode>();
  for (const task of tasks) {
    map.set(task.id, task);
  }
  return map;
}

/**
 * Build a directed acyclic graph from task dependencies and run topological sort
 * using Kahn's algorithm. Includes ALL dependency types (blocks, produces, relates)
 * for structural validation and cycle detection.
 *
 * The adjacency list represents: taskId -> [taskIds it depends on].
 * An edge from A to B means "A depends on B" (B must come before A).
 */
export function buildDag(tasks: TaskNode[]): DagResult {
  const adjacency = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  // Initialize all nodes
  for (const task of tasks) {
    adjacency.set(task.id, []);
    inDegree.set(task.id, 0);
  }

  // Build edges: if task A depends on task B, add edge B -> A
  // (B must complete before A, so B comes first in topological order)
  // We store adjacency as "from -> to" where from is the prerequisite
  const forwardAdj = new Map<string, string[]>();
  for (const task of tasks) {
    forwardAdj.set(task.id, []);
  }

  for (const task of tasks) {
    for (const dep of task.dependencies) {
      // dep.taskId is the prerequisite; task.id depends on it
      const prereq = dep.taskId;
      if (forwardAdj.has(prereq)) {
        forwardAdj.get(prereq)!.push(task.id);
        inDegree.set(task.id, (inDegree.get(task.id) ?? 0) + 1);
      }
      // Track dependency list per task
      adjacency.get(task.id)!.push(prereq);
    }
  }

  // Kahn's algorithm: start with nodes that have in-degree 0
  const queue: string[] = [];
  for (const [id, degree] of inDegree.entries()) {
    if (degree === 0) {
      queue.push(id);
    }
  }

  const sorted: string[] = [];
  const inDegreeCopy = new Map(inDegree);

  while (queue.length > 0) {
    const node = queue.shift()!;
    sorted.push(node);

    const neighbors = forwardAdj.get(node) ?? [];
    for (const neighbor of neighbors) {
      const newDegree = (inDegreeCopy.get(neighbor) ?? 1) - 1;
      inDegreeCopy.set(neighbor, newDegree);
      if (newDegree === 0) {
        queue.push(neighbor);
      }
    }
  }

  const hasCycle = sorted.length < tasks.length;
  const cycleNodes: string[] = [];
  if (hasCycle) {
    for (const [id, degree] of inDegreeCopy.entries()) {
      if (degree > 0) {
        cycleNodes.push(id);
      }
    }
  }

  return { adjacency, inDegree, sorted, hasCycle, cycleNodes };
}

/**
 * Detect dangling dependency references: dependencies that point to
 * task IDs that don't exist in the task tree.
 */
export function detectDanglingRefs(
  tasks: TaskNode[],
  taskMap: Map<string, TaskNode>,
): OrphanResult {
  const danglingRefs: OrphanResult['danglingRefs'] = [];

  for (const task of tasks) {
    for (let i = 0; i < task.dependencies.length; i++) {
      const dep = task.dependencies[i];
      if (!taskMap.has(dep.taskId)) {
        danglingRefs.push({
          taskId: task.id,
          referencedId: dep.taskId,
          depIndex: i,
        });
      }
    }
  }

  return { danglingRefs };
}

/**
 * Auto-fix cycles by removing back-edges.
 * For each cycle node, find and remove one dependency that points to another cycle node.
 * Mutates the task's dependencies array in place.
 */
export function fixCycles(tasks: TaskNode[], dagResult: DagResult): FixAction[] {
  if (!dagResult.hasCycle) {
    return [];
  }

  const fixes: FixAction[] = [];
  const cycleSet = new Set(dagResult.cycleNodes);
  const taskMap = buildTaskMap(tasks);

  // Track which edges we've already removed to avoid double-removal
  const removed = new Set<string>();

  for (const nodeId of dagResult.cycleNodes) {
    const task = taskMap.get(nodeId);
    if (!task) continue;

    // Find the last dependency that points to another cycle node
    for (let i = task.dependencies.length - 1; i >= 0; i--) {
      const dep = task.dependencies[i];
      const edgeKey = `${nodeId}->${dep.taskId}`;
      if (cycleSet.has(dep.taskId) && !removed.has(edgeKey)) {
        removed.add(edgeKey);
        task.dependencies.splice(i, 1);
        fixes.push({
          type: 'removed_cycle_edge',
          taskId: nodeId,
          detail: `Removed dependency on "${dep.taskId}" (type: ${dep.type}) to break cycle`,
        });
        break; // Only remove one edge per cycle node
      }
    }
  }

  return fixes;
}

/**
 * Auto-fix dangling references by removing invalid dependency entries.
 * Mutates the task's dependencies array in place.
 * Processes in reverse order to maintain correct indices during removal.
 */
export function fixDanglingRefs(tasks: TaskNode[], orphanResult: OrphanResult): FixAction[] {
  if (orphanResult.danglingRefs.length === 0) {
    return [];
  }

  const fixes: FixAction[] = [];
  const taskMap = buildTaskMap(tasks);

  // Group dangling refs by taskId and sort indices descending for safe removal
  const byTask = new Map<string, number[]>();
  for (const ref of orphanResult.danglingRefs) {
    if (!byTask.has(ref.taskId)) {
      byTask.set(ref.taskId, []);
    }
    byTask.get(ref.taskId)!.push(ref.depIndex);
  }

  for (const [taskId, indices] of byTask.entries()) {
    const task = taskMap.get(taskId);
    if (!task) continue;

    // Sort descending so splicing doesn't shift later indices
    const sortedIndices = [...indices].sort((a, b) => b - a);
    for (const idx of sortedIndices) {
      const dep = task.dependencies[idx];
      if (dep) {
        fixes.push({
          type: 'removed_dangling',
          taskId,
          detail: `Removed dangling reference to "${dep.taskId}" (type: ${dep.type})`,
        });
        task.dependencies.splice(idx, 1);
      }
    }
  }

  return fixes;
}
