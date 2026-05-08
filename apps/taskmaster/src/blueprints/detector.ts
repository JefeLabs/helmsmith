import type { CodebaseScanResult, BuildComponent } from '../parser/analysis/types.js';
import type { BlueprintDetectionResult } from './types.js';
import { BLUEPRINTS } from './registry.js';

/**
 * Score each blueprint's detection hints against scan results and component
 * tags. Returns candidates sorted by confidence with matched signals.
 */
export function detectBlueprints(
  scanResult: CodebaseScanResult,
  components: BuildComponent[],
): BlueprintDetectionResult[] {
  const results: BlueprintDetectionResult[] = [];

  const componentTags = new Set<string>();
  for (const comp of components) {
    for (const tag of comp.tags) {
      componentTags.add(tag);
    }
  }

  for (const blueprint of Object.values(BLUEPRINTS)) {
    const hints = blueprint.detectionHints;
    const matchedSignals: string[] = [];
    let totalPossible = 0;
    let totalMatched = 0;

    // Check pattern matches
    if (hints.patterns.length > 0) {
      totalPossible += hints.patterns.length;
      for (const pattern of hints.patterns) {
        if (scanResult.detectedPatterns.includes(pattern)) {
          matchedSignals.push(pattern);
          totalMatched++;
        }
      }
    }

    // Check framework matches against component tags
    if (hints.frameworks.length > 0) {
      totalPossible += hints.frameworks.length;
      for (const framework of hints.frameworks) {
        if (componentTags.has(framework)) {
          matchedSignals.push(framework);
          totalMatched++;
        }
      }
    }

    // Check capability matches
    if (hints.capabilities.length > 0) {
      totalPossible += hints.capabilities.length;
      for (const capability of hints.capabilities) {
        if (scanResult.capabilities.includes(capability)) {
          matchedSignals.push(capability);
          totalMatched++;
        }
      }
    }

    // Check file indicator matches against directory tree
    if (hints.fileIndicators.length > 0) {
      totalPossible += hints.fileIndicators.length;
      for (const indicator of hints.fileIndicators) {
        if (scanResult.directoryTree.includes(indicator)) {
          matchedSignals.push(indicator);
          totalMatched++;
        }
      }
    }

    if (totalPossible === 0 || totalMatched === 0) continue;

    // Confidence = (matched / possible) * weight
    const rawConfidence = totalMatched / totalPossible;
    const confidence = Math.round(rawConfidence * hints.weight * 100) / 100;

    if (confidence > 0) {
      results.push({
        blueprintId: blueprint.id,
        confidence,
        matchedSignals,
      });
    }
  }

  // Sort by confidence descending
  results.sort((a, b) => b.confidence - a.confidence);

  return results;
}
