import type {
  BuildComponent,
  EnhancedFileAnalysis,
  EnhancedSourceSymbol,
  ComponentIndex,
  SymbolIndex,
  SymbolIndexEntry,
  IndexQuery,
  IndexQueryResult,
  PragmaticLayer,
  SymbolKind,
  EntryPoint,
  EntryPointTrace,
  EntryPointIndex,
} from './types.js';

/**
 * Build a ComponentIndex from a list of discovered BuildComponents.
 */
export function buildComponentIndex(
  repoRoot: string,
  components: BuildComponent[],
): ComponentIndex {
  return {
    version: 1,
    repoRoot,
    generatedAt: new Date().toISOString(),
    components,
  };
}

/**
 * Build a SymbolIndex by grouping file symbols into (componentId, layer) buckets.
 *
 * Files without a componentId are grouped under the `__root__` component.
 */
export function buildSymbolIndex(
  repoRoot: string,
  files: EnhancedFileAnalysis[],
  _components: BuildComponent[],
): SymbolIndex {
  const bucketKey = (componentId: string, layer: PragmaticLayer): string =>
    `${componentId}::${layer}`;

  const buckets = new Map<string, SymbolIndexEntry>();

  for (const file of files) {
    const compId = file.componentId ?? '__root__';
    const key = bucketKey(compId, file.layer);

    let entry = buckets.get(key);
    if (!entry) {
      entry = {
        componentId: compId,
        layer: file.layer,
        symbols: [],
      };
      buckets.set(key, entry);
    }

    entry.symbols.push(...file.symbols);
  }

  const entries = Array.from(buckets.values());

  return {
    version: 1,
    repoRoot,
    generatedAt: new Date().toISOString(),
    entries,
  };
}

/**
 * Query component and symbol indexes.
 *
 * Filtering semantics: AND across categories, OR within a category.
 * - layers: entry.layer must be in the set
 * - components: entry.componentId must be in the set
 * - kinds: symbol.kind must be in the set
 * - tags: symbol must have at least one matching tag (OR)
 * - namePattern: symbol.name must match the regex
 */
export function queryIndex(
  componentIndex: ComponentIndex,
  symbolIndex: SymbolIndex,
  query: IndexQuery,
): IndexQueryResult {
  // 1. Start with all entries
  let entries = [...symbolIndex.entries];

  // 2. Filter by layers (if provided)
  if (query.layers && query.layers.length > 0) {
    const layerSet = new Set<PragmaticLayer>(query.layers);
    entries = entries.filter((e) => layerSet.has(e.layer));
  }

  // 3. Filter by components (if provided)
  if (query.components && query.components.length > 0) {
    const compSet = new Set<string>(query.components);
    entries = entries.filter((e) => compSet.has(e.componentId));
  }

  // 4. Collect all symbols from remaining entries
  let symbols: EnhancedSourceSymbol[] = entries.flatMap((e) => e.symbols);

  // 5. Filter by kinds (if provided)
  if (query.kinds && query.kinds.length > 0) {
    const kindSet = new Set<SymbolKind>(query.kinds);
    symbols = symbols.filter((s) => kindSet.has(s.kind));
  }

  // 6. Filter by tags (OR within tags)
  if (query.tags && query.tags.length > 0) {
    const tagSet = new Set<string>(query.tags);
    symbols = symbols.filter((s) => s.tags.some((t) => tagSet.has(t)));
  }

  // 7. Filter by namePattern regex
  if (query.namePattern) {
    const regex = new RegExp(query.namePattern);
    symbols = symbols.filter((s) => regex.test(s.name));
  }

  // 8. Find matching components from the component index
  const matchedComponentIds = new Set<string>();
  for (const entry of entries) {
    matchedComponentIds.add(entry.componentId);
  }
  // Also gather component IDs from the surviving symbols via entries
  const symbolComponentIds = new Set<string>();
  for (const entry of entries) {
    const entrySymbolNames = new Set(entry.symbols.map((s) => s.name));
    if (symbols.some((s) => entrySymbolNames.has(s.name))) {
      symbolComponentIds.add(entry.componentId);
    }
  }

  const matchingComponents = componentIndex.components.filter(
    (c) => matchedComponentIds.has(c.id) || symbolComponentIds.has(c.id),
  );

  // 9. Group results by component
  const groupedByComponent: Record<string, EnhancedSourceSymbol[]> = {};
  for (const entry of entries) {
    const entrySymbols = symbols.filter((s) =>
      entry.symbols.some(
        (es) => es.name === s.name && es.filePath === s.filePath && es.kind === s.kind,
      ),
    );
    if (entrySymbols.length > 0) {
      if (!groupedByComponent[entry.componentId]) {
        groupedByComponent[entry.componentId] = [];
      }
      groupedByComponent[entry.componentId].push(...entrySymbols);
    }
  }

  // 10. Group results by layer
  const groupedByLayer: Record<string, EnhancedSourceSymbol[]> = {};
  for (const entry of entries) {
    const entrySymbols = symbols.filter((s) =>
      entry.symbols.some(
        (es) => es.name === s.name && es.filePath === s.filePath && es.kind === s.kind,
      ),
    );
    if (entrySymbols.length > 0) {
      if (!groupedByLayer[entry.layer]) {
        groupedByLayer[entry.layer] = [];
      }
      groupedByLayer[entry.layer].push(...entrySymbols);
    }
  }

  return {
    components: matchingComponents,
    symbols,
    groupedByComponent,
    groupedByLayer,
  };
}

