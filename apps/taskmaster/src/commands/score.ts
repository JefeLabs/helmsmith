import type { ProjectConfig, TaskNode } from '../config/schema.js';
import { findTaskById } from '../config/state-engine.js';
import { createScorer } from '../scorer/index.js';
import type { ScoredResult } from '../scorer/types.js';

export interface ScoreOpts {
  recalculate?: boolean;
  threshold?: string;
  all?: boolean;
  heuristicOnly?: boolean;
  format?: string;
}

export interface ScoreResult {
  results: ScoredResult[];
  providerLabel: string;
  tasks: TaskNode[];
}

/**
 * Execute the score command: score unscored (or all) tasks using
 * heuristic, AI, or blended scorer, then apply scores to the task tree.
 */
export async function executeScore(
  tasks: TaskNode[],
  config: ProjectConfig,
  authAvailable: boolean,
  opts: ScoreOpts = {},
): Promise<ScoreResult> {
  const scoreAll = opts.all || opts.recalculate;
  const tasksToScore = scoreAll ? tasks : tasks.filter((t) => t.complexity === 1);

  if (tasksToScore.length === 0) {
    return { results: [], providerLabel: '', tasks };
  }

  const scorer = createScorer(config.ai.model, authAvailable, config.ai.provider);
  const providerLabel = authAvailable
    ? `AI (${config.ai.provider}/${config.ai.model}) + heuristic blend`
    : 'heuristic (no AI authentication)';

  const results = await Promise.all(tasksToScore.map((task) => scorer.scoreTask(task, tasks)));

  // Apply scores to task objects
  for (const result of results) {
    const task = findTaskById(tasks, result.taskId);
    if (task) {
      task.complexity = result.score;
    }
  }

  return { results, providerLabel, tasks };
}
