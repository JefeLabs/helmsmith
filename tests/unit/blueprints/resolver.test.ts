import { describe, it, expect } from 'vitest';
import {
  resolveBlueprint,
  groupByUrgency,
  validateNonNegotiables,
} from '../../../src/blueprints/resolver.js';
import { REST_API_BLUEPRINT } from '../../../src/blueprints/archetypes/rest-api.js';
import type { ApplicationBlueprint, BlueprintConcern } from '../../../src/blueprints/types.js';

describe('resolveBlueprint', () => {
  it('returns all base concerns when no conditional rules match', () => {
    const resolved = resolveBlueprint(REST_API_BLUEPRINT, {});
    // All base concerns should be present
    expect(resolved.length).toBe(REST_API_BLUEPRINT.concerns.length);
    const resolvedIds = resolved.map((c) => c.id);
    for (const concern of REST_API_BLUEPRINT.concerns) {
      expect(resolvedIds).toContain(concern.id);
    }
  });

  it('promotes concern urgency when conditional rule matches', () => {
    // The "internet-facing" rule promotes "rate-limiting" to "upfront"
    const resolved = resolveBlueprint(REST_API_BLUEPRINT, { 'internet-facing': true });
    const rateLimiting = resolved.find((c) => c.id === 'rate-limiting');
    expect(rateLimiting).toBeDefined();
    expect(rateLimiting!.urgency).toBe('upfront');
  });

  it('does not promote when answer does not match', () => {
    const resolved = resolveBlueprint(REST_API_BLUEPRINT, { 'internet-facing': false });
    const rateLimiting = resolved.find((c) => c.id === 'rate-limiting');
    expect(rateLimiting).toBeDefined();
    // Should stay at its original urgency (pattern-first)
    expect(rateLimiting!.urgency).toBe('pattern-first');
  });

  it('results are sorted by urgency (upfront first, deferred last)', () => {
    const resolved = resolveBlueprint(REST_API_BLUEPRINT, {});
    const urgencyOrder = { upfront: 0, 'pattern-first': 1, deferred: 2 };
    for (let i = 1; i < resolved.length; i++) {
      const prevOrder = urgencyOrder[resolved[i - 1].urgency];
      const currOrder = urgencyOrder[resolved[i].urgency];
      expect(currOrder).toBeGreaterThanOrEqual(prevOrder);
    }
  });

  it('within same tier, results sorted by estimatedComplexity descending', () => {
    const resolved = resolveBlueprint(REST_API_BLUEPRINT, {});
    const groups = groupByUrgency(resolved);
    for (const tier of ['upfront', 'pattern-first', 'deferred'] as const) {
      const tierConcerns = groups[tier];
      for (let i = 1; i < tierConcerns.length; i++) {
        expect(tierConcerns[i].estimatedComplexity).toBeLessThanOrEqual(
          tierConcerns[i - 1].estimatedComplexity,
        );
      }
    }
  });

  it('non-negotiable bundle concerns are always upfront regardless of base urgency', () => {
    // Create a synthetic blueprint where a non-negotiable concern starts as deferred
    const testBlueprint: ApplicationBlueprint = {
      id: 'test',
      name: 'Test',
      description: 'test',
      appType: 'test',
      contextQuestions: [],
      concerns: [
        {
          id: 'c1',
          title: 'Concern 1',
          description: 'desc',
          category: 'cat',
          urgency: 'deferred', // starts as deferred
          implementationGuidance: 'guidance',
          requiredSkills: [],
          tags: [],
          estimatedComplexity: 5,
        },
        {
          id: 'c2',
          title: 'Concern 2',
          description: 'desc',
          category: 'cat',
          urgency: 'pattern-first',
          implementationGuidance: 'guidance',
          requiredSkills: [],
          tags: [],
          estimatedComplexity: 3,
        },
      ],
      conditionalRules: [],
      nonNegotiableBundle: ['c1'], // c1 is non-negotiable
      detectionHints: { patterns: [], frameworks: [], capabilities: [], fileIndicators: [], weight: 0.5 },
    };

    const resolved = resolveBlueprint(testBlueprint, {});
    const c1 = resolved.find((c) => c.id === 'c1');
    expect(c1).toBeDefined();
    expect(c1!.urgency).toBe('upfront');
  });
});

