import type { StateDefinition, TaskNode } from '../config/schema.js';
import { applyReadiness, recomputeAllReadiness, runValidation } from '../readiness/index.js';
import type { ValidationReport } from '../readiness/types.js';

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
