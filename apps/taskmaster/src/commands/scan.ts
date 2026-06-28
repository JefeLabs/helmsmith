export interface ScanSummary {
  totalFiles: number;
  totalDirectories: number;
  componentCount: number;
  symbolCount: number;
  layers: string[];
  entryPointCount: number;
  entryPointCategories: string[];
  coveragePercent: number;
  detectedPatterns: string[];
  warnings: string[];
  blueprintDetections: Array<{
    blueprintId: string;
    confidence: number;
    matchedSignals: string[];
  }>;
}

/**
 * Execute the scan command: scan a repository and build a capabilities model.
 * Optionally persists indexes to repo home.
 */
export async function executeScan(rootPath: string, repoHome: string | null): Promise<ScanSummary> {
  const { runScanPipeline } = await import('../parser/analysis/scanner.js');
  const result = await runScanPipeline(rootPath);

  // Persist indexes if in a git repository
  if (repoHome) {
    const { mkdir } = await import('node:fs/promises');
    await mkdir(repoHome, { recursive: true });

    const { writeComponentIndex, writeSymbolIndex, writeEntryPointIndex } = await import(
      '../formats/index-store.js'
    );
    await writeComponentIndex(repoHome, result.componentIndex);
    await writeSymbolIndex(repoHome, result.symbolIndex);
    await writeEntryPointIndex(repoHome, result.entryPointIndex);
  }

  // Compute summary
  const symbolCount = result.symbolIndex.entries.reduce((sum, e) => sum + e.symbols.length, 0);
  const layers = [...new Set(result.symbolIndex.entries.map((e) => e.layer))];

  const reachableComponents = new Set<string>();
  for (const ep of result.entryPointIndex.entryPoints) {
    reachableComponents.add(ep.componentId);
  }
  const totalComponents = result.components.length || 1;
  const coveragePercent = Math.round((reachableComponents.size / totalComponents) * 100);

  const categories = [...new Set(result.entryPointIndex.entryPoints.map((ep) => ep.category))];

  // Blueprint auto-detection
  let blueprintDetections: ScanSummary['blueprintDetections'] = [];
  try {
    const { detectBlueprints } = await import('../blueprints/index.js');
    const detections = detectBlueprints(result.scanResult, result.components);
    blueprintDetections = detections.slice(0, 5).map((d) => ({
      blueprintId: d.blueprintId,
      confidence: d.confidence,
      matchedSignals: d.matchedSignals,
    }));
  } catch {
    // Blueprint detection is best-effort
  }

  return {
    totalFiles: result.scanResult.totalFiles,
    totalDirectories: result.scanResult.totalDirectories,
    componentCount: result.components.length,
    symbolCount,
    layers,
    entryPointCount: result.entryPointIndex.entryPoints.length,
    entryPointCategories: categories,
    coveragePercent,
    detectedPatterns: result.scanResult.detectedPatterns,
    warnings: result.warnings,
    blueprintDetections,
  };
}
