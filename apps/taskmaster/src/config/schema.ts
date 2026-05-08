import { z } from 'zod';

// --- Dependency schema ---

export const DependencySchema = z.object({
  taskId: z.string(),
  type: z.enum(['blocks', 'produces', 'relates']),
});

export type Dependency = z.infer<typeof DependencySchema>;

// --- Task metadata schema ---

export const TaskMetadataSchema = z.object({
  source: z.string().default(''),
  autoExpanded: z.boolean().default(false),
  skillsInferred: z.boolean().default(false),
  depsInferred: z.boolean().optional(),
  createdAt: z.string().default(() => new Date().toISOString()),
});

export type TaskMetadata = z.infer<typeof TaskMetadataSchema>;

// --- QA feedback entry schema ---

export const QAFeedbackEntrySchema = z.object({
  testType: z.enum(['component', 'integration', 'api', 'e2e', 'unit', 'manual', 'other']),
  result: z.enum(['fail', 'pass']),
  description: z.string(),
  cause: z.string().default(''),
  severity: z.enum(['critical', 'major', 'minor']).default('major'),
  reporter: z.string().default('qa-agent'),
  timestamp: z.string(),
});

export type QAFeedbackEntry = z.infer<typeof QAFeedbackEntrySchema>;

// --- TaskNode schema (recursive) ---

export const TaskNodeSchema: z.ZodType<TaskNode> = z.lazy(() =>
  z.object({
    id: z.string(),
    title: z.string(),
    description: z.string().default(''),
    type: z.enum(['epic', 'story', 'task', 'subtask']),
    status: z.string().default('todo'),
    complexity: z.number().min(1).max(10).default(1),
    priority: z.enum(['critical', 'high', 'medium', 'low']).default('medium'),
    requiredSkills: z.array(z.string()).default([]),
    dependencies: z.array(DependencySchema).default([]),
    readiness: z.enum(['ready', 'blocked', 'pending']).default('pending'),
    assignee: z.string().nullable().default(null),
    outputs: z.array(z.string()).default([]),
    tags: z.array(z.string()).default([]),
    qaFeedback: z.array(QAFeedbackEntrySchema).default([]),
    children: z.array(TaskNodeSchema).default([]),
    metadata: TaskMetadataSchema.default({}),
  }),
);

export interface TaskNode {
  id: string;
  title: string;
  description: string;
  type: 'epic' | 'story' | 'task' | 'subtask';
  status: string;
  complexity: number;
  priority: 'critical' | 'high' | 'medium' | 'low';
  requiredSkills: string[];
  dependencies: Dependency[];
  readiness: 'ready' | 'blocked' | 'pending';
  assignee: string | null;
  outputs: string[];
  tags: string[];
  qaFeedback: QAFeedbackEntry[];
  children: TaskNode[];
  metadata: TaskMetadata;
}

// --- Tasks array schema (the root of tasks.json) ---

export const TasksFileSchema = z.array(TaskNodeSchema);

// --- State definition schema ---

export const StateDefinitionSchema = z.object({
  name: z.string(),
  category: z.enum(['open', 'active', 'closed']),
  transitions: z.array(z.string()).optional(),
});

export type StateDefinition = z.infer<typeof StateDefinitionSchema>;

// --- States configuration schema ---

export const StatesConfigSchema = z.object({
  preset: z.enum(['simple', 'standard', 'kanban', 'custom']).default('standard'),
  custom: z.array(StateDefinitionSchema).optional(),
  enforce_transitions: z.boolean().default(false),
});

export type StatesConfig = z.infer<typeof StatesConfigSchema>;

// --- Skills configuration schema ---

export const SkillsConfigSchema = z.object({
  vocabulary: z.array(z.string()).default([]),
  auto_infer: z.boolean().default(true),
});

export type SkillsConfig = z.infer<typeof SkillsConfigSchema>;

// --- AI configuration schema ---

export const AIProviderNameSchema = z.enum(['copilot', 'anthropic', 'openai']);

export const AIConfigSchema = z.object({
  provider: AIProviderNameSchema.default('copilot'),
  model: z.string().default('claude-sonnet-4-20250514'),
});

export type AIConfig = z.infer<typeof AIConfigSchema>;

// --- Thresholds schema ---

export const ThresholdsSchema = z.object({
  expand: z.number().min(1).max(10).default(5),
  flag: z.number().min(1).max(10).default(8),
});

export type Thresholds = z.infer<typeof ThresholdsSchema>;

// --- Blueprint configuration schema ---

export const BlueprintProjectConfigSchema = z.object({
  id: z.string().optional(),
  contextAnswers: z
    .record(z.string(), z.union([z.string(), z.boolean(), z.array(z.string())]))
    .default({}),
}).default({});

export type BlueprintProjectConfig = z.infer<typeof BlueprintProjectConfigSchema>;

// --- Project config.yaml schema ---

export const ProjectConfigSchema = z.object({
  style: z.enum(['agile-full', 'story-driven', 'task-only', 'flat']).default('task-only'),
  states: StatesConfigSchema.default({}),
  skills: SkillsConfigSchema.default({}),
  ai: AIConfigSchema.default({}),
  thresholds: ThresholdsSchema.default({}),
  blueprint: BlueprintProjectConfigSchema,
});

export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;
