// Types
export type {
  ConcernUrgency,
  BlueprintConcern,
  ContextQuestion,
  ConditionalConcernRule,
  DetectionHint,
  ApplicationBlueprint,
  BlueprintConfig,
  BlueprintDetectionResult,
} from './types.js';

export {
  ConcernUrgencySchema,
  BlueprintConcernSchema,
  ContextQuestionSchema,
  ConditionalConcernRuleSchema,
  DetectionHintSchema,
  ApplicationBlueprintSchema,
  BlueprintConfigSchema,
  BlueprintDetectionResultSchema,
} from './types.js';

// Registry
export {
  BLUEPRINTS,
  BLUEPRINT_IDS,
  getBlueprint,
  listBlueprints,
  getBlueprintsByAppType,
} from './registry.js';

// Resolver
export {
  resolveBlueprint,
  groupByUrgency,
  validateNonNegotiables,
} from './resolver.js';

// Task generator
export { generateConcernTasks } from './task-generator.js';
export type { GenerateOptions } from './task-generator.js';

// Detector
export { detectBlueprints } from './detector.js';
