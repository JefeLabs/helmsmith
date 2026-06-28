import { callAI } from '../auth/call-ai.js';
import type { ChatCompletionMessage } from '../auth/types.js';
import type { TaskNode } from '../config/schema.js';
import { getDefaultStatus } from '../config/state-engine.js';
import { PROJECT_STYLES } from '../config/styles.js';
import type {
  BatchExpansionResult,
  ExpansionError,
  ExpansionOptions,
  ExpansionResult,
} from './types.js';

/**
 * Determine the child type for a given parent type within a project style.
 * Returns null if the parent is already at max depth (cannot expand further).
 */
export function getChildType(parentType: string, styleKey: string): string | null {
  const style = PROJECT_STYLES[styleKey];
  if (!style) return null;

  const index = style.hierarchy.indexOf(parentType);
  if (index === -1) return null;
  if (index >= style.hierarchy.length - 1) return null;

  return style.hierarchy[index + 1];
}

/**
 * Generate a subtask ID from the parent ID and a 1-based child index.
 * Example: generateSubtaskId('T-3', 1) -> 'T-3.1'
 */
export function generateSubtaskId(parentId: string, index: number): string {
  return `${parentId}.${index}`;
}

/**
 * Determine the default max subtasks based on the task's complexity score.
 * Score 4-6 (medium): 3-5 subtasks, score 7-10 (high): 5-10 subtasks.
 */
function defaultMaxSubtasks(complexity: number): number {
  if (complexity <= 3) return 3;
  if (complexity <= 6) return 5;
  return Math.min(10, complexity);
}

/**
 * Build the Copilot API messages for subtask generation.
 */
export function buildExpansionPrompt(
  task: TaskNode,
  maxSubtasks: number,
  childType: string,
): ChatCompletionMessage[] {
  const system: ChatCompletionMessage = {
    role: 'system',
    content: [
      'You are a project planning assistant that decomposes tasks into subtasks.',
      'You always respond with a valid JSON array and nothing else.',
      'Each element must have "title" (string) and "description" (string) fields.',
      'Do not include any markdown formatting, code fences, or explanation outside the JSON.',
    ].join(' '),
  };

  const skillsInfo =
    task.requiredSkills.length > 0 ? `\nRequired skills: ${task.requiredSkills.join(', ')}` : '';
  const depsInfo =
    task.dependencies.length > 0
      ? `\nThis task has ${task.dependencies.length} dependency(ies).`
      : '';

  const user: ChatCompletionMessage = {
    role: 'user',
    content: [
      `Break down the following task into ${maxSubtasks} or fewer ${childType}-level subtasks.`,
      '',
      `Task title: ${task.title}`,
      `Task description: ${task.description}`,
      skillsInfo,
      depsInfo,
      '',
      `Generate up to ${maxSubtasks} subtasks as a JSON array: [{"title": "...", "description": "..."}]`,
      `Each subtask should be a concrete, actionable ${childType} that contributes to completing the parent task.`,
    ]
      .filter((line) => line !== undefined)
      .join('\n'),
  };

  return [system, user];
}

/**
 * Parse the AI response content into an array of {title, description} objects.
 * Handles markdown code fences and validates structure.
 */
export function parseExpansionResponse(
  content: string,
): Array<{ title: string; description: string }> {
  let cleaned = content.trim();

  // Strip markdown code fences (```json ... ``` or ``` ... ```)
  const fencePattern = /^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/;
  const fenceMatch = cleaned.match(fencePattern);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }

  // Try to extract a JSON array if surrounded by other text
  if (!cleaned.startsWith('[')) {
    const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      cleaned = arrayMatch[0];
    }
  }

  const parsed = JSON.parse(cleaned);
  if (!Array.isArray(parsed)) {
    throw new Error('AI response is not a JSON array');
  }

  return parsed
    .filter(
      (item: unknown) =>
        item &&
        typeof item === 'object' &&
        typeof (item as Record<string, unknown>).title === 'string' &&
        typeof (item as Record<string, unknown>).description === 'string',
    )
    .map((item: Record<string, unknown>) => ({
      title: item.title as string,
      description: item.description as string,
    }));
}

/**
 * Heuristic fallback: generate subtask titles and descriptions from the parent.
 * Tries paragraph splitting, then bullet splitting, then sentence splitting,
 * then falls back to "Part N of M" naming.
 */
export function heuristicExpand(
  task: TaskNode,
  maxSubtasks: number,
): Array<{ title: string; description: string }> {
  const desc = (task.description || '').trim();

  if (desc.length === 0) {
    return generatePartSubtasks(task.title, maxSubtasks);
  }

  // Try splitting by bullet points (lines starting with - or *)
  const bulletLines = desc
    .split('\n')
    .filter((line) => /^\s*[-*]\s+/.test(line))
    .map((line) => line.replace(/^\s*[-*]\s+/, '').trim())
    .filter((line) => line.length > 0);

  if (bulletLines.length >= 2) {
    return bulletLines.slice(0, maxSubtasks).map((line) => ({
      title: truncateTitle(line),
      description: line,
    }));
  }

  // Try splitting by paragraphs (double newlines)
  const paragraphs = desc
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  if (paragraphs.length >= 2) {
    return paragraphs.slice(0, maxSubtasks).map((p) => ({
      title: truncateTitle(p),
      description: p,
    }));
  }

  // Try splitting by sentences
  const sentences = desc
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (sentences.length >= 2) {
    // Group sentences into maxSubtasks chunks
    const chunkSize = Math.ceil(sentences.length / maxSubtasks);
    const chunks: string[] = [];
    for (let i = 0; i < sentences.length; i += chunkSize) {
      chunks.push(sentences.slice(i, i + chunkSize).join(' '));
    }
    return chunks.slice(0, maxSubtasks).map((chunk) => ({
      title: truncateTitle(chunk),
      description: chunk,
    }));
  }

  // Fallback: "Part N of M"
  return generatePartSubtasks(task.title, maxSubtasks);
}

