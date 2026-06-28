export { AIScorer, buildScoringPrompt, parseAIResponse } from './ai-scorer.js';
export {
  analyzeAmbiguity,
  analyzeCrossCutting,
  analyzeDependencyCount,
  analyzeScopeBreadth,
  analyzeTechnicalDepth,
} from './dimensions.js';
export { HeuristicScorer, scoreTask, scoreTasks } from './heuristic.js';
export type {
  ScoreBreakdown,
  ScoredResult,
  ScoringDimension,
  ScoringProvider,
} from './types.js';
export { DEFAULT_WEIGHTS } from './types.js';

import type { AIProviderName } from '../auth/provider.js';
import { AIScorer } from './ai-scorer.js';
import { HeuristicScorer } from './heuristic.js';
import type { ScoringProvider } from './types.js';

/**
 * Factory function to create the appropriate scorer.
 * Returns AIScorer when authenticated, HeuristicScorer otherwise.
 */
export function createScorer(
  model: string,
  authAvailable: boolean,
  provider?: AIProviderName,
): ScoringProvider {
  if (authAvailable) {
    return new AIScorer(model, undefined, provider);
  }
  return new HeuristicScorer();
}
