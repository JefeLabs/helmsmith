import type { ProjectConfig, TaskNode } from '../config/schema.js';
import { findTaskById } from '../config/state-engine.js';
import { expandMultiple, expandTask, getChildType } from '../decomposer/index.js';

export interface ExpandOpts {
  force?: boolean;
  maxSubtasks?: number;
  authAvailable: boolean;
}

export interface ExpandResult {
  task: TaskNode;
  children: TaskNode[];
  tasks: TaskNode[];
}

export interface ExpandAllOpts {
  threshold: number;
  dryRun?: boolean;
  authAvailable: boolean;
}

export interface ExpandAllCandidate {
  id: string;
  title: string;
  complexity: number;
  estimatedSubtasks: string;
}

export interface ExpandAllResult {
  expanded: Array<{ parentId: string; children: TaskNode[] }>;
  errors: Array<{ parentId: string; reason: string }>;
  tasks: TaskNode[];
}

/**
 * Validate whether a task can be expanded.
 * Returns an error message or null if expandable.
 */
export function validateExpandable(task: TaskNode, style: string, force?: boolean): string | null {
  const childType = getChildType(task.type, style);
  if (!childType) {
    return `Cannot expand ${task.id}: already at maximum depth (${task.type}) for style '${style}'.`;
  }
  if (task.children.length > 0 && !force) {
    return `Task ${task.id} already has ${task.children.length} subtask(s). Use --force to re-expand.`;
  }
  return null;
}

/**
 * Execute the expand command: decompose a single task into subtasks.
 */
export async function executeExpand(
  tasks: TaskNode[],
  id: string,
  config: ProjectConfig,
  opts: ExpandOpts,
): Promise<ExpandResult> {
  const task = findTaskById(tasks, id);
  if (!task) {
    throw new Error(`Task "${id}" not found.`);
  }

  const validationError = validateExpandable(task, config.style, opts.force);
  if (validationError) {
    throw new Error(validationError);
  }

  const result = await expandTask(task, config.style, {
    maxSubtasks: opts.maxSubtasks,
    force: opts.force,
    statesConfig: config.states,
    model: config.ai.model,
    authAvailable: opts.authAvailable,
    provider: config.ai.provider,
  });

  if ('reason' in result) {
    throw new Error(result.reason);
  }

  task.children = result.children;

  return { task, children: result.children, tasks };
}

/**
 * Find all tasks eligible for expansion based on a complexity threshold.
 */
export function findExpandCandidates(tasks: TaskNode[], threshold: number): ExpandAllCandidate[] {
  return tasks
    .filter((t) => t.complexity >= threshold && t.children.length === 0)
    .map((t) => ({
      id: t.id,
      title: t.title,
      complexity: t.complexity,
      estimatedSubtasks: t.complexity <= 6 ? '~5' : `~${Math.min(10, t.complexity)}`,
    }));
}

/**
 * Execute the expand-all command: expand all tasks above the complexity threshold.
 */
export async function executeExpandAll(
  tasks: TaskNode[],
  config: ProjectConfig,
  opts: ExpandAllOpts,
): Promise<ExpandAllResult> {
  const batchResult = await expandMultiple(tasks, config.style, opts.threshold, {
    statesConfig: config.states,
    model: config.ai.model,
    authAvailable: opts.authAvailable,
    provider: config.ai.provider,
  });

  // Apply children to tasks in the array
  for (const result of batchResult.expanded) {
    const task = findTaskById(tasks, result.parentId);
    if (task) {
      task.children = result.children;
    }
  }

  return {
    expanded: batchResult.expanded,
    errors: batchResult.errors,
    tasks,
  };
}
