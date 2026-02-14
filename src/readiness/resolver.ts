import type { TaskNode, StateDefinition } from '../config/schema.js';
import { isClosedState, isActiveState, isOpenState } from '../config/state-engine.js';
import { validateSkills } from '../skills/validation.js';
import { flattenTasks, buildTaskMap, buildDag, detectDanglingRefs, fixCycles, fixDanglingRefs } from './dag.js';
import type {
  ReadinessResult,
  DelegationManifest,
  ReadyTaskEntry,
  BlockedTaskEntry,
  ValidationReport,
} from './types.js';

/** Priority weight mapping for sorting. */
const PRIORITY_WEIGHT: Record<string, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

/**
 * Recompute readiness for all tasks based on their dependencies and the
 * current state of prerequisite tasks.
 *
 * Rules:
 * - No dependencies -> pending (treated as ready for delegation)
 * - All blocks/produces deps in closed state -> ready
 * - Any blocks/produces dep NOT in closed state -> blocked (with waitingOn list)
 * - 'relates' dependencies are ignored for readiness computation
 */
export function recomputeAllReadiness(
  tasks: TaskNode[],
  states: StateDefinition[],
): ReadinessResult[] {
  const flat = flattenTasks(tasks);
  const taskMap = buildTaskMap(flat);
  const results: ReadinessResult[] = [];

  for (const task of flat) {
    // Filter to only blocking dependency types
    const blockingDeps = task.dependencies.filter(
      (d) => d.type === 'blocks' || d.type === 'produces',
    );

    if (blockingDeps.length === 0) {
      results.push({ taskId: task.id, readiness: 'pending', waitingOn: [] });
      continue;
    }

    const waitingOn: string[] = [];
    for (const dep of blockingDeps) {
      const depTask = taskMap.get(dep.taskId);
      if (!depTask) {
        // Dangling reference — treat as blocking (not satisfied)
        waitingOn.push(dep.taskId);
        continue;
      }
      if (!isClosedState(states, depTask.status)) {
        waitingOn.push(dep.taskId);
      }
    }

    if (waitingOn.length === 0) {
      results.push({ taskId: task.id, readiness: 'ready', waitingOn: [] });
    } else {
      results.push({ taskId: task.id, readiness: 'blocked', waitingOn });
    }
  }

  return results;
}

/**
 * Apply computed readiness values to the task tree in place.
 * Since flattenTasks returns references, mutating the flat nodes
 * also mutates the original tree.
 */
export function applyReadiness(tasks: TaskNode[], results: ReadinessResult[]): void {
  const resultMap = new Map<string, ReadinessResult>();
  for (const r of results) {
    resultMap.set(r.taskId, r);
  }

  const flat = flattenTasks(tasks);
  for (const task of flat) {
    const result = resultMap.get(task.id);
    if (result) {
      task.readiness = result.readiness;
    }
  }
}

/**
 * Build the delegation manifest: a snapshot of all ready and blocked tasks
 * with summary counts.
 */
export function buildDelegationManifest(
  tasks: TaskNode[],
  states: StateDefinition[],
): DelegationManifest {
  const flat = flattenTasks(tasks);
  const results = recomputeAllReadiness(tasks, states);

  // Apply results so we can read readiness from the task nodes
  applyReadiness(tasks, results);

  const resultMap = new Map<string, ReadinessResult>();
  for (const r of results) {
    resultMap.set(r.taskId, r);
  }

  const readyTasks: ReadyTaskEntry[] = [];
  const blockedTasks: BlockedTaskEntry[] = [];

  let totalReady = 0;
  let totalBlocked = 0;
  let totalInProgress = 0;
  let totalCompleted = 0;

  for (const task of flat) {
    const result = resultMap.get(task.id);
    const isClosed = isClosedState(states, task.status);
    const isActive = isActiveState(states, task.status);
    const isOpen = isOpenState(states, task.status);

    if (isClosed) {
      totalCompleted++;
      continue;
    }

    if (isActive) {
      totalInProgress++;
    }

    if (result) {
      if (result.readiness === 'ready' || result.readiness === 'pending') {
        totalReady++;
        if (isOpen || isActive) {
          readyTasks.push({
            id: task.id,
            title: task.title,
            required_skills: [...task.requiredSkills],
            complexity: task.complexity,
            priority: task.priority,
            outputs: [...task.outputs],
            dependencies: task.dependencies.map((d) => d.taskId),
          });
        }
      } else if (result.readiness === 'blocked') {
        totalBlocked++;
        if (isOpen || isActive) {
          blockedTasks.push({
            id: task.id,
            title: task.title,
            waiting_on: result.waitingOn,
          });
        }
      }
    }
  }

  const total = flat.length - totalCompleted;

  return {
    generated_at: new Date().toISOString(),
    ready_tasks: readyTasks,
    blocked_tasks: blockedTasks,
    summary: {
      total,
      ready: totalReady,
      blocked: totalBlocked,
      in_progress: totalInProgress,
      completed: totalCompleted,
    },
  };
}

