import type { TaskNode } from '../config/schema.js';
import type { BlueprintConcern, ConcernUrgency } from './types.js';
import { groupByUrgency } from './resolver.js';

interface TierConfig {
  title: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  order: number;
}

const TIER_CONFIG: Record<ConcernUrgency, TierConfig> = {
  upfront: { title: 'Upfront Requirements', priority: 'critical', order: 0 },
  'pattern-first': { title: 'Pattern-First Foundations', priority: 'high', order: 1 },
  deferred: { title: 'Deferred Enhancements', priority: 'low', order: 2 },
};

export interface GenerateOptions {
  blueprintId: string;
  style?: 'grouped' | 'flat';
  defaultStatus?: string;
  startId?: number;
}

/**
 * Convert resolved concerns into TaskNode[] for injection into tasks.json.
 *
 * In 'grouped' mode (default), creates parent tasks per urgency tier with
 * each concern as a child task. Dependencies flow: upfront → pattern-first → deferred.
 *
 * In 'flat' mode, generates top-level tasks with priority derived from urgency.
 */
export function generateConcernTasks(
  concerns: BlueprintConcern[],
  options: GenerateOptions,
): TaskNode[] {
  const { blueprintId, style = 'grouped', defaultStatus = 'todo', startId = 1 } = options;

  if (style === 'flat') {
    return generateFlatTasks(concerns, blueprintId, defaultStatus, startId);
  }

  return generateGroupedTasks(concerns, blueprintId, defaultStatus, startId);
}

function generateGroupedTasks(
  concerns: BlueprintConcern[],
  blueprintId: string,
  defaultStatus: string,
  startId: number,
): TaskNode[] {
  const groups = groupByUrgency(concerns);
  const tasks: TaskNode[] = [];
  const tierIds: Record<ConcernUrgency, string> = {
    upfront: '',
    'pattern-first': '',
    deferred: '',
  };

  let currentId = startId;
  const tiers: ConcernUrgency[] = ['upfront', 'pattern-first', 'deferred'];

  for (const tier of tiers) {
    const tierConcerns = groups[tier];
    if (tierConcerns.length === 0) continue;

    const config = TIER_CONFIG[tier];
    const parentId = String(currentId);
    tierIds[tier] = parentId;

    const children = tierConcerns.map((concern, idx) =>
      concernToTaskNode(concern, `${parentId}.${idx + 1}`, blueprintId, tier, defaultStatus),
    );

    const parentTask: TaskNode = {
      id: parentId,
      title: config.title,
      description: `Blueprint-generated ${tier} concerns for ${blueprintId}`,
      type: 'task',
      status: defaultStatus,
      complexity: Math.round(
        tierConcerns.reduce((sum, c) => sum + c.estimatedComplexity, 0) / tierConcerns.length,
      ),
      priority: config.priority,
      requiredSkills: dedupeSkills(tierConcerns),
      dependencies: [],
      readiness: 'pending',
      assignee: null,
      outputs: [],
      tags: [`blueprint:${blueprintId}`, `urgency:${tier}`],
      qaFeedback: [],
      children,
      metadata: {
        source: 'blueprint',
        autoExpanded: false,
        skillsInferred: false,
        createdAt: new Date().toISOString(),
      },
    };

    tasks.push(parentTask);
    currentId++;
  }

  // Wire dependencies: upfront → pattern-first → deferred
  for (let i = 1; i < tasks.length; i++) {
    const prevId = tasks[i - 1].id;
    tasks[i].dependencies.push({ taskId: prevId, type: 'blocks' });
  }

  return tasks;
}

function generateFlatTasks(
  concerns: BlueprintConcern[],
  blueprintId: string,
  defaultStatus: string,
  startId: number,
): TaskNode[] {
  return concerns.map((concern, idx) =>
    concernToTaskNode(concern, String(startId + idx), blueprintId, concern.urgency, defaultStatus),
  );
}

function concernToTaskNode(
  concern: BlueprintConcern,
  id: string,
  blueprintId: string,
  tier: ConcernUrgency,
  defaultStatus: string,
): TaskNode {
  const config = TIER_CONFIG[tier];

  return {
    id,
    title: concern.title,
    description: `${concern.description}\n\n**Implementation guidance:** ${concern.implementationGuidance}`,
    type: 'subtask',
    status: defaultStatus,
    complexity: concern.estimatedComplexity,
    priority: config.priority,
    requiredSkills: [...concern.requiredSkills],
    dependencies: [],
    readiness: 'pending',
    assignee: null,
    outputs: [],
    tags: [
      `blueprint:${blueprintId}`,
      `urgency:${tier}`,
      `concern:${concern.category}`,
      ...concern.tags,
    ],
    qaFeedback: [],
    children: [],
    metadata: {
      source: 'blueprint',
      autoExpanded: false,
      skillsInferred: false,
      createdAt: new Date().toISOString(),
    },
  };
}

function dedupeSkills(concerns: BlueprintConcern[]): string[] {
  const skills = new Set<string>();
  for (const concern of concerns) {
    for (const skill of concern.requiredSkills) {
      skills.add(skill);
    }
  }
  return [...skills];
}
