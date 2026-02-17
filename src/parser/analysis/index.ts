export { runAnalysisPipeline } from './analyzer.js';
export { runScanPipeline } from './scanner.js';
export type { ScanPipelineResult } from './scanner.js';
export { scanCodebase, formatScanForPrompt } from './codebase-scanner.js';
export { analyzeSource, analyzeSourceEnhanced } from './source-analyzer.js';
export {
  discoverComponents,
  resolveWorkspaces,
  extractNpmCommands,
  detectFrameworks,
} from './component-discovery.js';
export { inferLayerFromPath, inferLayerFromAST, inferLayer } from './layer-inference.js';
export { buildArchitectureDiscoveryPrompt, buildTaskGenerationPrompt } from './prompts.js';
export { detectLanguage, isSupportedExtension, resolveGrammarPath, getSupportedExtensions } from './grammars.js';
export type { SupportedLanguage } from './grammars.js';
export type {
  ArchitectureComponent,
  Component,
  ComponentInterface,
  DataSource,
  CrossCuttingConcern,
  ArchitectureAnalysis,
  CodebaseScanResult,
  SourceSymbol,
  FileAnalysis,
  SourceAnalysisResult,
  PragmaticLayer,
  SymbolKind,
  SymbolVisibility,
  EnhancedSourceSymbol,
  BuildComponent,
  EnhancedFileAnalysis,
  ComponentIndex,
  SymbolIndexEntry,
  SymbolIndex,
  IndexQuery,
  IndexQueryResult,
  AITaskWithTags,
  AnalysisPipelineOptions,
  AnalysisPipelineResult,
  EntryPointCategory,
  EntryPoint,
  SideEffectType,
  SideEffect,
  EntryPointTrace,
  EntryPointIndex,
} from './types.js';
export {
  buildComponentIndex,
  buildSymbolIndex,
  queryIndex,
  formatComponentIndexForPrompt,
  formatQueryResultForPrompt,
  buildEntryPointIndex,
  formatEntryPointIndexForPrompt,
} from './retrieval.js';
export {
  detectEntryPoints,
  detectEntryPointsFromAST,
  detectEntryPointsFromManifest,
  detectFileBasedRoutes,
} from './entrypoint-detection.js';
export {
  validateEntryPointCoverage,
  applyValidation,
  generateValidationWarnings,
} from './entrypoint-validation.js';
export type { EntryPointValidationResult } from './entrypoint-validation.js';
export {
  ArchitectureAnalysisSchema,
  ArchitectureComponentSchema,
  ComponentSchema,
  ComponentInterfaceSchema,
  DataSourceSchema,
  CrossCuttingConcernSchema,
  PragmaticLayerSchema,
  SymbolKindSchema,
  SymbolVisibilitySchema,
  EnhancedSourceSymbolSchema,
  BuildComponentSchema,
  EnhancedFileAnalysisSchema,
  ComponentIndexSchema,
  SymbolIndexEntrySchema,
  SymbolIndexSchema,
  Phase2ResponseSchema,
  AITaskWithTagsSchema,
  EntryPointCategorySchema,
  EntryPointSchema,
  SideEffectTypeSchema,
  SideEffectSchema,
  EntryPointTraceSchema,
  EntryPointIndexSchema,
} from './types.js';
