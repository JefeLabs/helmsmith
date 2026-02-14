import { z } from 'zod';
import { safeLoad } from '../formats/yaml-bridge.js';
import type { ParsedSection } from './types.js';

/** Schema for a single task in a YAML plan */
const YamlTaskSchema: z.ZodType<YamlTask> = z.lazy(() =>
  z.object({
    title: z.string(),
    description: z.string().optional(),
    priority: z.enum(['critical', 'high', 'medium', 'low']).optional(),
    tags: z.array(z.string()).optional(),
    children: z.array(YamlTaskSchema).optional(),
  }),
);

interface YamlTask {
  title: string;
  description?: string;
  priority?: 'critical' | 'high' | 'medium' | 'low';
  tags?: string[];
  children?: YamlTask[];
}

/** Schema for the entire YAML plan file */
const YamlPlanSchema = z.object({
  title: z.string().optional(),
  tasks: z.array(YamlTaskSchema),
});

/**
 * Convert a YamlTask tree into a ParsedSection tree.
 */
function yamlTaskToSection(task: YamlTask, depth: number): ParsedSection {
  const children = (task.children ?? []).map((child) => yamlTaskToSection(child, depth + 1));

  return {
    title: task.title,
    depth,
    body: task.description ?? '',
    children,
    priority: task.priority,
    tags: task.tags,
  };
}

/**
 * Parse YAML plan content into a nested tree of ParsedSection objects.
 *
 * Expects a structure with:
 * - An optional `title` field (plan-level title, not used as a task)
 * - A `tasks` array, each with title, optional description/priority/tags/children
 *
 * Validates against a Zod schema and converts to ParsedSection tree.
 */
export function parseYamlPlan(content: string): ParsedSection[] {
  const raw = safeLoad(content);
  const plan = YamlPlanSchema.parse(raw);

  return plan.tasks.map((task) => yamlTaskToSection(task, 1));
}
