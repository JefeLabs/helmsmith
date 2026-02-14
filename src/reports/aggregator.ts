import type { TaskNode, StateDefinition } from '../config/schema.js';
import type { ComplexityReportContext, ProgressReportContext, DependencyGraphContext } from '../generator/types.js';
import { flattenTasks } from '../readiness/dag.js';
import { isClosedState, isActiveState, isOpenState } from '../config/state-engine.js';
import type { SummaryReportContext, SkillCoverage } from './types.js';

/**
 * Aggregate data for the summary report (project health dashboard).
 */
export function aggregateSummary(
  tasks: TaskNode[],
  states: StateDefinition[],
): SummaryReportContext {
  const flat = flattenTasks(tasks);

  // Task counts by category
  let open = 0;
  let active = 0;
  let closed = 0;
  for (const task of flat) {
    if (isClosedState(states, task.status)) closed++;
    else if (isActiveState(states, task.status)) active++;
    else if (isOpenState(states, task.status)) open++;
    else open++; // fallback: treat unknown as open
  }

  // Complexity distribution
  const complexityCtx = aggregateComplexity(tasks);

  // Skill coverage
  const skillMap = new Map<string, number>();
  for (const task of flat) {
    for (const skill of task.requiredSkills) {
      skillMap.set(skill, (skillMap.get(skill) ?? 0) + 1);
    }
  }
  const skillCoverage: SkillCoverage[] = Array.from(skillMap.entries())
    .map(([skill, count]) => ({ skill, count }))
    .sort((a, b) => b.count - a.count);

  // Readiness breakdown
  let ready = 0;
  let blocked = 0;
  let pending = 0;
  for (const task of flat) {
    if (isClosedState(states, task.status)) continue;
    if (task.readiness === 'ready') ready++;
    else if (task.readiness === 'blocked') blocked++;
    else pending++;
  }

  // Blocked alerts
  const blockedAlerts = flat
    .filter((t) => t.readiness === 'blocked' && !isClosedState(states, t.status))
    .map((t) => ({
      id: t.id,
      title: t.title,
      waitingOn: t.dependencies
        .filter((d) => d.type === 'blocks' || d.type === 'produces')
        .map((d) => d.taskId),
    }));

  const total = flat.length;
  const progressPercentage = total > 0 ? Math.round((closed / total) * 100) : 0;

  return {
    generatedAt: new Date().toISOString(),
    taskCounts: { total, open, active, closed },
    complexity: complexityCtx.summary,
    skillCoverage,
    readiness: { ready, blocked, pending },
    blockedAlerts,
    progressPercentage,
  };
}

/**
 * Aggregate data for the complexity report.
 */
export function aggregateComplexity(tasks: TaskNode[]): ComplexityReportContext {
  const flat = flattenTasks(tasks);

  let low = 0;
  let medium = 0;
  let high = 0;
  let sum = 0;

  for (const task of flat) {
    sum += task.complexity;
    if (task.complexity <= 3) low++;
    else if (task.complexity <= 6) medium++;
    else high++;
  }

  const average = flat.length > 0 ? Math.round((sum / flat.length) * 10) / 10 : 0;

  return {
    tasks: flat,
    summary: { low, medium, high, average },
  };
}

/**
 * Aggregate data for the progress report.
 */
export function aggregateProgress(
  tasks: TaskNode[],
  states: StateDefinition[],
): ProgressReportContext {
  const flat = flattenTasks(tasks);

  let done = 0;
  let inProgress = 0;
  let blocked = 0;
  let pending = 0;

  for (const task of flat) {
    if (isClosedState(states, task.status)) {
      done++;
    } else if (isActiveState(states, task.status)) {
      inProgress++;
    } else if (task.readiness === 'blocked') {
      blocked++;
    } else {
      pending++;
    }
  }

  const total = flat.length;
  const percentage = total > 0 ? Math.round((done / total) * 100) : 0;

  return {
    tasks: flat,
    progress: { total, done, inProgress, blocked, pending, percentage },
  };
}

/**
 * Aggregate data for the dependency graph report.
 * Includes a `mermaidSyntax` string for markdown output.
 */
export function aggregateDependencies(
  tasks: TaskNode[],
): DependencyGraphContext & { mermaidSyntax: string } {
  const flat = flattenTasks(tasks);
  const mermaidSyntax = generateMermaidSyntax(flat);

  return {
    tasks: flat,
    mermaidSyntax,
  };
}

/**
 * Generate Mermaid.js graph syntax from task dependencies.
 * Produces a `graph LR` diagram with `taskId --> depId` edges.
 */
export function generateMermaidSyntax(tasks: TaskNode[]): string {
  const lines: string[] = ['graph LR'];

  for (const task of tasks) {
    if (task.dependencies.length === 0) continue;
    for (const dep of task.dependencies) {
      lines.push(`  ${dep.taskId}["${dep.taskId}"] --> ${task.id}["${task.id}"]`);
    }
  }

  // If no edges, show isolated nodes
  if (lines.length === 1) {
    for (const task of tasks) {
      lines.push(`  ${task.id}["${task.id}"]`);
    }
  }

  return lines.join('\n');
}
