import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ArchitectureAnalysisSchema,
  ArchitectureComponentSchema,
  ComponentSchema,
  ComponentInterfaceSchema,
  DataSourceSchema,
  CrossCuttingConcernSchema,
  Phase2ResponseSchema,
  AITaskWithTagsSchema,
  PragmaticLayerSchema,
  SymbolKindSchema,
  SymbolVisibilitySchema,
  EnhancedSourceSymbolSchema,
  BuildComponentSchema,
  EnhancedFileAnalysisSchema,
  ComponentIndexSchema,
  SymbolIndexEntrySchema,
  SymbolIndexSchema,
} from '../../../../src/parser/analysis/types.js';

const fixturesDir = join(import.meta.dirname, '../../../fixtures/analysis');

describe('ArchitectureAnalysisSchema', () => {
  it('parses a valid analysis JSON', () => {
    const raw = JSON.parse(readFileSync(join(fixturesDir, 'sample-analysis.json'), 'utf-8'));
    const result = ArchitectureAnalysisSchema.parse(raw);

    expect(result.summary).toContain('e-commerce');
    expect(result.components).toHaveLength(4);
    expect(result.interfaces).toHaveLength(3);
    expect(result.dataSources).toHaveLength(2);
    expect(result.crossCuttingConcerns).toHaveLength(2);
  });

  it('rejects missing required fields', () => {
    expect(() => ArchitectureAnalysisSchema.parse({})).toThrow();
    expect(() => ArchitectureAnalysisSchema.parse({ summary: 'hi' })).toThrow();
  });
});

describe('ArchitectureComponentSchema', () => {
  it('parses a valid component', () => {
    const result = ArchitectureComponentSchema.parse({
      name: 'auth-service',
      description: 'Auth',
      techStack: ['TypeScript'],
      layer: 'backend',
      patterns: ['MVC'],
      entryPoints: ['src/auth/index.ts'],
    });
    expect(result.name).toBe('auth-service');
    expect(result.layer).toBe('backend');
  });

  it('rejects invalid layer values', () => {
    expect(() =>
      ArchitectureComponentSchema.parse({
        name: 'x',
        description: 'x',
        techStack: [],
        layer: 'invalid-layer',
        patterns: [],
        entryPoints: [],
      }),
    ).toThrow();
  });

  it('is aliased as ComponentSchema for backward compatibility', () => {
    expect(ComponentSchema).toBe(ArchitectureComponentSchema);
  });
});

describe('ComponentInterfaceSchema', () => {
  it('parses a valid interface', () => {
    const result = ComponentInterfaceSchema.parse({
      from: 'frontend',
      to: 'backend',
      type: 'REST',
      description: 'API calls',
    });
    expect(result.type).toBe('REST');
  });

  it('accepts optional protocol field', () => {
    const result = ComponentInterfaceSchema.parse({
      from: 'a',
      to: 'b',
      type: 'gRPC',
      description: 'RPC',
      protocol: 'HTTP/2',
    });
    expect(result.protocol).toBe('HTTP/2');
  });

  it('rejects invalid interface types', () => {
    expect(() =>
      ComponentInterfaceSchema.parse({
        from: 'a',
        to: 'b',
        type: 'SOAP',
        description: 'test',
      }),
    ).toThrow();
  });
});

describe('DataSourceSchema', () => {
  it('parses a valid data source', () => {
    const result = DataSourceSchema.parse({
      name: 'users-db',
      type: 'postgres',
      ownerComponent: 'auth-service',
      description: 'User data',
    });
    expect(result.type).toBe('postgres');
  });
});

describe('CrossCuttingConcernSchema', () => {
  it('parses a valid concern', () => {
    const result = CrossCuttingConcernSchema.parse({
      name: 'security',
      scope: 'All APIs',
      relatedComponents: ['auth', 'api'],
      implementationNotes: 'JWT middleware',
    });
    expect(result.name).toBe('security');
  });

  it('rejects invalid concern names', () => {
    expect(() =>
      CrossCuttingConcernSchema.parse({
        name: 'custom-thing',
        scope: 'x',
        relatedComponents: [],
        implementationNotes: 'x',
      }),
    ).toThrow();
  });
});

describe('Phase2ResponseSchema', () => {
  it('parses a valid Phase 2 response', () => {
    const raw = JSON.parse(readFileSync(join(fixturesDir, 'sample-phase2-response.json'), 'utf-8'));
    const result = Phase2ResponseSchema.parse(raw);

    expect(result.tasks).toHaveLength(5);
    expect(result.tasks[0].title).toBe('Implement Auth Service');
    expect(result.tasks[0].tags).toContain('component:auth-service');
    expect(result.tasks[0].children).toHaveLength(2);
  });

  it('applies defaults to missing optional fields', () => {
    const result = Phase2ResponseSchema.parse({
      tasks: [{ title: 'Minimal', description: 'Desc' }],
    });
    expect(result.tasks[0].priority).toBe('medium');
    expect(result.tasks[0].tags).toEqual([]);
    expect(result.tasks[0].children).toEqual([]);
    expect(result.tasks[0].dependencies).toEqual([]);
  });
});

describe('AITaskWithTagsSchema', () => {
  it('parses nested tasks recursively', () => {
    const result = AITaskWithTagsSchema.parse({
      title: 'Parent',
      description: 'Parent task',
      children: [
        {
          title: 'Child',
          description: 'Child task',
          children: [],
        },
      ],
    });
    expect(result.children).toHaveLength(1);
    expect(result.children[0].title).toBe('Child');
  });
});