describe('groupByUrgency', () => {
  it('correctly groups concerns into 3 tiers', () => {
    const concerns: BlueprintConcern[] = [
      {
        id: 'a',
        title: 'A',
        description: 'd',
        category: 'c',
        urgency: 'upfront',
        implementationGuidance: 'g',
        requiredSkills: [],
        tags: [],
        estimatedComplexity: 5,
      },
      {
        id: 'b',
        title: 'B',
        description: 'd',
        category: 'c',
        urgency: 'pattern-first',
        implementationGuidance: 'g',
        requiredSkills: [],
        tags: [],
        estimatedComplexity: 3,
      },
      {
        id: 'c',
        title: 'C',
        description: 'd',
        category: 'c',
        urgency: 'deferred',
        implementationGuidance: 'g',
        requiredSkills: [],
        tags: [],
        estimatedComplexity: 2,
      },
    ];

    const groups = groupByUrgency(concerns);
    expect(groups['upfront']).toHaveLength(1);
    expect(groups['upfront'][0].id).toBe('a');
    expect(groups['pattern-first']).toHaveLength(1);
    expect(groups['pattern-first'][0].id).toBe('b');
    expect(groups['deferred']).toHaveLength(1);
    expect(groups['deferred'][0].id).toBe('c');
  });

  it('returns empty arrays for tiers with no concerns', () => {
    const concerns: BlueprintConcern[] = [
      {
        id: 'a',
        title: 'A',
        description: 'd',
        category: 'c',
        urgency: 'upfront',
        implementationGuidance: 'g',
        requiredSkills: [],
        tags: [],
        estimatedComplexity: 5,
      },
    ];

    const groups = groupByUrgency(concerns);
    expect(groups['upfront']).toHaveLength(1);
    expect(groups['pattern-first']).toEqual([]);
    expect(groups['deferred']).toEqual([]);
  });
});

describe('validateNonNegotiables', () => {
  const testBlueprint: ApplicationBlueprint = {
    id: 'test',
    name: 'Test',
    description: 'test',
    appType: 'test',
    contextQuestions: [],
    concerns: [
      {
        id: 'c1',
        title: 'Concern 1',
        description: 'd',
        category: 'c',
        urgency: 'upfront',
        implementationGuidance: 'g',
        requiredSkills: [],
        tags: [],
        estimatedComplexity: 5,
      },
      {
        id: 'c2',
        title: 'Concern 2',
        description: 'd',
        category: 'c',
        urgency: 'upfront',
        implementationGuidance: 'g',
        requiredSkills: [],
        tags: [],
        estimatedComplexity: 3,
      },
    ],
    conditionalRules: [],
    nonNegotiableBundle: ['c1', 'c2'],
    detectionHints: { patterns: [], frameworks: [], capabilities: [], fileIndicators: [], weight: 0.5 },
  };

  it('returns empty array when all non-negotiables are present', () => {
    const resolved: BlueprintConcern[] = [
      { ...testBlueprint.concerns[0] },
      { ...testBlueprint.concerns[1] },
    ];
    const missing = validateNonNegotiables(testBlueprint, resolved);
    expect(missing).toEqual([]);
  });

  it('returns missing IDs when concerns are removed', () => {
    // Only include c1, omit c2
    const resolved: BlueprintConcern[] = [{ ...testBlueprint.concerns[0] }];
    const missing = validateNonNegotiables(testBlueprint, resolved);
    expect(missing).toEqual(['c2']);
  });

  it('returns all IDs if resolved list is empty', () => {
    const missing = validateNonNegotiables(testBlueprint, []);
    expect(missing).toEqual(['c1', 'c2']);
  });
});
