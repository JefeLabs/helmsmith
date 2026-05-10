import type { TaskNode } from '../config/schema.js';
import {
  checkboxWithDefaults,
  inputWithDefault,
  listWithDefault,
  searchPrompt,
} from './factory.js';

export interface AddTaskResult {
  title: string;
  type: 'epic' | 'story' | 'task' | 'subtask';
  priority: 'critical' | 'high' | 'medium' | 'low';
  requiredSkills: string[];
  parentId: string | null;
  tags: string[];
}

/**
 * Interactive add-task prompt flow.
 * Pass partial opts to skip corresponding prompts (for --no-interactive).
 * Returns typed result — caller handles persistence.
 */
export async function runAddTaskPrompt(
  existingTasks: TaskNode[],
  skillVocabulary: string[],
  validTypes: string[],
  opts?: Partial<AddTaskResult>,
): Promise<AddTaskResult> {
  // Step 1: Title
  const title =
    opts?.title ??
    (await inputWithDefault('taskTitle', 'Task title:', {
      validate: (v) => v.trim().length > 0 || 'Task title cannot be empty',
    }));

  // Step 2: Type
  const typeChoices = validTypes.map((t) => ({
    name: t,
    value: t as AddTaskResult['type'],
  }));
  const type = opts?.type ?? (await listWithDefault('taskType', 'Task type:', typeChoices));

  // Step 3: Priority
  const priorityChoices = [
    { name: 'Critical', value: 'critical' as const },
    { name: 'High', value: 'high' as const },
    { name: 'Medium', value: 'medium' as const },
    { name: 'Low', value: 'low' as const },
  ];
  const priority =
    opts?.priority ?? (await listWithDefault('taskPriority', 'Priority:', priorityChoices));

  // Step 4: Required skills (from vocabulary)
  let requiredSkills: string[];
  if (opts?.requiredSkills) {
    requiredSkills = opts.requiredSkills;
  } else if (skillVocabulary.length > 0) {
    const skillChoices = skillVocabulary.map((s) => ({ name: s, value: s }));
    requiredSkills = await checkboxWithDefaults('taskSkills', 'Required skills:', skillChoices);
  } else {
    requiredSkills = [];
  }

  // Step 5: Parent selection (search prompt with task IDs)
  let parentId: string | null;
  if (opts?.parentId !== undefined) {
    parentId = opts.parentId;
  } else {
    const flatTasks = flattenTasks(existingTasks);
    const parentChoices: Array<{ name: string; value: string }> = [
      { name: 'None (top-level task)', value: '__none__' },
      ...flatTasks.map((t) => ({
        name: `${t.id}: ${t.title}`,
        value: t.id,
      })),
    ];
    if (parentChoices.length > 1) {
      const selected = await searchPrompt('Parent task:', parentChoices);
      parentId = selected === '__none__' ? null : selected;
    } else {
      parentId = null;
    }
  }

  // Step 6: Tags (from opts only for v1; interactive tag entry can be enhanced later)
  const tags = opts?.tags ?? [];

  return {
    title: title.trim(),
    type,
    priority,
    requiredSkills,
    parentId,
    tags,
  };
}

/**
 * Flatten task tree into a flat list for search prompt.
 */
function flattenTasks(tasks: TaskNode[]): Array<{ id: string; title: string }> {
  const result: Array<{ id: string; title: string }> = [];
  for (const task of tasks) {
    result.push({ id: task.id, title: task.title });
    if (task.children.length > 0) {
      result.push(...flattenTasks(task.children));
    }
  }
  return result;
}
