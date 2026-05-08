import { describe, it, expect } from 'vitest';
import {
  BlueprintConcernSchema,
  ConcernUrgencySchema,
  ContextQuestionSchema,
  ApplicationBlueprintSchema,
  BlueprintConfigSchema,
} from '../../../src/blueprints/types.js';

describe('ConcernUrgencySchema', () => {
  it('accepts "upfront"', () => {
    expect(ConcernUrgencySchema.parse('upfront')).toBe('upfront');
  });

  it('accepts "pattern-first"', () => {
    expect(ConcernUrgencySchema.parse('pattern-first')).toBe('pattern-first');
  });

  it('accepts "deferred"', () => {
    expect(ConcernUrgencySchema.parse('deferred')).toBe('deferred');
  });

  it('rejects invalid urgency values', () => {
    expect(() => ConcernUrgencySchema.parse('immediate')).toThrow();
    expect(() => ConcernUrgencySchema.parse('')).toThrow();
    expect(() => ConcernUrgencySchema.parse(42)).toThrow();
  });
});

describe('BlueprintConcernSchema', () => {
  const validConcern = {
    id: 'input-validation',
    title: 'Input validation',
    description: 'Validate all incoming payloads.',
    category: 'security',
    urgency: 'upfront' as const,
    implementationGuidance: 'Use Zod at the middleware layer.',
  };

  it('parses a valid concern object', () => {
    const result = BlueprintConcernSchema.parse(validConcern);
    expect(result.id).toBe('input-validation');
    expect(result.title).toBe('Input validation');
    expect(result.description).toBe('Validate all incoming payloads.');
    expect(result.category).toBe('security');
    expect(result.urgency).toBe('upfront');
    expect(result.implementationGuidance).toBe('Use Zod at the middleware layer.');
  });

  it('applies defaults for optional array fields', () => {
    const result = BlueprintConcernSchema.parse(validConcern);
    expect(result.requiredSkills).toEqual([]);
    expect(result.tags).toEqual([]);
    expect(result.estimatedComplexity).toBe(5);
  });

  it('preserves provided optional fields', () => {
    const result = BlueprintConcernSchema.parse({
      ...validConcern,
      requiredSkills: ['backend', 'security'],
      tags: ['layer:api'],
      estimatedComplexity: 8,
    });
    expect(result.requiredSkills).toEqual(['backend', 'security']);
    expect(result.tags).toEqual(['layer:api']);
    expect(result.estimatedComplexity).toBe(8);
  });

  it('rejects missing id', () => {
    const { id: _id, ...noId } = validConcern;
    expect(() => BlueprintConcernSchema.parse(noId)).toThrow();
  });

  it('rejects missing title', () => {
    const { title: _title, ...noTitle } = validConcern;
    expect(() => BlueprintConcernSchema.parse(noTitle)).toThrow();
  });

  it('rejects missing description', () => {
    const { description: _desc, ...noDesc } = validConcern;
    expect(() => BlueprintConcernSchema.parse(noDesc)).toThrow();
  });

  it('rejects missing category', () => {
    const { category: _cat, ...noCat } = validConcern;
    expect(() => BlueprintConcernSchema.parse(noCat)).toThrow();
  });

  it('rejects missing urgency', () => {
    const { urgency: _urg, ...noUrg } = validConcern;
    expect(() => BlueprintConcernSchema.parse(noUrg)).toThrow();
  });

  it('rejects missing implementationGuidance', () => {
    const { implementationGuidance: _ig, ...noGuidance } = validConcern;
    expect(() => BlueprintConcernSchema.parse(noGuidance)).toThrow();
  });

  it('rejects estimatedComplexity outside 1-10 range', () => {
    expect(() => BlueprintConcernSchema.parse({ ...validConcern, estimatedComplexity: 0 })).toThrow();
    expect(() => BlueprintConcernSchema.parse({ ...validConcern, estimatedComplexity: 11 })).toThrow();
  });
});

