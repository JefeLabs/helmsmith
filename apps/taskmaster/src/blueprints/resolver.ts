import type { ApplicationBlueprint, BlueprintConcern, ConcernUrgency } from './types.js';

/**
 * Apply conditional rules based on context answers and return the final
 * sorted list of concerns. Non-negotiable concerns are always included
 * regardless of conditional rules.
 */
export function resolveBlueprint(
  blueprint: ApplicationBlueprint,
  contextAnswers: Record<string, string | boolean | string[]>,
): BlueprintConcern[] {
  // Start with a copy of base concerns
  const concernMap = new Map<string, BlueprintConcern>();
  for (const concern of blueprint.concerns) {
    concernMap.set(concern.id, { ...concern });
  }

  // Apply conditional rules
  for (const rule of blueprint.conditionalRules) {
    const answer = contextAnswers[rule.questionId];
    if (answer === undefined) continue;

    const matches = Array.isArray(answer)
      ? answer.includes(String(rule.answerEquals))
      : answer === rule.answerEquals;

    if (!matches) continue;

    // Add concerns referenced by the rule (promote if already present)
    for (const concernId of rule.addConcerns) {
      const existing = concernMap.get(concernId);
      if (existing && rule.promoteToUrgency) {
        existing.urgency = rule.promoteToUrgency;
      }
      // If concern doesn't exist in the map, it's likely defined elsewhere
      // (e.g., conditionally-only concerns should still be in the base list)
    }

    // If rule promotes without specific addConcerns, it's a general hint
    // (not applied — promotions target specific concerns via addConcerns)
  }

  // Ensure non-negotiable concerns are always set to 'upfront'
  for (const id of blueprint.nonNegotiableBundle) {
    const concern = concernMap.get(id);
    if (concern) {
      concern.urgency = 'upfront';
    }
  }

  // Sort: upfront first, then pattern-first, then deferred
  // Within each tier, sort by estimatedComplexity descending (hardest first)
  const urgencyOrder: Record<ConcernUrgency, number> = {
    upfront: 0,
    'pattern-first': 1,
    deferred: 2,
  };

  const resolved = Array.from(concernMap.values());
  resolved.sort((a, b) => {
    const tierDiff = urgencyOrder[a.urgency] - urgencyOrder[b.urgency];
    if (tierDiff !== 0) return tierDiff;
    return b.estimatedComplexity - a.estimatedComplexity;
  });

  return resolved;
}

/**
 * Group resolved concerns by urgency tier.
 */
export function groupByUrgency(
  concerns: BlueprintConcern[],
): Record<ConcernUrgency, BlueprintConcern[]> {
  const groups: Record<ConcernUrgency, BlueprintConcern[]> = {
    upfront: [],
    'pattern-first': [],
    deferred: [],
  };

  for (const concern of concerns) {
    groups[concern.urgency].push(concern);
  }

  return groups;
}

/**
 * Validate that all non-negotiable concern IDs are present in the
 * resolved list. Returns IDs that are missing.
 */
export function validateNonNegotiables(
  blueprint: ApplicationBlueprint,
  resolved: BlueprintConcern[],
): string[] {
  const resolvedIds = new Set(resolved.map((c) => c.id));
  return blueprint.nonNegotiableBundle.filter((id) => !resolvedIds.has(id));
}
