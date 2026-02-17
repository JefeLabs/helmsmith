import type { TaskNode, ProjectConfig } from '../config/schema.js';
import { getDefaultStatus } from '../config/state-engine.js';
import { getNextId } from '../parser/index.js';

export interface BlueprintShowOpts {
  urgency?: string;
}

export interface BlueprintApplyOpts {
  answers?: string;
  flat?: boolean;
  interactive?: boolean;
}

export interface BlueprintApplyResult {
  blueprintName: string;
  blueprintId: string;
  newTasks: TaskNode[];
  totalTasks: number;
  concernsResolved: number;
  contextAnswers: Record<string, string | boolean | string[]>;
  allTasks: TaskNode[];
}

export interface ConcernStatus {
  title: string;
  urgency: string;
  status: string;
  isMissing: boolean;
}

export interface BlueprintCheckResult {
  blueprint: { name: string; id: string };
  concerns: ConcernStatus[];
  coveredCount: number;
  totalCount: number;
  missingUpfront: string[];
}

/**
 * Execute blueprint apply: resolve concerns and generate tasks.
 */
export async function executeBlueprintApply(
  id: string,
  existingTasks: TaskNode[],
  config: ProjectConfig,
  contextAnswers: Record<string, string | boolean | string[]>,
  opts: { flat?: boolean } = {},
): Promise<BlueprintApplyResult> {
  const { getBlueprint, resolveBlueprint, generateConcernTasks, BLUEPRINT_IDS } =
    await import('../blueprints/index.js');
  const bp = getBlueprint(id);

  if (!bp) {
    throw new Error(`Blueprint "${id}" not found. Available: ${BLUEPRINT_IDS.join(', ')}`);
  }

  const concerns = resolveBlueprint(bp, contextAnswers);

  const startId = existingTasks.length > 0 ? getNextId(existingTasks) : 1;
  const defaultStatus = getDefaultStatus(config.states);

  const newTasks = generateConcernTasks(concerns, {
    blueprintId: id,
    style: opts.flat ? 'flat' : 'grouped',
    defaultStatus,
    startId,
  });

  const allTasks = [...existingTasks, ...newTasks];

  // Count total tasks recursively
  const countAll = (tasks: TaskNode[]): number =>
    tasks.reduce((sum, t) => sum + 1 + countAll(t.children), 0);

  return {
    blueprintName: bp.name,
    blueprintId: id,
    newTasks,
    totalTasks: countAll(newTasks),
    concernsResolved: concerns.length,
    contextAnswers,
    allTasks,
  };
}

/**
 * Execute blueprint check: verify task coverage against the configured blueprint.
 */
export async function executeBlueprintCheck(
  tasks: TaskNode[],
  blueprintId: string,
  blueprintContextAnswers: Record<string, string | boolean | string[]>,
): Promise<BlueprintCheckResult> {
  const { getBlueprint, resolveBlueprint, groupByUrgency } =
    await import('../blueprints/index.js');
  const bp = getBlueprint(blueprintId);

  if (!bp) {
    throw new Error(`Blueprint "${blueprintId}" not found.`);
  }

  const concerns = resolveBlueprint(bp, blueprintContextAnswers);

  // Build tag set from all tasks (recursive)
  const taskTags = new Set<string>();
  const collectTags = (nodes: TaskNode[]) => {
    for (const t of nodes) {
      for (const tag of t.tags) taskTags.add(tag);
      collectTags(t.children);
    }
  };
  collectTags(tasks);

  const concernStatuses: ConcernStatus[] = concerns.map((c) => {
    const blueprintTag = `blueprint:${blueprintId}`;
    const concernTag = `concern:${c.category}`;
    const present = taskTags.has(blueprintTag) && taskTags.has(concernTag);

    let status: string;
    if (present) {
      status = '\u2713 present';
    } else if (c.urgency === 'deferred') {
      status = '\u2014 (not required yet)';
    } else {
      status = '\u2717 missing';
    }

    return { title: c.title, urgency: c.urgency, status, isMissing: !present && c.urgency !== 'deferred' };
  });

  const coveredCount = concernStatuses.filter((c) => c.status.startsWith('\u2713')).length;
  const missingUpfront = concernStatuses
    .filter((c) => c.isMissing && c.urgency === 'upfront')
    .map((c) => c.title);

  return {
    blueprint: { name: bp.name, id: bp.id },
    concerns: concernStatuses,
    coveredCount,
    totalCount: concerns.length,
    missingUpfront,
  };
}
