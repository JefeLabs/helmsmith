import { z } from 'zod';

// --- Architecture Component (AI-discovered, Phase 1 output) ---

export const ArchitectureComponentSchema = z.object({
  name: z.string(),
  description: z.string(),
  techStack: z.array(z.string()),
  layer: z.enum(['frontend', 'backend', 'infrastructure', 'shared', 'data', 'external']),
  patterns: z.array(z.string()),
  entryPoints: z.array(z.string()),
});

export type ArchitectureComponent = z.infer<typeof ArchitectureComponentSchema>;

/** @deprecated Use ArchitectureComponentSchema */
export const ComponentSchema = ArchitectureComponentSchema;
/** @deprecated Use ArchitectureComponent */
export type Component = ArchitectureComponent;

// --- Interface between components ---

export const ComponentInterfaceSchema = z.object({
  from: z.string(),
  to: z.string(),
  type: z.enum([
    'REST', 'gRPC', 'WebSocket', 'messageQueue',
    'internal', 'eventBus', 'fileSystem', 'CLI',
  ]),
  description: z.string(),
  protocol: z.string().optional(),
});

export type ComponentInterface = z.infer<typeof ComponentInterfaceSchema>;

// --- Data Source ---

export const DataSourceSchema = z.object({
  name: z.string(),
  type: z.enum([
    'postgres', 'mysql', 'mongodb', 'redis', 'elasticsearch', 's3', 'sqlite',
    'external-api', 'file-system', 'in-memory', 'other',
  ]),
  ownerComponent: z.string(),
  description: z.string(),
});

export type DataSource = z.infer<typeof DataSourceSchema>;

// --- Cross-Cutting Concern ---

export const CrossCuttingConcernSchema = z.object({
  name: z.enum([
    'security', 'logging', 'telemetry', 'config-management', 'error-handling',
    'testing', 'documentation', 'ci-cd', 'performance', 'accessibility',
  ]),
  scope: z.string(),
  relatedComponents: z.array(z.string()),
  implementationNotes: z.string(),
});

export type CrossCuttingConcern = z.infer<typeof CrossCuttingConcernSchema>;

// --- Full Architecture Analysis (Phase 1 output) ---

export const ArchitectureAnalysisSchema = z.object({
  summary: z.string(),
  components: z.array(ArchitectureComponentSchema),
  interfaces: z.array(ComponentInterfaceSchema),
  dataSources: z.array(DataSourceSchema),
  crossCuttingConcerns: z.array(CrossCuttingConcernSchema),
});

export type ArchitectureAnalysis = z.infer<typeof ArchitectureAnalysisSchema>;

// --- Codebase scan results (no AI, filesystem only) ---

export interface CodebaseScanResult {
  rootPath: string;
  directoryTree: string;
  fileExtensions: Record<string, number>;
  manifestContents: Record<string, string>;
  detectedPatterns: string[];
  /** Inferred capabilities from known dependencies (e.g. "express" -> "REST-server"). Future use. */
  capabilities: string[];
  totalFiles: number;
  totalDirectories: number;
}

// --- Tree-sitter source analysis (legacy) ---

export interface SourceSymbol {
  name: string;
  kind: 'function' | 'class' | 'interface' | 'type' | 'method' | 'enum' | 'const';
  exported: boolean;
  signature?: string;
  filePath: string;
}

export interface FileAnalysis {
  path: string;
  language: string;
  symbols: SourceSymbol[];
}

export interface SourceAnalysisResult {
  files: FileAnalysis[];
  publicApi: SourceSymbol[];
  summary: string;
}

// --- Pragmatic Layer Model ---

export const PragmaticLayerSchema = z.enum([
  'api', 'service', 'domain', 'data', 'infra', 'cli', 'scripts', 'tests',
]);

export type PragmaticLayer = z.infer<typeof PragmaticLayerSchema>;

// --- Enhanced Symbol Types ---

export const SymbolKindSchema = z.enum([
  'function', 'method', 'class', 'interface', 'type', 'enum', 'const',
  'route', 'command', 'script_fn', 'task',
]);

export type SymbolKind = z.infer<typeof SymbolKindSchema>;

export const SymbolVisibilitySchema = z.enum([
  'public', 'protected', 'internal', 'private',
  'exported', 'file', 'unknown',
]);

export type SymbolVisibility = z.infer<typeof SymbolVisibilitySchema>;

