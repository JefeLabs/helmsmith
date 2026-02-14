export { HeuristicScorer, scoreTask, scoreTasks } from './heuristic.js';

export { AIScorer, buildScoringPrompt, parseAIResponse } from './ai-scorer.js';

export type {
  ScoringDimension,
  ScoreBreakdown,
  ScoredResult,
  ScoringProvider,
} from './types.js';

export { DEFAULT_WEIGHTS } from './types.js';

export {
  analyzeScopeBreadth,
  analyzeTechnicalDepth,
  analyzeDependencyCount,
  analyzeAmbiguity,
  analyzeCrossCutting,
} from './dimensions.js';

import { HeuristicScorer } from './heuristic.js';
import { AIScorer } from './ai-scorer.js';
import type { ScoringProvider } from './types.js';

/**
 * Factory function to create the appropriate scorer.
 * Returns AIScorer when authenticated, HeuristicScorer otherwise.
 */
export function createScorer(model: string, authAvailable: boolean): ScoringProvider {
  if (authAvailable) {
    return new AIScorer(model);
  }
  return new HeuristicScorer();
}
