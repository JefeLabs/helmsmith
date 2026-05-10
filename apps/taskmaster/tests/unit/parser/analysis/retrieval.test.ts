import { describe, expect, it } from 'vitest';
import {
  buildComponentIndex,
  buildSymbolIndex,
  formatComponentIndexForPrompt,
  formatQueryResultForPrompt,
  queryIndex,
} from '../../../../src/parser/analysis/retrieval.js';
import type {
  BuildComponent,
  ComponentIndex,
  EnhancedFileAnalysis,
  EnhancedSourceSymbol,
  SymbolIndex,
} from '../../../../src/parser/analysis/types.js';

// --- Test helpers ---

function makeSymbol(overrides: Partial<EnhancedSourceSymbol>): EnhancedSourceSymbol {
  return {
    name: 'testFn',
    kind: 'function',
    visibility: 'exported',
    filePath: 'src/test.ts',
    source: { file: '/abs/src/test.ts', range: { startLine: 1, endLine: 10 } },
    tags: [],
    ...overrides,
  };
}

function makeComponent(overrides: Partial<BuildComponent>): BuildComponent {
  return {
    id: 'comp-a',
    name: 'comp-a',
    rootPath: '/repo/packages/comp-a',
    languageSet: ['typescript'],
    entrypoints: ['src/index.ts'],
    publicSurface: [],
    tags: ['component:comp-a'],
    ...overrides,
  };
}

function makeFileAnalysis(overrides: Partial<EnhancedFileAnalysis>): EnhancedFileAnalysis {
  return {
    path: 'src/test.ts',
    language: 'typescript',
    symbols: [makeSymbol({})],
    layer: 'service',
    componentId: 'comp-a',
    ...overrides,
  };
}

// --- Shared test data ---

const compA = makeComponent({ id: 'comp-a', name: 'comp-a' });
const compB = makeComponent({
  id: 'comp-b',
  name: 'comp-b',
  rootPath: '/repo/packages/comp-b',
  tags: ['component:comp-b'],
});

const symApiHandler = makeSymbol({
  name: 'handleRequest',
  kind: 'function',
  filePath: 'src/api/handler.ts',
  source: { file: '/abs/src/api/handler.ts', range: { startLine: 10, endLine: 25 } },
  tags: ['layer:api', 'kind:function'],
});

const symUserService = makeSymbol({
  name: 'UserService',
  kind: 'class',
  filePath: 'src/services/user.ts',
  source: { file: '/abs/src/services/user.ts', range: { startLine: 5, endLine: 80 } },
  tags: ['layer:service', 'kind:class'],
});

const symDbQuery = makeSymbol({
  name: 'queryUsers',
  kind: 'function',
  filePath: 'src/data/queries.ts',
  source: { file: '/abs/src/data/queries.ts', range: { startLine: 1, endLine: 15 } },
  tags: ['layer:data', 'kind:function'],
});

const symCliCommand = makeSymbol({
  name: 'runCommand',
  kind: 'command',
  filePath: 'src/cli/run.ts',
  source: { file: '/abs/src/cli/run.ts', range: { startLine: 1, endLine: 5 } },
  tags: ['layer:cli'],
});

const files: EnhancedFileAnalysis[] = [
  makeFileAnalysis({
    path: 'src/api/handler.ts',
    symbols: [symApiHandler],
    layer: 'api',
    componentId: 'comp-a',
  }),
  makeFileAnalysis({
    path: 'src/services/user.ts',
    symbols: [symUserService],
    layer: 'service',
    componentId: 'comp-a',
  }),
  makeFileAnalysis({
    path: 'src/data/queries.ts',
    symbols: [symDbQuery],
    layer: 'data',
    componentId: 'comp-b',
  }),
  makeFileAnalysis({
    path: 'src/cli/run.ts',
    symbols: [symCliCommand],
    layer: 'cli',
    componentId: undefined,
  }),
];

const components = [compA, compB];

// --- Tests ---

describe('buildComponentIndex', () => {
  it('creates index with correct version and timestamp', () => {
    const index = buildComponentIndex('/repo', components);
    expect(index.version).toBe(1);
    expect(index.repoRoot).toBe('/repo');
    expect(index.generatedAt).toBeTruthy();
    expect(index.components).toHaveLength(2);
    expect(index.components[0].id).toBe('comp-a');
    expect(index.components[1].id).toBe('comp-b');
  });
});

