import type { TaskNode } from '../config/schema.js';
import { PROJECT_STYLES } from '../config/styles.js';
import type { ParsedSection, ParseOptions } from './types.js';

/**
 * Get the task type for a given heading depth in the context of a project style.
 * If depth exceeds maxDepth, clamps to the deepest allowed type.
 * Returns { type, clamped } where clamped=true means depth was collapsed.
 */
function getTypeForDepth(
  style: string,
  depth: number,
): { type: 'epic' | 'story' | 'task' | 'subtask'; clamped: boolean } {
  const styleDef = PROJECT_STYLES[style];
  const hierarchy = styleDef ? styleDef.hierarchy : ['task'];
  const index = Math.min(depth - 1, hierarchy.length - 1);
  const clamped = depth - 1 >= hierarchy.length;
  return {
    type: hierarchy[index] as 'epic' | 'story' | 'task' | 'subtask',
    clamped,
  };
}

/**
 * Recursively convert a ParsedSection tree into TaskNode objects.
 */
function sectionToTask(
  section: ParsedSection,
  parentId: string,
  index: number,
  options: ParseOptions,
  warnings: string[],
): TaskNode {
  const id = parentId ? `${parentId}.${index}` : `${index}`;
  const { type, clamped } = getTypeForDepth(options.style, section.depth);

  if (clamped) {
    warnings.push(
      `Heading "${section.title}" at depth ${section.depth} exceeds max depth for style "${options.style}"; collapsed to type "${type}".`,
    );
  }

  const children = section.children.map((child, i) =>
    sectionToTask(child, id, i + 1, options, warnings),
  );

  return {
    id,
    title: section.title,
    description: section.body,
    type,
    status: options.defaultStatus,
    complexity: 1,
    priority: section.priority ?? 'medium',
    requiredSkills: [],
    dependencies: [],
    readiness: 'pending',
    assignee: null,
    outputs: [],
    tags: section.tags ?? [],
    qaFeedback: [],
    children,
    metadata: {
      source: '',
      autoExpanded: false,
      skillsInferred: false,
      createdAt: new Date().toISOString(),
    },
  };
}

/**
 * Merge the two smallest adjacent top-level sections into one.
 * The second section's content is appended to the first, and
 * the second section's children become children of the first.
 */
function mergeSmallestAdjacent(sections: ParsedSection[]): ParsedSection[] {
  if (sections.length <= 1) return sections;

  // Find the pair of adjacent sections with the smallest combined body length
  let minCombined = Infinity;
  let minIndex = 0;

  for (let i = 0; i < sections.length - 1; i++) {
    const combined = sections[i].body.length + sections[i + 1].body.length;
    if (combined < minCombined) {
      minCombined = combined;
      minIndex = i;
    }
  }

  const merged: ParsedSection = {
    title: sections[minIndex].title,
    depth: sections[minIndex].depth,
    body: [sections[minIndex].body, sections[minIndex + 1].body].filter(Boolean).join('\n\n'),
    children: [
      ...sections[minIndex].children,
      // Promote the second section to a child of the first
      {
        title: sections[minIndex + 1].title,
        depth: sections[minIndex].depth + 1,
        body: sections[minIndex + 1].body,
        children: sections[minIndex + 1].children,
      },
    ],
  };

  const result = [...sections];
  result.splice(minIndex, 2, merged);
  return result;
}

/**
 * Apply --num-tasks section merging.
 * Repeatedly merges the two smallest adjacent top-level sections
 * until sections.length <= numTasks.
 */
function applyNumTasksMerge(sections: ParsedSection[], numTasks: number): ParsedSection[] {
  let result = sections;
  while (result.length > numTasks) {
    result = mergeSmallestAdjacent(result);
  }
  return result;
}

/**
 * Count all tasks recursively in a TaskNode tree.
 */
function _countTasks(tasks: TaskNode[]): number {
  let count = tasks.length;
  for (const task of tasks) {
    count += _countTasks(task.children);
  }
  return count;
}

/**
 * Convert a ParsedSection tree into a TaskNode array.
 *
 * Handles:
 * - Heading depth -> type mapping based on project style
 * - Numeric ID assignment (top-level: "1", "2"; children: "1.1", "1.2")
 * - --num-tasks section merging (merge smallest adjacent sections if > target)
 * - Default field values (status, complexity, readiness, etc.)
 *
 * @param sections - Parsed sections from a format-specific parser
 * @param options - Parser options (style, defaultStatus, numTasks)
 * @param startId - Starting ID for top-level tasks (default 1, used for append mode)
 */
export function generateTasks(
  sections: ParsedSection[],
  options: ParseOptions,
  startId: number = 1,
): { tasks: TaskNode[]; warnings: string[] } {
  const warnings: string[] = [];

  // Apply --num-tasks merging if specified
  let finalSections = sections;
  if (options.numTasks && sections.length > options.numTasks) {
    finalSections = applyNumTasksMerge(sections, options.numTasks);
  }

  const tasks = finalSections.map((section, i) =>
    sectionToTask(section, '', startId + i, options, warnings),
  );

  return { tasks, warnings };
}

/**
 * Compute the next available top-level ID given existing tasks.
 *
 * Scans all task IDs recursively, extracts the leading integer from each,
 * and returns max + 1. Returns 1 if no existing tasks.
 */
export function getNextId(existingTasks: TaskNode[]): number {
  let maxId = 0;

  function scan(tasks: TaskNode[]): void {
    for (const task of tasks) {
      // Extract leading integer from the ID (e.g., "5" from "5", "5" from "5.2.1")
      const match = task.id.match(/^(\d+)/);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > maxId) {
          maxId = num;
        }
      }
      if (task.children.length > 0) {
        scan(task.children);
      }
    }
  }

  scan(existingTasks);
  return maxId + 1;
}

/**
 * Re-number a set of tasks starting from a given ID.
 * Used in append mode to adjust IDs of newly parsed tasks.
 */
export function renumberTasks(tasks: TaskNode[], startId: number): TaskNode[] {
  return tasks.map((task, i) => renumberTask(task, '', startId + i));
}

function renumberTask(task: TaskNode, parentId: string, index: number): TaskNode {
  const newId = parentId ? `${parentId}.${index}` : `${index}`;

  return {
    ...task,
    id: newId,
    children: task.children.map((child, i) => renumberTask(child, newId, i + 1)),
  };
}
