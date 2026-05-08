import type { TaskNode, StateDefinition } from '../config/schema.js';
import type { ValidationReport } from '../readiness/types.js';
import {
  recomputeAllReadiness,
  applyReadiness,
  runValidation,
} from '../readiness/index.js';

export interface ValidateResult extends ValidationReport {
  tasks: TaskNode[];
}

/**
 * Execute the validate command: check the dependency graph for
 * cycles, orphan references, and skill vocabulary issues.
 * Optionally auto-repair issues with `fix: true`.
 */
export function executeValidate(
  tasks: TaskNode[],
  states: StateDefinition[],
  vocabulary: string[],
  fix: boolean,
): ValidateResult {
  const report = runValidation(tasks, states, vocabulary, fix);

  // If fixes were applied, recompute readiness
  if (fix && report.fixes && report.fixes.length > 0) {
    const results = recomputeAllReadiness(tasks, states);
    applyReadiness(tasks, results);
  }

  return { ...report, tasks };
}