/**
 * Generate generic "Part N of M" subtasks.
 */
function generatePartSubtasks(
  parentTitle: string,
  count: number,
): Array<{ title: string; description: string }> {
  const result: Array<{ title: string; description: string }> = [];
  for (let i = 1; i <= count; i++) {
    result.push({
      title: `Part ${i} of ${count}: ${parentTitle}`,
      description: `Part ${i} of the "${parentTitle}" task.`,
    });
  }
  return result;
}

/**
 * Truncate text to a reasonable title length (80 chars).
 * Takes the first line and truncates with ellipsis if needed.
 */
function truncateTitle(text: string): string {
  const firstLine = text.split('\n')[0].trim();
  if (firstLine.length <= 80) return firstLine;
  return `${firstLine.substring(0, 77)}...`;
}

/**
 * Expand a single task into subtasks.
 * Uses AI (Copilot) when authenticated, falls back to heuristic.
 */
export async function expandTask(
  task: TaskNode,
  styleKey: string,
  options: ExpansionOptions,
): Promise<ExpansionResult | ExpansionError> {
  const childType = getChildType(task.type, styleKey);

  if (!childType) {
    const style = PROJECT_STYLES[styleKey];
    const styleName = style?.name ?? styleKey;
    return {
      parentId: task.id,
      reason: `Cannot expand ${task.id}: already at maximum depth (${task.type}) for style '${styleName}'.`,
    };
  }

  if (task.children.length > 0 && !options.force) {
    return {
      parentId: task.id,
      reason: `Task ${task.id} already has ${task.children.length} subtask(s). Use --force to re-expand.`,
    };
  }

  const maxSubtasks = options.maxSubtasks ?? defaultMaxSubtasks(task.complexity);

  // Dry-run: return estimate without generating
  if (options.dryRun) {
    return {
      parentId: task.id,
      children: [],
      dryRun: true,
      estimatedCount: maxSubtasks,
    };
  }

  // Generate subtask content (AI or heuristic)
  let rawSubtasks: Array<{ title: string; description: string }>;

  if (options.authAvailable && options.model) {
    try {
      const messages = buildExpansionPrompt(task, maxSubtasks, childType);
      const response = await callAI(messages, options.model, options.provider, 'expander');
      const content = response.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error('Empty response from AI');
      }
      rawSubtasks = parseExpansionResponse(content);
      if (rawSubtasks.length === 0) {
        throw new Error('AI returned no valid subtasks');
      }
    } catch {
      // Fall back to heuristic on any AI failure
      rawSubtasks = heuristicExpand(task, maxSubtasks);
    }
  } else {
    rawSubtasks = heuristicExpand(task, maxSubtasks);
  }

  // Limit to maxSubtasks
  rawSubtasks = rawSubtasks.slice(0, maxSubtasks);

  // Build TaskNode children
  const defaultStatus = getDefaultStatus(options.statesConfig);
  const children: TaskNode[] = rawSubtasks.map((raw, i) => ({
    id: generateSubtaskId(task.id, i + 1),
    title: raw.title,
    description: raw.description,
    type: childType as TaskNode['type'],
    status: defaultStatus,
    complexity: 1,
    priority: task.priority,
    requiredSkills: [...task.requiredSkills],
    dependencies: [],
    readiness: 'pending' as const,
    assignee: null,
    outputs: [],
    tags: [...task.tags],
    qaFeedback: [],
    children: [],
    metadata: {
      source: `expanded from ${task.id}`,
      autoExpanded: true,
      skillsInferred: false,
      createdAt: new Date().toISOString(),
    },
  }));

  return {
    parentId: task.id,
    children,
    dryRun: false,
  };
}

/**
 * Batch-expand multiple tasks. Used by the expand-all command.
 * Only expands tasks above the complexity threshold with no existing children.
 */
export async function expandMultiple(
  tasks: TaskNode[],
  styleKey: string,
  threshold: number,
  options: ExpansionOptions,
): Promise<BatchExpansionResult> {
  const eligible = tasks.filter((t) => t.complexity >= threshold && t.children.length === 0);

  const expanded: ExpansionResult[] = [];
  const errors: ExpansionError[] = [];
  const skipped = tasks.length - eligible.length;

  for (const task of eligible) {
    const result = await expandTask(task, styleKey, options);
    if ('reason' in result) {
      errors.push(result);
    } else {
      expanded.push(result);
    }
  }

  return { expanded, errors, skipped };
}
