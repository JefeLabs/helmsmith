import chalk from 'chalk';
import { scanCodebase } from './codebase-scanner.js';
import { analyzeSourceEnhanced } from './source-analyzer.js';
import { discoverComponents } from './component-discovery.js';
import { buildComponentIndex, buildSymbolIndex } from './retrieval.js';
import type {
  CodebaseScanResult,
  SourceAnalysisResult,
  BuildComponent,
  ComponentIndex,
  SymbolIndex,
  EnhancedFileAnalysis,
} from './types.js';

export interface ScanPipelineResult {
  scanResult: CodebaseScanResult;
  components: BuildComponent[];
  enhancedFiles: EnhancedFileAnalysis[];
  sourceResult: SourceAnalysisResult | null;
  componentIndex: ComponentIndex;
  symbolIndex: SymbolIndex;
  warnings: string[];
}

/**
 * Run the non-AI scan pipeline: component discovery, codebase scan,
 * enhanced source analysis (tree-sitter + layer inference), and index building.
 *
 * This is the standalone equivalent of the scan steps embedded in
 * runAnalysisPipeline, but without any AI calls.
 */
export async function runScanPipeline(rootPath: string): Promise<ScanPipelineResult> {
  const warnings: string[] = [];

  // --- Step 0: Component discovery ---
  let components: BuildComponent[] = [];
  console.error(chalk.dim('  Discovering components...'));
  try {
    components = await discoverComponents(rootPath);
    console.error(chalk.dim(`  Found ${components.length} buildable component(s)`));
  } catch (err) {
    warnings.push(`Component discovery failed: ${(err as Error).message}`);
  }

  // --- Step 1: Codebase scan ---
  console.error(chalk.dim('  Scanning codebase...'));
  let scanResult: CodebaseScanResult;
  try {
    scanResult = await scanCodebase(rootPath);
    console.error(
      chalk.dim(
        `  Scanned: ${scanResult.totalFiles} files, ${scanResult.totalDirectories} dirs, ` +
        `patterns: [${scanResult.detectedPatterns.join(', ')}]`,
      ),
    );
  } catch (err) {
    throw new Error(`Codebase scan failed: ${(err as Error).message}`);
  }

  // --- Step 2: Enhanced source analysis ---
  let sourceResult: SourceAnalysisResult | null = null;
  let enhancedFiles: EnhancedFileAnalysis[] = [];

  console.error(chalk.dim('  Analyzing source with tree-sitter...'));
  try {
    const enhancedResult = await analyzeSourceEnhanced(rootPath, components);
    sourceResult = enhancedResult.legacy;
    enhancedFiles = enhancedResult.enhanced;
    const symbolCount = sourceResult.publicApi.length;
    console.error(chalk.dim(`  Found ${symbolCount} exported symbol(s) across ${sourceResult.files.length} file(s)`));
  } catch (err) {
    warnings.push(`Source analysis failed: ${(err as Error).message}`);
  }

  // --- Step 3: Build indexes ---
  const componentIndex = buildComponentIndex(rootPath, components);
  const symbolIndex = buildSymbolIndex(rootPath, enhancedFiles, components);

  if (components.length > 0) {
    console.error(chalk.dim(`  Built component index (${components.length}) and symbol index (${symbolIndex.entries.length} entries)`));
  } else {
    console.error(chalk.dim(`  Built symbol index (${symbolIndex.entries.length} entries)`));
  }

  return {
    scanResult,
    components,
    enhancedFiles,
    sourceResult,
    componentIndex,
    symbolIndex,
    warnings,
  };
}
