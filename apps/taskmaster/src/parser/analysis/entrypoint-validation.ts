import type {
  EntryPointIndex,
  ComponentIndex,
} from './types.js';

export interface EntryPointValidationResult {
  orphanComponents: string[];
  unreachableComponents: string[];
  entryPointsWithoutTraces: string[];
  coveragePercentage: number;
}

/**
 * Validate an EntryPointIndex against a ComponentIndex.
 *
 * Algorithm:
 * 1. Collect all component IDs from ComponentIndex
 * 2. Collect components that own entry points (EntryPoint.componentId)
 * 3. Collect components that appear in any trace's componentChain
 * 4. Union of (2) and (3) = "reachable" components
 * 5. orphanComponents = total - reachable (components with zero entry-point reach)
 * 6. unreachableComponents = components not in any trace chain (may own entry points but are "leaf" nodes)
 * 7. entryPointsWithoutTraces = entry points not referenced by any trace
 * 8. coveragePercentage = reachable / total * 100
 */
export function validateEntryPointCoverage(
  entryPointIndex: EntryPointIndex,
  componentIndex: ComponentIndex,
): EntryPointValidationResult {
  const allComponentIds = new Set(componentIndex.components.map(c => c.id));

  // Components that own at least one entry point
  const ownerComponents = new Set<string>();
  for (const ep of entryPointIndex.entryPoints) {
    if (allComponentIds.has(ep.componentId)) {
      ownerComponents.add(ep.componentId);
    }
  }

  // Components that appear in any trace's component chain
  const tracedComponents = new Set<string>();
  for (const trace of entryPointIndex.traces) {
    for (const compId of trace.componentChain) {
      if (allComponentIds.has(compId)) {
        tracedComponents.add(compId);
      }
    }
  }

  // Reachable = union of owners and traced
  const reachable = new Set([...ownerComponents, ...tracedComponents]);

  // Orphans = total - reachable
  const orphanComponents = [...allComponentIds].filter(id => !reachable.has(id));

  // Unreachable = not in any trace chain (may own entry points but are leaf nodes)
  const unreachableComponents = [...allComponentIds].filter(id => !tracedComponents.has(id) && !ownerComponents.has(id));

  // Entry points without traces
  const tracedEntryPointIds = new Set(entryPointIndex.traces.map(t => t.entryPointId));
  const entryPointsWithoutTraces = entryPointIndex.entryPoints
    .filter(ep => !tracedEntryPointIds.has(ep.id))
    .map(ep => ep.id);

  // Coverage percentage
  const total = allComponentIds.size;
  const coveragePercentage = total > 0
    ? Math.round((reachable.size / total) * 100)
    : 0;

  return {
    orphanComponents,
    unreachableComponents,
    entryPointsWithoutTraces,
    coveragePercentage,
  };
}

/**
 * Apply validation results back to an EntryPointIndex.
 * Returns a new index with the validation field populated.
 */
export function applyValidation(
  entryPointIndex: EntryPointIndex,
  componentIndex: ComponentIndex,
): EntryPointIndex {
  const validation = validateEntryPointCoverage(entryPointIndex, componentIndex);
  return {
    ...entryPointIndex,
    validation,
  };
}

/**
 * Generate validation warning messages for pipeline output.
 */
export function generateValidationWarnings(
  validation: EntryPointValidationResult,
): string[] {
  const warnings: string[] = [];

  if (validation.orphanComponents.length > 0) {
    warnings.push(
      `Orphan components (no entry points reaching them): ${validation.orphanComponents.join(', ')}`,
    );
  }

  if (validation.entryPointsWithoutTraces.length > 0) {
    warnings.push(
      `Entry points without traces (detected but not yet traced): ${validation.entryPointsWithoutTraces.length} of ${validation.entryPointsWithoutTraces.length + (validation.coveragePercentage > 0 ? 1 : 0)}`,
    );
  }

  return warnings;
}
