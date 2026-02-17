import type { TaskNode } from '../config/schema.js';
import type { ChatCompletionMessage } from '../auth/types.js';
import { callAI } from '../auth/call-ai.js';
import type { AIProviderName } from '../auth/provider.js';
import { PROJECT_STYLES } from '../config/styles.js';
import type { ParseOptions } from './types.js';

/**
 * Lightweight task shape for the AI response (no metadata/readiness/etc.).
 * The AI returns this minimal structure; we hydrate into full TaskNodes.
 */
interface AITask {
  title: string;
  description: string;
  type: string;
  priority: string;
  dependencies: string[];
  requiredSkills: string[];
  children: AITask[];
}

interface AIParseResponse {
  tasks: AITask[];
}

/**
 * Build the prompt that instructs the LLM to decompose a document into tasks.
 */
function buildParsePrompt(
  content: string,
  options: ParseOptions,
): ChatCompletionMessage[] {
  const style = PROJECT_STYLES[options.style];
  const hierarchy = style ? style.hierarchy : ['task'];
  const maxDepth = style ? style.maxDepth : 2;
  const numTasksHint = options.numTasks
    ? `Aim for approximately ${options.numTasks} top-level tasks.`
    : 'Create as many top-level tasks as the document naturally supports (typically 5-20).';

  return [
    {
      role: 'system',
      content: [
        'You are a project planner that converts implementation documents into structured task hierarchies.',
        'Given a document, break it down into actionable development tasks.',
        '',
        'Return ONLY a JSON object with no additional text, markdown, or explanation.',
        'Format: {"tasks": [...]}',
        '',
        'Each task object has these fields:',
        '  - title: string (concise, actionable title)',
        '  - description: string (what needs to be done, key details from the document)',
        '  - type: string (one of: ' + hierarchy.map(h => `"${h}"`).join(', ') + ')',
        '  - priority: string (one of: "critical", "high", "medium", "low")',
        '  - dependencies: string[] (titles of other tasks this depends on, empty if none)',
        '  - requiredSkills: string[] (e.g., "backend", "frontend", "database", "devops", "testing")',
        '  - children: array of child tasks (same structure, use deeper type levels)',
        '',
        `Project style: "${options.style}" with hierarchy: ${hierarchy.join(' → ')} (max depth: ${maxDepth})`,
        `Top-level tasks should use type "${hierarchy[0]}".`,
        hierarchy.length > 1 ? `Nested tasks use: ${hierarchy.slice(1).join(' → ')}.` : '',
        '',
        'Rules:',
        '- Each top-level task should represent a major workstream or phase',
        '- Children break down work into implementable units',
        '- Dependencies reference task titles (not IDs)',
        '- Be specific about what each task delivers',
        '- Preserve technical details from the document in descriptions',
        numTasksHint,
      ].filter(Boolean).join('\n'),
    },
    {
      role: 'user',
      content: content,
    },
  ];
}

/**
 * Parse the AI response into a flat-friendly AITask array.
 * Strips markdown code fences if present.
 */
function parseAIResponse(responseContent: string): AITask[] | null {
  try {
    let cleaned = responseContent.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
    }

    const parsed = JSON.parse(cleaned) as AIParseResponse;

    if (!Array.isArray(parsed.tasks) || parsed.tasks.length === 0) {
      return null;
    }

    return parsed.tasks;
  } catch {
    return null;
  }
}

/**
 * Recursively convert an AITask into a full TaskNode with IDs and defaults.
 */
function aiTaskToNode(
  aiTask: AITask,
  parentId: string,
  index: number,
  defaultStatus: string,
  validTypes: string[],
): TaskNode {
  const id = parentId ? `${parentId}.${index}` : `${index}`;

  // Validate type against the style hierarchy, fallback to deepest allowed
  const type = validTypes.includes(aiTask.type)
    ? (aiTask.type as TaskNode['type'])
    : (validTypes[validTypes.length - 1] as TaskNode['type']);

  const priority = ['critical', 'high', 'medium', 'low'].includes(aiTask.priority)
    ? (aiTask.priority as TaskNode['priority'])
    : 'medium';

  const children = (aiTask.children ?? []).map((child, i) =>
    aiTaskToNode(child, id, i + 1, defaultStatus, validTypes),
  );

  return {
    id,
    title: aiTask.title || 'Untitled',
    description: aiTask.description || '',
    type,
    status: defaultStatus,
    complexity: 1,
    priority,
    requiredSkills: Array.isArray(aiTask.requiredSkills) ? aiTask.requiredSkills : [],
    dependencies: [],
    readiness: 'pending',
    assignee: null,
    outputs: [],
    tags: [],
    children,
    metadata: {
      source: 'ai',
      autoExpanded: false,
      skillsInferred: true,
      createdAt: new Date().toISOString(),
    },
  };
}

/**
 * Resolve title-based dependencies into ID-based dependencies.
 * The AI returns dependency titles; we match them to task IDs.
 */
function resolveDependencies(tasks: TaskNode[], aiTasks: AITask[]): void {
  // Build title -> ID map (top-level only for simplicity)
  const titleToId = new Map<string, string>();
  for (const task of tasks) {
    titleToId.set(task.title.toLowerCase(), task.id);
  }

  // Walk both arrays in parallel to map AI deps to IDs
  function resolve(nodes: TaskNode[], aiNodes: AITask[]): void {
    for (let i = 0; i < nodes.length && i < aiNodes.length; i++) {
      const deps = aiNodes[i].dependencies ?? [];
      for (const depTitle of deps) {
        const depId = titleToId.get(depTitle.toLowerCase());
        if (depId && depId !== nodes[i].id) {
          nodes[i].dependencies.push({ taskId: depId, type: 'blocks' });
        }
      }
      if (nodes[i].children.length > 0 && aiNodes[i].children) {
        resolve(nodes[i].children, aiNodes[i].children);
      }
    }
  }

  resolve(tasks, aiTasks);
}

/**
 * Parse a document using AI (Copilot). Sends the full document content
 * to the LLM and returns a structured task breakdown.
 *
 * @returns TaskNode[] on success, or null if AI parsing fails
 */
export async function parseWithAI(
  content: string,
  model: string,
  options: ParseOptions,
  provider?: AIProviderName,
): Promise<{ tasks: TaskNode[]; warning?: string } | null> {
  const messages = buildParsePrompt(content, options);
  const response = await callAI(messages, model, provider);
  const responseContent = response.choices?.[0]?.message?.content;

  if (!responseContent) {
    return null;
  }

  const aiTasks = parseAIResponse(responseContent);
  if (!aiTasks) {
    return null;
  }

  const style = PROJECT_STYLES[options.style];
  const validTypes = style ? style.hierarchy : ['task'];

  const tasks = aiTasks.map((aiTask, i) =>
    aiTaskToNode(aiTask, '', i + 1, options.defaultStatus, validTypes),
  );

  // Resolve title-based dependencies to IDs
  resolveDependencies(tasks, aiTasks);

  return { tasks };
}
