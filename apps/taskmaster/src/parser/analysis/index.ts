export { runAnalysisPipeline } from './analyzer.js';
export { formatScanForPrompt, scanCodebase } from './codebase-scanner.js';
export {
  detectFrameworks,
  discoverComponents,
  extractNpmCommands,
  resolveWorkspaces,
} from './component-discovery.js';
export {
  detectEntryPoints,
  detectEntryPointsFromAST,
  detectEntryPointsFromManifest,
  detectFileBasedRoutes,
} from './entrypoint-detection.js';
export type { EntryPointValidationResult } from './entrypoint-validation.js';
export {
  applyValidation,
  generateValidationWarnings,
  validateEntryPointCoverage,
} from './entrypoint-validation.js';
export type { SupportedLanguage } from './grammars.js';
export {
  detectLanguage,
  getSupportedExtensions,
  isSupportedExtension,
  resolveGrammarPath,
} from './grammars.js';
export { inferLayer, inferLayerFromAST, inferLayerFromPath } from './layer-inference.js';
export { buildArchitectureDiscoveryPrompt, buildTaskGenerationPrompt } from './prompts.js';
export {
  buildComponentIndex,
  buildEntryPointIndex,
  buildSymbolIndex,
  formatComponentIndexForPrompt,
  formatEntryPointIndexForPrompt,
  formatQueryResultForPrompt,
  queryIndex,
} from './retrieval.js';
export type { ScanPipelineResult } from './scanner.js';
export { runScanPipeline } from './scanner.js';
export { analyzeSource, analyzeSourceEnhanced } from './source-analyzer.js';
export type {
  AITaskWithTags,
  AnalysisPipelineOptions,
  AnalysisPipelineResult,
  ArchitectureAnalysis,
  ArchitectureComponent,
  BuildComponent,
  CodebaseScanResult,
  Component,
  ComponentIndex,
  ComponentInterface,
  CrossCuttingConcern,
  DataSource,
  EnhancedFileAnalysis,
  EnhancedSourceSymbol,
  EntryPoint,
  EntryPointCategory,
  EntryPointIndex,
  EntryPointTrace,
  FileAnalysis,
  IndexQuery,
  IndexQueryResult,
  PragmaticLayer,
  SideEffect,
  SideEffectType,
  SourceAnalysisResult,
  SourceSymbol,
  SymbolIndex,
  SymbolIndexEntry,
  SymbolKind,
  SymbolVisibility,
} from './types.js';
export {
  AITaskWithTagsSchema,
  ArchitectureAnalysisSchema,
  ArchitectureComponentSchema,
  BuildComponentSchema,
  ComponentIndexSchema,
  ComponentInterfaceSchema,
  ComponentSchema,
  CrossCuttingConcernSchema,
  DataSourceSchema,
  EnhancedFileAnalysisSchema,
  EnhancedSourceSymbolSchema,
  EntryPointCategorySchema,
  EntryPointIndexSchema,
  EntryPointSchema,
  EntryPointTraceSchema,
  Phase2ResponseSchema,
  PragmaticLayerSchema,
  SideEffectSchema,
  SideEffectTypeSchema,
  SymbolIndexEntrySchema,
  SymbolIndexSchema,
  SymbolKindSchema,
  SymbolVisibilitySchema,
} from './types.js';
