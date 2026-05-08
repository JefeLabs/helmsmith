import type { TaskNode, StateDefinition, QAFeedbackEntry } from '../config/schema.js';
import { findTaskById } from '../config/state-engine.js';
import { recomputeAllReadiness, applyReadiness } from '../readiness/index.js';

export interface QAClearOpts {
  reporter?: string;
  note?: string;
}

export interface QAClearResult {
  task: TaskNode;
  tagRemoved: boolean;
  feedbackEntry: QAFeedbackEntry;
  tasks: TaskNode[];
}

// --- Batch types ---

export interface QAClearBatchEntry {
  taskId: string;
  reporter?: string;
  note?: string;
}

export interface QAClearBatchResult {
  entries: Array<{
    taskId: string;
    tagRemoved: boolean;
    feedbackEntry: QAFeedbackEntry;
  }>;
  errors: Array<{
    taskId: string;
    error: string;
  }>;
  tasks: TaskNode[];
}

/**
 * Process multiple QA clears atomically:
 * 1. Remove tags and append pass entries for all tasks
 * 2. Single recomputeAllReadiness + applyReadiness at the end
 * 3. Invalid task IDs are collected as errors — valid entries still process
 */
export function executeQAClearBatch(
  tasks: TaskNode[],
  clears: QAClearBatchEntry[],
  states: StateDefinition[],
): QAClearBatchResult {
  const entries: QAClearBatchResult['entries'] = [];
  const errors: QAClearBatchResult['errors'] = [];

  for (const clear of clears) {
    const task = findTaskById(tasks, clear.taskId);
    if (!task) {
      errors.push({ taskId: clear.taskId, error: `Task "${clear.taskId}" not found.` });
      continue;
    }

    // Remove qa-review-needed tag
    const tagIndex = task.tags.indexOf('qa-review-needed');
    const tagRemoved = tagIndex !== -1;
    if (tagRemoved) {
      task.tags.splice(tagIndex, 1);
    }

    // Also remove qa-failed-source tag if present
    const sourceTagIndex = task.tags.indexOf('qa-failed-source');
    if (sourceTagIndex !== -1) {
      task.tags.splice(sourceTagIndex, 1);
    }

    // Build pass feedback entry
    const feedbackEntry: QAFeedbackEntry = {
      testType: 'other',
      result: 'pass',
      description: clear.note ?? 'QA review cleared',
      cause: '',
      severity: 'major',
      reporter: clear.reporter ?? 'qa-agent',
      timestamp: new Date().toISOString(),
    };

    task.qaFeedback.push(feedbackEntry);

    entries.push({ taskId: clear.taskId, tagRemoved, feedbackEntry });
  }

  // Single readiness recompute after all mutations
  const readinessResults = recomputeAllReadiness(tasks, states);
  applyReadiness(tasks, readinessResults);

  return { entries, errors, tasks };
}

/**
 * Execute the qa-clear command:
 * 1. Remove qa-review-needed tag from the task
 * 2. Append a QAFeedbackEntry with result: 'pass' (audit trail)
 * 3. Recompute readiness
 */
export function executeQAClear(
  tasks: TaskNode[],
  targetId: string,
  states: StateDefinition[],
  opts: QAClearOpts = {},
): QAClearResult {
  const task = findTaskById(tasks, targetId);
  if (!task) {
    throw new Error(`Task "${targetId}" not found.`);
  }

  // Remove qa-review-needed tag
  const tagIndex = task.tags.indexOf('qa-review-needed');
  const tagRemoved = tagIndex !== -1;
  if (tagRemoved) {
    task.tags.splice(tagIndex, 1);
  }

  // Also remove qa-failed-source tag if present (task was fixed)
  const sourceTagIndex = task.tags.indexOf('qa-failed-source');
  if (sourceTagIndex !== -1) {
    task.tags.splice(sourceTagIndex, 1);
  }

  // Build pass feedback entry for audit trail
  const feedbackEntry: QAFeedbackEntry = {
    testType: 'other',
    result: 'pass',
    description: opts.note ?? 'QA review cleared',
    cause: '',
    severity: 'major',
    reporter: opts.reporter ?? 'qa-agent',
    timestamp: new Date().toISOString(),
  };

  task.qaFeedback.push(feedbackEntry);

  // Recompute readiness
  const readinessResults = recomputeAllReadiness(tasks, states);
  applyReadiness(tasks, readinessResults);

  return {
    task,
    tagRemoved,
    feedbackEntry,
    tasks,
  };
}
