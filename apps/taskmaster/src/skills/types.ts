/**
 * Built-in default skill vocabulary. Merged with user-defined skills from config.yaml.
 */
export const BUILT_IN_SKILLS = [
  'backend',
  'frontend',
  'database',
  'devops',
  'testing',
  'api-design',
  'ui-ux',
  'auth',
  'infrastructure',
  'documentation',
] as const;

/**
 * Result of skill inference for a single task.
 */
export interface SkillInferenceResult {
  taskId: string;
  skills: string[];
  method: 'ai' | 'keyword';
  /** Present when AI was attempted but fell back to keyword. Describes why. */
  fallbackReason?: string;
}

/**
 * A single skill validation issue found during vocabulary validation.
 */
export interface SkillValidationIssue {
  taskId: string;
  skill: string;
  suggestion: string | null;
}