// --- New schema tests ---

describe('PragmaticLayerSchema', () => {
  it('accepts all valid layers', () => {
    const layers = ['api', 'service', 'domain', 'data', 'infra', 'cli', 'scripts', 'tests'];
    for (const layer of layers) {
      expect(PragmaticLayerSchema.parse(layer)).toBe(layer);
    }
  });

  it('rejects invalid layers', () => {
    expect(() => PragmaticLayerSchema.parse('frontend')).toThrow();
    expect(() => PragmaticLayerSchema.parse('backend')).toThrow();
  });
});

describe('SymbolKindSchema', () => {
  it('accepts all valid kinds including new ones', () => {
    const kinds = ['function', 'method', 'class', 'interface', 'type', 'enum', 'const', 'route', 'command', 'script_fn', 'task'];
    for (const kind of kinds) {
      expect(SymbolKindSchema.parse(kind)).toBe(kind);
    }
  });

  it('rejects invalid kinds', () => {
    expect(() => SymbolKindSchema.parse('module')).toThrow();
  });
});

describe('SymbolVisibilitySchema', () => {
  it('accepts all valid visibility values', () => {
    const values = ['public', 'protected', 'internal', 'private', 'exported', 'file', 'unknown'];
    for (const v of values) {
      expect(SymbolVisibilitySchema.parse(v)).toBe(v);
    }
  });
});

describe('EnhancedSourceSymbolSchema', () => {
  const validSymbol = {
    name: 'handleRequest',
    kind: 'function',
    visibility: 'exported',
    filePath: 'src/api/handler.ts',
    source: { file: '/abs/src/api/handler.ts', range: { startLine: 10, endLine: 25 } },
    tags: ['layer:api', 'kind:function'],
  };

  it('parses a valid enhanced symbol', () => {
    const result = EnhancedSourceSymbolSchema.parse(validSymbol);
    expect(result.name).toBe('handleRequest');
    expect(result.visibility).toBe('exported');
    expect(result.source.range.startLine).toBe(10);
  });

  it('accepts optional signature and doc', () => {
    const result = EnhancedSourceSymbolSchema.parse({
      ...validSymbol,
      signature: { display: 'function handleRequest(req: Request): Response' },
      doc: { summary: 'Handles incoming HTTP requests' },
    });
    expect(result.signature!.display).toContain('handleRequest');
    expect(result.doc!.summary).toContain('HTTP');
  });

  it('rejects missing source range', () => {
    expect(() =>
      EnhancedSourceSymbolSchema.parse({ ...validSymbol, source: { file: '/a' } }),
    ).toThrow();
  });
});

describe('BuildComponentSchema', () => {
  const validComponent = {
    id: 'my-service',
    name: 'my-service',
    rootPath: '/abs/packages/my-service',
    languageSet: ['typescript'],
    entrypoints: ['src/index.ts'],
    publicSurface: [],
    tags: ['component:my-service', 'build:npm', 'lang:typescript'],
  };

  it('parses a valid build component', () => {
    const result = BuildComponentSchema.parse(validComponent);
    expect(result.id).toBe('my-service');
    expect(result.languageSet).toEqual(['typescript']);
  });

  it('accepts optional build/test/run commands', () => {
    const result = BuildComponentSchema.parse({
      ...validComponent,
      howToBuild: 'npm run build',
      howToTest: 'npm test',
      howToRun: 'npm start',
    });
    expect(result.howToBuild).toBe('npm run build');
    expect(result.howToTest).toBe('npm test');
  });
});

describe('EnhancedFileAnalysisSchema', () => {
  it('parses a valid enhanced file analysis', () => {
    const result = EnhancedFileAnalysisSchema.parse({
      path: 'src/api/routes.ts',
      language: 'typescript',
      symbols: [],
      layer: 'api',
      componentId: 'my-service',
    });
    expect(result.layer).toBe('api');
    expect(result.componentId).toBe('my-service');
  });

  it('componentId is optional', () => {
    const result = EnhancedFileAnalysisSchema.parse({
      path: 'scripts/deploy.sh',
      language: 'bash',
      symbols: [],
      layer: 'scripts',
    });
    expect(result.componentId).toBeUndefined();
  });
});

describe('ComponentIndexSchema', () => {
  it('parses a valid component index', () => {
    const result = ComponentIndexSchema.parse({
      version: 1,
      repoRoot: '/home/user/project',
      generatedAt: '2026-02-16T00:00:00Z',
      components: [],
    });
    expect(result.version).toBe(1);
    expect(result.components).toEqual([]);
  });

  it('rejects wrong version', () => {
    expect(() =>
      ComponentIndexSchema.parse({
        version: 2,
        repoRoot: '/a',
        generatedAt: 'now',
        components: [],
      }),
    ).toThrow();
  });
});

describe('SymbolIndexSchema', () => {
  it('parses a valid symbol index', () => {
    const result = SymbolIndexSchema.parse({
      version: 1,
      repoRoot: '/home/user/project',
      generatedAt: '2026-02-16T00:00:00Z',
      entries: [
        {
          componentId: 'my-service',
          layer: 'api',
          symbols: [],
        },
      ],
    });
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].layer).toBe('api');
  });

  it('rejects invalid layer in entries', () => {
    expect(() =>
      SymbolIndexSchema.parse({
        version: 1,
        repoRoot: '/a',
        generatedAt: 'now',
        entries: [{ componentId: 'x', layer: 'backend', symbols: [] }],
      }),
    ).toThrow();
  });
});
