import type { ProjectConfig, TaskNode } from '../config/schema.js';
import { findTaskById, getDefaultStatus, resolveStates } from '../config/state-engine.js';
import { getValidTypes } from '../config/styles.js';
import { getNextId } from '../parser/index.js';
import { type AddTaskResult, runAddTaskPrompt } from '../prompts/add-task.js';
import { applyReadiness, recomputeAllReadiness } from '../readiness/index.js';

export interface AddCommandOpts {
  /** Positional type argument (e.g., "task", "story"). */
  typeArg?: string;
  /** --title flag for non-interactive mode. */
  title?: string;
  /** --type flag (overridden by positional typeArg if present). */
  type?: string;
  /** --priority flag. */
  priority?: string;
  /** --parent flag — ID of parent task. */
  parent?: string;
  /** --skills flag — comma-separated skill names. */
  skills?: string;
}

export interface AddResult {
  task: TaskNode;
  tasks: TaskNode[];
}

/**
 * Generate the next child ID for a parent task.
 * Follows the `{parentId}.{N}` convention used by the decomposer.
 */
function getNextChildId(parent: TaskNode): string {
  const nextIndex = parent.children.length + 1;
  return `${parent.id}.${nextIndex}`;
}

/**
 * Execute the add command: create a new task interactively or from flags.
 *
 * When `opts.title` is provided, runs in non-interactive mode using flag values.
 * Otherwise, launches the Inquirer.js prompt flow.
 */
export async function executeAdd(tasks: TaskNode[], config: ProjectConfig): Promise<AddResult>;
export async function executeAdd(
  tasks: TaskNode[],
  config: ProjectConfig,
  opts: AddCommandOpts,
): Promise<AddResult>;
export async function executeAdd(
  tasks: TaskNode[],
  config: ProjectConfig,
  opts: AddCommandOpts = {},
): Promise<AddResult> {
  const states = resolveStates(config.states);
  const validTypes = getValidTypes(config.style);
  const vocabulary = config.skills.vocabulary;

  let result: AddTaskResult;

  // Resolve effective type: positional arg takes precedence over --type flag
  const effectiveType = opts.typeArg ?? opts.type;

  if (opts.title) {
    // Non-interactive: build result from flags
    const resolvedType = effectiveType ?? validTypes[0];
    if (!validTypes.includes(resolvedType)) {
      throw new Error(
        `Invalid task type "${resolvedType}". Valid types for style "${config.style}": ${validTypes.join(', ')}`,
      );
    }

    const resolvedPriority = opts.priority ?? 'medium';
    const validPriorities = ['critical', 'high', 'medium', 'low'];
    if (!validPriorities.includes(resolvedPriority)) {
      throw new Error(
        `Invalid priority "${resolvedPriority}". Valid priorities: ${validPriorities.join(', ')}`,
      );
    }

    const resolvedSkills = opts.skills
      ? opts.skills
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

    result = {
      title: opts.title,
      type: resolvedType as AddTaskResult['type'],
      priority: resolvedPriority as AddTaskResult['priority'],
      requiredSkills: resolvedSkills,
      parentId: opts.parent ?? null,
      tags: [],
    };
  } else {
    // Interactive: delegate to Inquirer.js prompt flow
    const partialOpts: Partial<AddTaskResult> = {};
    if (effectiveType) partialOpts.type = effectiveType as AddTaskResult['type'];
    if (opts.priority) partialOpts.priority = opts.priority as AddTaskResult['priority'];
    if (opts.parent) partialOpts.parentId = opts.parent;
    if (opts.skills) {
      partialOpts.requiredSkills = opts.skills
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    }

    result = await runAddTaskPrompt(tasks, vocabulary, validTypes, partialOpts);
  }

  // Generate ID
  let id: string;
  let parentTask: TaskNode | undefined;

  if (result.parentId) {
    parentTask = findTaskById(tasks, result.parentId);
    if (!parentTask) {
      throw new Error(`Parent task "${result.parentId}" not found.`);
    }
    id = getNextChildId(parentTask);
  } else {
    id = String(getNextId(tasks));
  }

  // Build TaskNode
  const newTask: TaskNode = {
    id,
    title: result.title,
    description: '',
    type: result.type,
    status: getDefaultStatus(config.states),
    complexity: 1,
    priority: result.priority,
    requiredSkills: result.requiredSkills,
    dependencies: [],
    readiness: 'pending',
    assignee: null,
    outputs: [],
    tags: result.tags,
    qaFeedback: [],
    children: [],
    metadata: {
      source: '',
      autoExpanded: false,
      skillsInferred: false,
      createdAt: new Date().toISOString(),
    },
  };

  // Insert into tree
  if (parentTask) {
    parentTask.children.push(newTask);
  } else {
    tasks.push(newTask);
  }

  // Recompute readiness
  const readinessResults = recomputeAllReadiness(tasks, states);
  applyReadiness(tasks, readinessResults);

  return { task: newTask, tasks };
}