/**
 * Find the single highest-priority ready task that hasn't been started yet.
 * Surfaces tasks in 'open' category with readiness ready or pending.
 * Tie-breaks by task ID (lowest/earliest first).
 */
export function findNextTask(
  tasks: TaskNode[],
  states: StateDefinition[],
): TaskNode | null {
  const flat = flattenTasks(tasks);
  const results = recomputeAllReadiness(tasks, states);
  applyReadiness(tasks, results);

  const resultMap = new Map<string, ReadinessResult>();
  for (const r of results) {
    resultMap.set(r.taskId, r);
  }

  // Filter to open-category tasks that are ready or pending
  const candidates = flat.filter((task) => {
    const result = resultMap.get(task.id);
    if (!result) return false;
    if (result.readiness !== 'ready' && result.readiness !== 'pending') return false;
    return isOpenState(states, task.status);
  });

  if (candidates.length === 0) {
    return null;
  }

  // Sort by priority (descending), then by ID (ascending)
  candidates.sort((a, b) => {
    const weightA = PRIORITY_WEIGHT[a.priority] ?? 0;
    const weightB = PRIORITY_WEIGHT[b.priority] ?? 0;
    if (weightB !== weightA) {
      return weightB - weightA;
    }
    return a.id.localeCompare(b.id, undefined, { numeric: true });
  });

  return candidates[0];
}

/**
 * Run full validation: cycle detection, dangling reference detection,
 * and skill vocabulary validation. Optionally auto-fix cycles and
 * dangling refs.
 */
export function runValidation(
  tasks: TaskNode[],
  states: StateDefinition[],
  vocabulary: string[],
  fix: boolean,
): ValidationReport {
  const flat = flattenTasks(tasks);
  const taskMap = buildTaskMap(flat);
  const fixes = [];

  // Cycle detection
  let dagResult = buildDag(flat);

  // Dangling reference detection
  let orphanResult = detectDanglingRefs(flat, taskMap);

  // Skill vocabulary validation
  const skillIssues = validateSkills(flat, vocabulary);

  if (fix) {
    // Fix cycles first
    if (dagResult.hasCycle) {
      const cycleFixes = fixCycles(flat, dagResult);
      fixes.push(...cycleFixes);
      // Re-run DAG to verify fix (and detect any remaining cycles)
      dagResult = buildDag(flat);
    }

    // Re-detect dangling refs after cycle fixes (indices may have shifted)
    orphanResult = detectDanglingRefs(flat, taskMap);

    // Fix dangling refs
    if (orphanResult.danglingRefs.length > 0) {
      const danglingFixes = fixDanglingRefs(flat, orphanResult);
      fixes.push(...danglingFixes);
      // Re-detect to verify fix
      const updatedMap = buildTaskMap(flat);
      orphanResult = detectDanglingRefs(flat, updatedMap);
    }

    // Skill issues are report-only, not auto-fixed
  }

  const isValid =
    !dagResult.hasCycle &&
    orphanResult.danglingRefs.length === 0 &&
    skillIssues.length === 0;

  return {
    cycles: {
      hasCycle: dagResult.hasCycle,
      cycleNodes: dagResult.cycleNodes,
    },
    danglingRefs: orphanResult.danglingRefs,
    skillIssues,
    isValid,
    ...(fix && fixes.length > 0 ? { fixes } : {}),
  };
}
