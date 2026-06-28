import { z } from 'zod';

// --- Concern urgency tiers ---

export const ConcernUrgencySchema = z.enum(['upfront', 'pattern-first', 'deferred']);

export type ConcernUrgency = z.infer<typeof ConcernUrgencySchema>;

// --- Individual concern item ---

export const BlueprintConcernSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  category: z.string(),
  urgency: ConcernUrgencySchema,
  implementationGuidance: z.string(),
  requiredSkills: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  estimatedComplexity: z.number().min(1).max(10).default(5),
});

export type BlueprintConcern = z.infer<typeof BlueprintConcernSchema>;

// --- Context question for parameterization ---

export const ContextQuestionSchema = z.object({
  id: z.string(),
  question: z.string(),
  type: z.enum(['boolean', 'single-select', 'multi-select']),
  options: z.array(z.string()).optional(),
  default: z.union([z.string(), z.boolean()]).optional(),
});

export type ContextQuestion = z.infer<typeof ContextQuestionSchema>;

// --- Conditional rule: promotes/adds concerns based on answers ---

export const ConditionalConcernRuleSchema = z.object({
  questionId: z.string(),
  answerEquals: z.union([z.string(), z.boolean()]),
  addConcerns: z.array(z.string()).default([]),
  promoteToUrgency: ConcernUrgencySchema.optional(),
});

export type ConditionalConcernRule = z.infer<typeof ConditionalConcernRuleSchema>;

// --- Detection hints for scan auto-detect ---

export const DetectionHintSchema = z.object({
  patterns: z.array(z.string()).default([]),
  frameworks: z.array(z.string()).default([]),
  capabilities: z.array(z.string()).default([]),
  fileIndicators: z.array(z.string()).default([]),
  weight: z.number().min(0).max(1).default(0.5),
});

export type DetectionHint = z.infer<typeof DetectionHintSchema>;

// --- Application archetype blueprint ---

export const ApplicationBlueprintSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  appType: z.string(),
  contextQuestions: z.array(ContextQuestionSchema).default([]),
  concerns: z.array(BlueprintConcernSchema).default([]),
  conditionalRules: z.array(ConditionalConcernRuleSchema).default([]),
  nonNegotiableBundle: z.array(z.string()).default([]),
  detectionHints: DetectionHintSchema.default({}),
});

export type ApplicationBlueprint = z.infer<typeof ApplicationBlueprintSchema>;

// --- Blueprint config (stored in project config.yaml) ---

export const BlueprintConfigSchema = z.object({
  id: z.string().optional(),
  contextAnswers: z
    .record(z.string(), z.union([z.string(), z.boolean(), z.array(z.string())]))
    .default({}),
});

export type BlueprintConfig = z.infer<typeof BlueprintConfigSchema>;

// --- Detection result ---

export const BlueprintDetectionResultSchema = z.object({
  blueprintId: z.string(),
  confidence: z.number().min(0).max(1),
  matchedSignals: z.array(z.string()).default([]),
});

export type BlueprintDetectionResult = z.infer<typeof BlueprintDetectionResultSchema>;
