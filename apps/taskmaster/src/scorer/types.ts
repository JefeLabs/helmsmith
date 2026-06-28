import type { TaskNode } from '../config/schema.js';

/**
 * A single scoring dimension that analyzes one aspect of task complexity.
 * Each dimension returns a normalized 0.0-1.0 score.
 */
export interface ScoringDimension {
  name: string;
  weight: number;
  analyze(task: TaskNode, allTasks?: TaskNode[]): number;
}

/**
 * Per-dimension score breakdown (all values 0.0-1.0).
 */
export interface ScoreBreakdown {
  scopeBreadth: number;
  technicalDepth: number;
  dependencyCount: number;
  ambiguity: number;
  crossCutting: number;
}

/**
 * Result of scoring a single task.
 */
export interface ScoredResult {
  taskId: string;
  score: number;
  label: 'low' | 'medium' | 'high';
  breakdown: ScoreBreakdown;
}

/**
 * Scoring provider interface for extensibility.
 * The heuristic scorer is the default provider.
 * T-6 (AI scorer) can implement this interface.
 */
export interface ScoringProvider {
  name: string;
  scoreTask(task: TaskNode, allTasks?: TaskNode[]): Promise<ScoredResult>;
}

/**
 * Default dimension weights. Sum = 1.0.
 */
export const DEFAULT_WEIGHTS = {
  scopeBreadth: 0.2,
  technicalDepth: 0.25,
  dependencyCount: 0.15,
  ambiguity: 0.2,
  crossCutting: 0.2,
} as const;
