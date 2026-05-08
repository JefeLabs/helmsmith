import type { TaskNode } from '../config/schema.js';
import type { ScoredResult, ScoringProvider, ScoreBreakdown } from './types.js';
import { DEFAULT_WEIGHTS } from './types.js';
import {
  analyzeScopeBreadth,
  analyzeTechnicalDepth,
  analyzeDependencyCount,
  analyzeAmbiguity,
  analyzeCrossCutting,
} from './dimensions.js';

/**
 * Determine the complexity label from a 1-10 score.
 */
function getLabel(score: number): 'low' | 'medium' | 'high' {
  if (score <= 3) return 'low';
  if (score <= 6) return 'medium';
  return 'high';
}

/**
 * Heuristic complexity scorer.
 * Evaluates tasks across five weighted dimensions and produces a 1-10 score.
 * Implements ScoringProvider for extensibility (T-6 AI scorer can provide an alternative).
 */
export class HeuristicScorer implements ScoringProvider {
  readonly name = 'heuristic';
  private weights: typeof DEFAULT_WEIGHTS;

  constructor(weights?: Partial<typeof DEFAULT_WEIGHTS>) {
    this.weights = weights ? { ...DEFAULT_WEIGHTS, ...weights } : { ...DEFAULT_WEIGHTS };
  }

  async scoreTask(task: TaskNode, allTasks: TaskNode[] = []): Promise<ScoredResult> {
    const breakdown: ScoreBreakdown = {
      scopeBreadth: analyzeScopeBreadth(task),
      technicalDepth: analyzeTechnicalDepth(task),
      dependencyCount: analyzeDependencyCount(task, allTasks),
      ambiguity: analyzeAmbiguity(task),
      crossCutting: analyzeCrossCutting(task),
    };

    const rawScore =
      breakdown.scopeBreadth * this.weights.scopeBreadth +
      breakdown.technicalDepth * this.weights.technicalDepth +
      breakdown.dependencyCount * this.weights.dependencyCount +
      breakdown.ambiguity * this.weights.ambiguity +
      breakdown.crossCutting * this.weights.crossCutting;

    // Scale 0.0-1.0 to 1-10
    const score = Math.max(1, Math.min(10, Math.round(rawScore * 9 + 1)));

    return {
      taskId: task.id,
      score,
      label: getLabel(score),
      breakdown,
    };
  }
}

/**
 * Score a single task using the default heuristic scorer.
 */
export async function scoreTask(task: TaskNode, allTasks: TaskNode[] = []): Promise<ScoredResult> {
  const scorer = new HeuristicScorer();
  return scorer.scoreTask(task, allTasks);
}

/**
 * Score multiple tasks using the default heuristic scorer.
 * Only scores the provided tasks; allTasks is the full task list for dependency counting.
 */
export async function scoreTasks(
  tasks: TaskNode[],
  allTasks: TaskNode[] = tasks,
): Promise<ScoredResult[]> {
  const scorer = new HeuristicScorer();
  return Promise.all(tasks.map((task) => scorer.scoreTask(task, allTasks)));
}
