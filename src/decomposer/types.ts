import type { TaskNode } from '../config/schema.js';
import type { StatesConfig } from '../config/schema.js';

/**
 * Options passed to expandTask() and expandMultiple().
 */
export interface ExpansionOptions {
  maxSubtasks?: number;
  force?: boolean;
  dryRun?: boolean;
  model?: string;
  authAvailable?: boolean;
  statesConfig: StatesConfig;
}

/**
 * Successful expansion result for a single task.
 */
export interface ExpansionResult {
  parentId: string;
  children: TaskNode[];
  dryRun: boolean;
  estimatedCount?: number;
}

/**
 * Error result when expansion cannot proceed.
 */
export interface ExpansionError {
  parentId: string;
  reason: string;
}

/**
 * Combined result for batch expansion (expand-all).
 */
export interface BatchExpansionResult {
  expanded: ExpansionResult[];
  errors: ExpansionError[];
  skipped: number;
}
