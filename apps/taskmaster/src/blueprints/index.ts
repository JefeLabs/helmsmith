// Types

// Detector
export { detectBlueprints } from './detector.js';
// Registry
export {
  BLUEPRINT_IDS,
  BLUEPRINTS,
  getBlueprint,
  getBlueprintsByAppType,
  listBlueprints,
} from './registry.js';
// Resolver
export {
  groupByUrgency,
  resolveBlueprint,
  validateNonNegotiables,
} from './resolver.js';
export type { GenerateOptions } from './task-generator.js';

// Task generator
export { generateConcernTasks } from './task-generator.js';
export type {
  ApplicationBlueprint,
  BlueprintConcern,
  BlueprintConfig,
  BlueprintDetectionResult,
  ConcernUrgency,
  ConditionalConcernRule,
  ContextQuestion,
  DetectionHint,
} from './types.js';
export {
  ApplicationBlueprintSchema,
  BlueprintConcernSchema,
  BlueprintConfigSchema,
  BlueprintDetectionResultSchema,
  ConcernUrgencySchema,
  ConditionalConcernRuleSchema,
  ContextQuestionSchema,
  DetectionHintSchema,
} from './types.js';