describe('ContextQuestionSchema', () => {
  it('validates boolean question type', () => {
    const result = ContextQuestionSchema.parse({
      id: 'internet-facing',
      question: 'Is this service internet-facing?',
      type: 'boolean',
      default: true,
    });
    expect(result.type).toBe('boolean');
    expect(result.default).toBe(true);
  });

  it('validates single-select question type', () => {
    const result = ContextQuestionSchema.parse({
      id: 'auth-strategy',
      question: 'What authentication strategy?',
      type: 'single-select',
      options: ['jwt', 'session', 'api-key'],
      default: 'jwt',
    });
    expect(result.type).toBe('single-select');
    expect(result.options).toEqual(['jwt', 'session', 'api-key']);
    expect(result.default).toBe('jwt');
  });

  it('validates multi-select question type', () => {
    const result = ContextQuestionSchema.parse({
      id: 'features',
      question: 'Which features to enable?',
      type: 'multi-select',
      options: ['caching', 'rate-limiting', 'tracing'],
    });
    expect(result.type).toBe('multi-select');
    expect(result.options).toEqual(['caching', 'rate-limiting', 'tracing']);
  });

  it('rejects invalid question type', () => {
    expect(() =>
      ContextQuestionSchema.parse({
        id: 'q1',
        question: 'Some question?',
        type: 'free-text',
      }),
    ).toThrow();
  });

  it('allows options and default to be omitted', () => {
    const result = ContextQuestionSchema.parse({
      id: 'q1',
      question: 'Simple question?',
      type: 'boolean',
    });
    expect(result.options).toBeUndefined();
    expect(result.default).toBeUndefined();
  });
});

describe('ApplicationBlueprintSchema', () => {
  it('parses a complete blueprint with defaults', () => {
    const result = ApplicationBlueprintSchema.parse({
      id: 'test-bp',
      name: 'Test Blueprint',
      description: 'A test blueprint',
      appType: 'service',
    });
    expect(result.id).toBe('test-bp');
    expect(result.name).toBe('Test Blueprint');
    expect(result.description).toBe('A test blueprint');
    expect(result.appType).toBe('service');
    expect(result.contextQuestions).toEqual([]);
    expect(result.concerns).toEqual([]);
    expect(result.conditionalRules).toEqual([]);
    expect(result.nonNegotiableBundle).toEqual([]);
    // When detectionHints is omitted, Zod uses the literal default ({})
    // without recursively applying inner DetectionHintSchema defaults
    expect(result.detectionHints).toBeDefined();
  });

  it('parses a blueprint with all fields provided', () => {
    const result = ApplicationBlueprintSchema.parse({
      id: 'full-bp',
      name: 'Full Blueprint',
      description: 'A fully specified blueprint',
      appType: 'tool',
      contextQuestions: [
        { id: 'q1', question: 'Ready?', type: 'boolean' },
      ],
      concerns: [
        {
          id: 'c1',
          title: 'Concern 1',
          description: 'desc',
          category: 'security',
          urgency: 'upfront',
          implementationGuidance: 'do it',
        },
      ],
      conditionalRules: [
        { questionId: 'q1', answerEquals: true, addConcerns: ['c1'] },
      ],
      nonNegotiableBundle: ['c1'],
      detectionHints: {
        patterns: ['rest'],
        frameworks: ['express'],
        capabilities: ['http'],
        fileIndicators: ['routes/'],
        weight: 0.9,
      },
    });
    expect(result.contextQuestions).toHaveLength(1);
    expect(result.concerns).toHaveLength(1);
    expect(result.conditionalRules).toHaveLength(1);
    expect(result.nonNegotiableBundle).toEqual(['c1']);
    expect(result.detectionHints.weight).toBe(0.9);
  });
});

describe('BlueprintConfigSchema', () => {
  it('defaults to empty contextAnswers object', () => {
    const result = BlueprintConfigSchema.parse({});
    expect(result.contextAnswers).toEqual({});
    expect(result.id).toBeUndefined();
  });

  it('parses config with id and contextAnswers', () => {
    const result = BlueprintConfigSchema.parse({
      id: 'rest-api',
      contextAnswers: { 'internet-facing': true, 'auth-strategy': 'jwt' },
    });
    expect(result.id).toBe('rest-api');
    expect(result.contextAnswers).toEqual({
      'internet-facing': true,
      'auth-strategy': 'jwt',
    });
  });

  it('supports array values in contextAnswers', () => {
    const result = BlueprintConfigSchema.parse({
      contextAnswers: { features: ['caching', 'tracing'] },
    });
    expect(result.contextAnswers['features']).toEqual(['caching', 'tracing']);
  });
});