/**
 * Format a ComponentIndex as human-readable text for AI prompt inclusion.
 */
export function formatComponentIndexForPrompt(index: ComponentIndex): string {
  const lines: string[] = [];
  lines.push(`Components (${index.components.length}):`);

  for (const comp of index.components) {
    lines.push('');
    lines.push(`  [${comp.name}] (langs: ${comp.languageSet.join(', ')})`);
    if (comp.howToBuild) {
      lines.push(`    Build: ${comp.howToBuild}`);
    }
    if (comp.howToTest) {
      lines.push(`    Test: ${comp.howToTest}`);
    }
    if (comp.entrypoints.length > 0) {
      lines.push(`    Entry: ${comp.entrypoints.join(', ')}`);
    }
    if (comp.tags.length > 0) {
      lines.push(`    Tags: ${comp.tags.join(', ')}`);
    }
  }

  return lines.join('\n');
}

/**
 * Format an IndexQueryResult as human-readable text for AI prompt inclusion.
 */
export function formatQueryResultForPrompt(result: IndexQueryResult): string {
  const componentCount = Object.keys(result.groupedByComponent).length;
  const lines: string[] = [];
  lines.push(`Query Results: ${result.symbols.length} symbols across ${componentCount} components`);

  // By Component
  const componentIds = Object.keys(result.groupedByComponent);
  if (componentIds.length > 0) {
    lines.push('');
    lines.push('By Component:');
    for (const compId of componentIds) {
      const syms = result.groupedByComponent[compId];
      lines.push(`  [${compId}] (${syms.length} symbols)`);
      for (const sym of syms) {
        const range = `${sym.source.file}:${sym.source.range.startLine}-${sym.source.range.endLine}`;
        lines.push(`    ${sym.kind} ${sym.name} (${sym.visibility}) — ${range}`);
      }
    }
  }

  // By Layer
  const layers = Object.keys(result.groupedByLayer);
  if (layers.length > 0) {
    lines.push('');
    lines.push('By Layer:');
    for (const layer of layers) {
      const syms = result.groupedByLayer[layer];
      lines.push(`  ${layer} (${syms.length} symbols)`);
      for (const sym of syms) {
        const range = `${sym.source.file}:${sym.source.range.startLine}-${sym.source.range.endLine}`;
        lines.push(`    ${sym.kind} ${sym.name} (${sym.visibility}) — ${range}`);
      }
    }
  }

  return lines.join('\n');
}

/**
 * Build an EntryPointIndex from detected entry points and optional traces.
 */
export function buildEntryPointIndex(
  repoRoot: string,
  entryPoints: EntryPoint[],
  traces: EntryPointTrace[] = [],
): EntryPointIndex {
  return {
    version: 1,
    repoRoot,
    generatedAt: new Date().toISOString(),
    entryPoints,
    traces,
    validation: {
      orphanComponents: [],
      unreachableComponents: [],
      entryPointsWithoutTraces: entryPoints
        .filter(ep => !traces.some(t => t.entryPointId === ep.id))
        .map(ep => ep.id),
      coveragePercentage: 0,
    },
  };
}

/**
 * Format an EntryPointIndex as human-readable text for AI prompt inclusion.
 */
export function formatEntryPointIndexForPrompt(index: EntryPointIndex): string {
  const lines: string[] = [];
  lines.push(`Entry Points (${index.entryPoints.length}):`);

  // Group by category
  const byCategory = new Map<string, EntryPoint[]>();
  for (const ep of index.entryPoints) {
    const group = byCategory.get(ep.category) ?? [];
    group.push(ep);
    byCategory.set(ep.category, group);
  }

  for (const [category, eps] of byCategory) {
    lines.push('');
    lines.push(`  ${category} (${eps.length}):`);
    for (const ep of eps) {
      const confidence = Math.round(ep.confidence * 100);
      lines.push(`    ${ep.name} [${ep.componentId}] (${confidence}% confidence)`);
      if (ep.filePath) {
        lines.push(`      File: ${ep.filePath}`);
      }
    }
  }

  if (index.traces.length > 0) {
    lines.push('');
    lines.push(`Traces (${index.traces.length}):`);
    for (const trace of index.traces) {
      lines.push(`  ${trace.entryPointId}: ${trace.componentChain.join(' → ')}`);
      if (trace.sideEffects.length > 0) {
        lines.push(`    Side effects: ${trace.sideEffects.map(se => `${se.type}(${se.target})`).join(', ')}`);
      }
      if (trace.externalSystems.length > 0) {
        lines.push(`    External: ${trace.externalSystems.join(', ')}`);
      }
    }
  }

  if (index.validation.coveragePercentage > 0) {
    lines.push('');
    lines.push(`Coverage: ${index.validation.coveragePercentage}%`);
    if (index.validation.orphanComponents.length > 0) {
      lines.push(`Orphan components: ${index.validation.orphanComponents.join(', ')}`);
    }
  }

  return lines.join('\n');
}
