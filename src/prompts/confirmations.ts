import {
  confirmPrompt,
  checkboxWithDefaults,
  numberWithDefault,
} from './factory.js';

// --- Remove confirmation ---

export interface RemoveConfirmResult {
  confirmed: boolean;
}

/**
 * Confirmation prompt for removing a task and its children.
 * Bypassed when opts.force is true.
 */
export async function confirmRemove(
  taskId: string,
  taskTitle: string,
  childCount: number,
  opts?: { force?: boolean },
): Promise<RemoveConfirmResult> {
  if (opts?.force) return { confirmed: true };

  const childInfo = childCount > 0 ? ` and its ${childCount} child task(s)` : '';
  const confirmed = await confirmPrompt(
    `Remove "${taskId}: ${taskTitle}"${childInfo}? This cannot be undone.`,
    false,
  );
  return { confirmed };
}

// --- Expand confirmation ---

export interface ExpandConfirmResult {
  taskIds: string[];
  maxSubtasks: number;
  confirmed: boolean;
}

/**
 * Confirmation prompt for expanding tasks into subtasks.
 * Handles both single-task and bulk (multi-task) scenarios.
 * Bypassed when opts.confirmed is true.
 */
export async function confirmExpand(
  tasks: Array<{ id: string; title: string; complexity: number }>,
  opts?: Partial<ExpandConfirmResult>,
): Promise<ExpandConfirmResult> {
  if (opts?.confirmed) {
    return {
      taskIds: opts.taskIds ?? tasks.map((t) => t.id),
      maxSubtasks: opts.maxSubtasks ?? 5,
      confirmed: true,
    };
  }

  // Single task: just confirm
  if (tasks.length === 1) {
    const task = tasks[0];
    const maxSubtasks =
      opts?.maxSubtasks ??
      (await numberWithDefault(
        'maxSubtasks',
        `Max subtasks to generate for "${task.id}: ${task.title}" (complexity: ${task.complexity}):`,
        { min: 1, max: 10, defaultValue: task.complexity <= 6 ? 5 : 10 },
      ));
    const confirmed = await confirmPrompt(
      `Expand "${task.id}: ${task.title}" into up to ${maxSubtasks} subtasks?`,
      true,
    );
    return { taskIds: [task.id], maxSubtasks, confirmed };
  }

  // Multiple tasks (bulk): select which ones
  const taskChoices = tasks.map((t) => ({
    name: `${t.id}: ${t.title} (complexity: ${t.complexity})`,
    value: t.id,
  }));
  const taskIds =
    opts?.taskIds ??
    (await checkboxWithDefaults('expandTasks', 'Select tasks to expand:', taskChoices));

  if (taskIds.length === 0) {
    return { taskIds: [], maxSubtasks: 5, confirmed: false };
  }

  const maxSubtasks =
    opts?.maxSubtasks ??
    (await numberWithDefault('maxSubtasks', 'Max subtasks per task:', {
      min: 1,
      max: 10,
      defaultValue: 5,
    }));

  const confirmed = await confirmPrompt(
    `Expand ${taskIds.length} task(s) into subtasks?`,
    true,
  );
  return { taskIds, maxSubtasks, confirmed };
}

// --- Bulk operation confirmation ---

export interface BulkConfirmResult {
  confirmed: boolean;
  dryRun: boolean;
}

/**
 * Confirmation prompt for bulk operations.
 * Supports --force bypass and --dry-run mode.
 */
export async function confirmBulkOperation(
  operation: string,
  count: number,
  opts?: { force?: boolean; dryRun?: boolean },
): Promise<BulkConfirmResult> {
  if (opts?.force) return { confirmed: true, dryRun: opts.dryRun ?? false };

  const dryRun =
    opts?.dryRun ?? (await confirmPrompt('Run in dry-run mode (preview only)?', false));
  if (dryRun) return { confirmed: true, dryRun: true };

  const confirmed = await confirmPrompt(`${operation} ${count} item(s)?`, true);
  return { confirmed, dryRun: false };
}
