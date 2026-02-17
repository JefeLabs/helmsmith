import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock chalk to avoid ANSI codes in test output
vi.mock('chalk', () => ({
  default: {
    dim: (s: string) => s,
  },
}));

// Mock dependencies
vi.mock('../../../../src/parser/analysis/component-discovery.js', () => ({
  discoverComponents: vi.fn(),
}));

vi.mock('../../../../src/parser/analysis/codebase-scanner.js', () => ({
  scanCodebase: vi.fn(),
}));

vi.mock('../../../../src/parser/analysis/source-analyzer.js', () => ({
  analyzeSourceEnhanced: vi.fn(),
}));

vi.mock('../../../../src/parser/analysis/entrypoint-detection.js', () => ({
  detectEntryPoints: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../../../src/parser/analysis/entrypoint-validation.js', () => ({
  applyValidation: vi.fn((index: unknown) => index),
  generateValidationWarnings: vi.fn().mockReturnValue([]),
}));

import { runScanPipeline } from '../../../../src/parser/analysis/scanner.js';
import { discoverComponents } from '../../../../src/parser/analysis/component-discovery.js';
import { scanCodebase } from '../../../../src/parser/analysis/codebase-scanner.js';
import { analyzeSourceEnhanced } from '../../../../src/parser/analysis/source-analyzer.js';
import type { CodebaseScanResult, BuildComponent, EnhancedFileAnalysis, SourceAnalysisResult } from '../../../../src/parser/analysis/types.js';

const mockedDiscoverComponents = vi.mocked(discoverComponents);
const mockedScanCodebase = vi.mocked(scanCodebase);
const mockedAnalyzeSourceEnhanced = vi.mocked(analyzeSourceEnhanced);

const fakeScanResult: CodebaseScanResult = {
  rootPath: '/test',
  directoryTree: 'src/\n  index.ts',
  fileExtensions: { '.ts': 2 },
  manifestContents: {},
  detectedPatterns: ['typescript'],
  capabilities: [],
  totalFiles: 2,
  totalDirectories: 1,
};

const fakeComponent: BuildComponent = {
  id: 'root',
  name: 'test-project',
  rootPath: '/test',
  languageSet: ['typescript'],
  entrypoints: ['src/index.ts'],
  entryPointIds: [],
  publicSurface: [],
  tags: ['node'],
};

const fakeEnhancedFile: EnhancedFileAnalysis = {
  path: 'src/index.ts',
  language: 'typescript',
  symbols: [
    {
      name: 'main',
      kind: 'function',
      visibility: 'exported',
      filePath: 'src/index.ts',
      source: { file: 'src/index.ts', range: { startLine: 1, endLine: 5 } },
      tags: ['entrypoint'],
    },
  ],
  layer: 'service',
  componentId: 'root',
};

const fakeLegacyResult: SourceAnalysisResult = {
  files: [{ path: 'src/index.ts', language: 'typescript', symbols: [] }],
  publicApi: [{ name: 'main', kind: 'function', exported: true, filePath: 'src/index.ts' }],
  summary: '1 file, 1 export',
};

describe('runScanPipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('runs all scan steps and returns a complete result', async () => {
    mockedDiscoverComponents.mockResolvedValue([fakeComponent]);
    mockedScanCodebase.mockResolvedValue(fakeScanResult);
    mockedAnalyzeSourceEnhanced.mockResolvedValue({
      legacy: fakeLegacyResult,
      enhanced: [fakeEnhancedFile],
    });

    const result = await runScanPipeline('/test');

    expect(result.scanResult).toEqual(fakeScanResult);
    expect(result.components).toHaveLength(1);
    expect(result.components[0].name).toBe('test-project');
    expect(result.enhancedFiles).toHaveLength(1);
    expect(result.sourceResult).toEqual(fakeLegacyResult);
    expect(result.componentIndex.version).toBe(1);
    expect(result.componentIndex.components).toHaveLength(1);
    expect(result.symbolIndex.version).toBe(1);
    expect(result.symbolIndex.entries).toHaveLength(1);
    expect(result.entryPointIndex.version).toBe(1);
    expect(result.entryPointIndex.entryPoints).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it('throws if codebase scan fails', async () => {
    mockedDiscoverComponents.mockResolvedValue([]);
    mockedScanCodebase.mockRejectedValue(new Error('permission denied'));

    await expect(runScanPipeline('/test')).rejects.toThrow('Codebase scan failed: permission denied');
  });

  it('adds warning when component discovery fails but continues', async () => {
    mockedDiscoverComponents.mockRejectedValue(new Error('no manifests'));
    mockedScanCodebase.mockResolvedValue(fakeScanResult);
    mockedAnalyzeSourceEnhanced.mockResolvedValue({
      legacy: fakeLegacyResult,
      enhanced: [],
    });

    const result = await runScanPipeline('/test');

    expect(result.warnings).toContain('Component discovery failed: no manifests');
    expect(result.components).toHaveLength(0);
    expect(result.scanResult).toBeDefined();
  });

  it('adds warning when source analysis fails but continues', async () => {
    mockedDiscoverComponents.mockResolvedValue([]);
    mockedScanCodebase.mockResolvedValue(fakeScanResult);
    mockedAnalyzeSourceEnhanced.mockRejectedValue(new Error('parser error'));

    const result = await runScanPipeline('/test');

    expect(result.warnings).toContain('Source analysis failed: parser error');
    expect(result.enhancedFiles).toHaveLength(0);
    expect(result.sourceResult).toBeNull();
    // Indexes still get built (just empty)
    expect(result.symbolIndex.entries).toHaveLength(0);
  });

  it('builds indexes even without components', async () => {
    mockedDiscoverComponents.mockResolvedValue([]);
    mockedScanCodebase.mockResolvedValue(fakeScanResult);
    mockedAnalyzeSourceEnhanced.mockResolvedValue({
      legacy: fakeLegacyResult,
      enhanced: [fakeEnhancedFile],
    });

    const result = await runScanPipeline('/test');

    expect(result.componentIndex.components).toHaveLength(0);
    expect(result.symbolIndex.entries).toHaveLength(1);
    expect(result.symbolIndex.entries[0].componentId).toBe('root');
  });
});