export const EnhancedSourceSymbolSchema = z.object({
  name: z.string(),
  kind: SymbolKindSchema,
  visibility: SymbolVisibilitySchema,
  filePath: z.string(),
  signature: z.object({ display: z.string() }).optional(),
  doc: z.object({ summary: z.string() }).optional(),
  source: z.object({
    file: z.string(),
    range: z.object({
      startLine: z.number(),
      endLine: z.number(),
    }),
  }),
  tags: z.array(z.string()),
});

export type EnhancedSourceSymbol = z.infer<typeof EnhancedSourceSymbolSchema>;

// --- Build Component (manifest-detected buildable unit) ---

export const BuildComponentSchema = z.object({
  id: z.string(),
  name: z.string(),
  rootPath: z.string(),
  languageSet: z.array(z.string()),
  howToBuild: z.string().optional(),
  howToTest: z.string().optional(),
  howToRun: z.string().optional(),
  entrypoints: z.array(z.string()),
  publicSurface: z.array(EnhancedSourceSymbolSchema),
  tags: z.array(z.string()),
});

export type BuildComponent = z.infer<typeof BuildComponentSchema>;

// --- Enhanced File Analysis ---

export const EnhancedFileAnalysisSchema = z.object({
  path: z.string(),
  language: z.string(),
  symbols: z.array(EnhancedSourceSymbolSchema),
  layer: PragmaticLayerSchema,
  componentId: z.string().optional(),
});

export type EnhancedFileAnalysis = z.infer<typeof EnhancedFileAnalysisSchema>;

// --- Indexes ---

export const ComponentIndexSchema = z.object({
  version: z.literal(1),
  repoRoot: z.string(),
  generatedAt: z.string(),
  components: z.array(BuildComponentSchema),
});

export type ComponentIndex = z.infer<typeof ComponentIndexSchema>;

export const SymbolIndexEntrySchema = z.object({
  componentId: z.string(),
  layer: PragmaticLayerSchema,
  symbols: z.array(EnhancedSourceSymbolSchema),
});

export type SymbolIndexEntry = z.infer<typeof SymbolIndexEntrySchema>;

export const SymbolIndexSchema = z.object({
  version: z.literal(1),
  repoRoot: z.string(),
  generatedAt: z.string(),
  entries: z.array(SymbolIndexEntrySchema),
});

export type SymbolIndex = z.infer<typeof SymbolIndexSchema>;

// --- Querying ---

export interface IndexQuery {
  layers?: PragmaticLayer[];
  kinds?: SymbolKind[];
  components?: string[];
  tags?: string[];
  namePattern?: string;
}

export interface IndexQueryResult {
  components: BuildComponent[];
  symbols: EnhancedSourceSymbol[];
  groupedByComponent: Record<string, EnhancedSourceSymbol[]>;
  groupedByLayer: Record<string, EnhancedSourceSymbol[]>;
}

// --- AI task shape from Phase 2 ---

export interface AITaskWithTags {
  title: string;
  description: string;
  type: string;
  priority: string;
  dependencies: string[];
  requiredSkills: string[];
  tags: string[];
  children: AITaskWithTags[];
}

export const AITaskWithTagsSchema: z.ZodType<AITaskWithTags> = z.lazy(() =>
  z.object({
    title: z.string(),
    description: z.string(),
    type: z.string().default('task'),
    priority: z.string().default('medium'),
    dependencies: z.array(z.string()).default([]),
    requiredSkills: z.array(z.string()).default([]),
    tags: z.array(z.string()).default([]),
    children: z.array(AITaskWithTagsSchema).default([]),
  }),
);

export const Phase2ResponseSchema = z.object({
  tasks: z.array(AITaskWithTagsSchema),
});

// --- Pipeline options & result ---

export interface AnalysisPipelineOptions {
  style: string;
  defaultStatus: string;
  numTasks?: number;
  model: string;
  provider?: import('../../auth/provider.js').AIProviderName;
  codebasePath?: string | null;
  skipScan?: boolean;
  blueprintId?: string;
  blueprintAnswers?: Record<string, string | boolean | string[]>;
}

export interface AnalysisPipelineResult {
  analysis: ArchitectureAnalysis;
  tasks: import('../../config/schema.js').TaskNode[];
  warnings: string[];
  componentIndex?: ComponentIndex;
  symbolIndex?: SymbolIndex;
}
