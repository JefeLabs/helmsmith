import type { TaskNode } from '../config/schema.js';
import { findTaskById } from '../config/state-engine.js';

export interface ShowOpts {
  withChildren?: boolean;
  format?: string;
}

export interface ShowResult {
  task: TaskNode;
}

/**
 * Execute the show command: find a task by ID and return it.
 * Throws if the task is not found.
 */
export function executeShow(tasks: TaskNode[], id: string): ShowResult {
  const task = findTaskById(tasks, id);
  if (!task) {
    throw new Error(`Task "${id}" not found.`);
  }
  return { task };
}
