import type { TaskNode, StateDefinition } from '../config/schema.js';
import type { DelegationManifest } from '../readiness/types.js';
import {
  recomputeAllReadiness,
  applyReadiness,
  buildDelegationManifest,
} from '../readiness/index.js';

export interface ReadyOpts {
  format?: string;
  skills?: string;
}

export interface ReadyResult {
  manifest: DelegationManifest;
  tasks: TaskNode[];
}

/**
 * Execute the ready command: recompute readiness and build
 * the delegation manifest of all ready, blocked, and QA-failed tasks.
 * Optionally filter by required skills.
 */
export function executeReady(
  tasks: TaskNode[],
  states: StateDefinition[],
  opts: ReadyOpts = {},
): ReadyResult {
  const results = recomputeAllReadiness(tasks, states);
  applyReadiness(tasks, results);

  const manifest = buildDelegationManifest(tasks, states);

  // Apply --skills filter (OR logic)
  if (opts.skills) {
    const filterSkills = opts.skills.split(',').map((s) => s.trim().toLowerCase());
    manifest.ready_tasks = manifest.ready_tasks.filter((t) =>
      t.required_skills.some((s) => filterSkills.includes(s.toLowerCase())),
    );
  }

  return { manifest, tasks };
}