describe('buildSymbolIndex', () => {
  it('groups symbols by component and layer', () => {
    const index = buildSymbolIndex('/repo', files, components);
    expect(index.version).toBe(1);
    expect(index.repoRoot).toBe('/repo');
    expect(index.generatedAt).toBeTruthy();

    // comp-a has api and service layers
    const compAApi = index.entries.find((e) => e.componentId === 'comp-a' && e.layer === 'api');
    expect(compAApi).toBeDefined();
    expect(compAApi!.symbols).toHaveLength(1);
    expect(compAApi!.symbols[0].name).toBe('handleRequest');

    const compAService = index.entries.find(
      (e) => e.componentId === 'comp-a' && e.layer === 'service',
    );
    expect(compAService).toBeDefined();
    expect(compAService!.symbols).toHaveLength(1);
    expect(compAService!.symbols[0].name).toBe('UserService');

    // comp-b has data layer
    const compBData = index.entries.find((e) => e.componentId === 'comp-b' && e.layer === 'data');
    expect(compBData).toBeDefined();
    expect(compBData!.symbols).toHaveLength(1);
  });

  it('uses __root__ for files without componentId', () => {
    const index = buildSymbolIndex('/repo', files, components);
    const rootCli = index.entries.find((e) => e.componentId === '__root__' && e.layer === 'cli');
    expect(rootCli).toBeDefined();
    expect(rootCli!.symbols).toHaveLength(1);
    expect(rootCli!.symbols[0].name).toBe('runCommand');
  });
});

describe('queryIndex', () => {
  let componentIndex: ComponentIndex;
  let symbolIndex: SymbolIndex;

  // Build indexes once for all query tests
  componentIndex = buildComponentIndex('/repo', components);
  symbolIndex = buildSymbolIndex('/repo', files, components);

  it('with empty query returns everything', () => {
    const result = queryIndex(componentIndex, symbolIndex, {});
    expect(result.symbols).toHaveLength(4);
    expect(Object.keys(result.groupedByComponent).length).toBeGreaterThanOrEqual(2);
    expect(Object.keys(result.groupedByLayer).length).toBeGreaterThanOrEqual(3);
  });

  it('with layers filter', () => {
    const result = queryIndex(componentIndex, symbolIndex, { layers: ['api'] });
    expect(result.symbols).toHaveLength(1);
    expect(result.symbols[0].name).toBe('handleRequest');
    expect(result.groupedByLayer.api).toHaveLength(1);
  });

  it('with kinds filter', () => {
    const result = queryIndex(componentIndex, symbolIndex, { kinds: ['class'] });
    expect(result.symbols).toHaveLength(1);
    expect(result.symbols[0].name).toBe('UserService');
  });

  it('with components filter', () => {
    const result = queryIndex(componentIndex, symbolIndex, { components: ['comp-b'] });
    expect(result.symbols).toHaveLength(1);
    expect(result.symbols[0].name).toBe('queryUsers');
    expect(result.groupedByComponent['comp-b']).toHaveLength(1);
  });

  it('with tags filter (OR within tags)', () => {
    const result = queryIndex(componentIndex, symbolIndex, {
      tags: ['layer:api', 'layer:data'],
    });
    expect(result.symbols).toHaveLength(2);
    const names = result.symbols.map((s) => s.name).sort();
    expect(names).toEqual(['handleRequest', 'queryUsers']);
  });

  it('with namePattern regex', () => {
    const result = queryIndex(componentIndex, symbolIndex, { namePattern: '^handle' });
    expect(result.symbols).toHaveLength(1);
    expect(result.symbols[0].name).toBe('handleRequest');
  });

  it('with multiple filters (AND across categories)', () => {
    // Filter to comp-a AND service layer => should get only UserService
    const result = queryIndex(componentIndex, symbolIndex, {
      components: ['comp-a'],
      layers: ['service'],
    });
    expect(result.symbols).toHaveLength(1);
    expect(result.symbols[0].name).toBe('UserService');
  });
});

describe('formatComponentIndexForPrompt', () => {
  it('includes component details', () => {
    const index = buildComponentIndex('/repo', [
      makeComponent({
        id: 'web-app',
        name: 'web-app',
        languageSet: ['typescript', 'javascript'],
        howToBuild: 'npm run build',
        howToTest: 'npm test',
        entrypoints: ['src/index.ts'],
        tags: ['build:npm', 'runtime:node', 'framework:express'],
      }),
    ]);

    const output = formatComponentIndexForPrompt(index);
    expect(output).toContain('Components (1):');
    expect(output).toContain('[web-app]');
    expect(output).toContain('langs: typescript, javascript');
    expect(output).toContain('Build: npm run build');
    expect(output).toContain('Test: npm test');
    expect(output).toContain('Entry: src/index.ts');
    expect(output).toContain('Tags: build:npm, runtime:node, framework:express');
  });
});

describe('formatQueryResultForPrompt', () => {
  it('groups by component and layer', () => {
    const componentIndex = buildComponentIndex('/repo', components);
    const symbolIndex = buildSymbolIndex('/repo', files, components);
    const result = queryIndex(componentIndex, symbolIndex, {
      components: ['comp-a'],
    });

    const output = formatQueryResultForPrompt(result);
    expect(output).toContain('Query Results:');
    expect(output).toContain('symbols across');
    expect(output).toContain('By Component:');
    expect(output).toContain('[comp-a]');
    expect(output).toContain('handleRequest');
    expect(output).toContain('UserService');
    expect(output).toContain('By Layer:');
    expect(output).toContain('api');
    expect(output).toContain('service');
  });
});
