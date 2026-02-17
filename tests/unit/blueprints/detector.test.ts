import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ApplicationBlueprint } from '../../../src/blueprints/types.js';
import type { CodebaseScanResult, BuildComponent } from '../../../src/parser/analysis/types.js';

// Mock the registry to provide controlled test data
vi.mock('../../../src/blueprints/registry.js', () => {
  const fakeBlueprints: Record<string, ApplicationBlueprint> = {
    'fake-api': {
      id: 'fake-api',
      name: 'Fake API',
      description: 'A fake API blueprint for testing',
      appType: 'service',
      contextQuestions: [],
      concerns: [],
      conditionalRules: [],
      nonNegotiableBundle: ['placeholder'],
      detectionHints: {
        patterns: ['REST-server', 'http-server'],
        frameworks: ['framework:express', 'framework:fastify'],
        capabilities: ['REST-server'],
        fileIndicators: ['routes/', 'controllers/'],
        weight: 0.8,
      },
    },
    'fake-cli': {
      id: 'fake-cli',
      name: 'Fake CLI',
      description: 'A fake CLI blueprint for testing',
      appType: 'tool',
      contextQuestions: [],
      concerns: [],
      conditionalRules: [],
      nonNegotiableBundle: ['placeholder'],
      detectionHints: {
        patterns: ['CLI-app'],
        frameworks: ['framework:commander', 'framework:yargs'],
        capabilities: ['CLI-app'],
        fileIndicators: ['bin/', 'commands/'],
        weight: 0.6,
      },
    },
    'fake-empty': {
      id: 'fake-empty',
      name: 'Fake Empty',
      description: 'A blueprint with no detection hints',
      appType: 'other',
      contextQuestions: [],
      concerns: [],
      conditionalRules: [],
      nonNegotiableBundle: ['placeholder'],
      detectionHints: {
        patterns: [],
        frameworks: [],
        capabilities: [],
        fileIndicators: [],
        weight: 0.5,
      },
    },
  };

  return {
    BLUEPRINTS: fakeBlueprints,
    getBlueprint: (id: string) => fakeBlueprints[id],
    listBlueprints: () =>
      Object.values(fakeBlueprints).map((bp) => ({
        id: bp.id,
        name: bp.name,
        appType: bp.appType,
        concernCount: bp.concerns.length,
        nonNegotiableCount: bp.nonNegotiableBundle.length,
      })),
    getBlueprintsByAppType: (appType: string) =>
      Object.values(fakeBlueprints).filter((bp) => bp.appType === appType),
    BLUEPRINT_IDS: Object.keys(fakeBlueprints),
  };
});

// Import after mock setup
import { detectBlueprints } from '../../../src/blueprints/detector.js';

function makeScanResult(overrides: Partial<CodebaseScanResult> = {}): CodebaseScanResult {
  return {
    rootPath: '/tmp/project',
    directoryTree: '',
    fileExtensions: {},
    manifestContents: {},
    detectedPatterns: [],
    capabilities: [],
    totalFiles: 0,
    totalDirectories: 0,
    ...overrides,
  };
}

function makeComponent(overrides: Partial<BuildComponent> & { id: string }): BuildComponent {
  return {
    name: overrides.id,
    rootPath: '/tmp/project',
    languageSet: ['typescript'],
    entrypoints: [],
    publicSurface: [],
    tags: [],
    ...overrides,
  };
}

describe('detectBlueprints', () => {
  it('returns empty array for scan with no matches', () => {
    const scan = makeScanResult();
    const components: BuildComponent[] = [];
    const results = detectBlueprints(scan, components);
    expect(results).toEqual([]);
  });

  it('matches blueprint by detected patterns', () => {
    const scan = makeScanResult({
      detectedPatterns: ['REST-server'],
    });
    const results = detectBlueprints(scan, []);
    expect(results.length).toBeGreaterThanOrEqual(1);
    const apiMatch = results.find((r) => r.blueprintId === 'fake-api');
    expect(apiMatch).toBeDefined();
    expect(apiMatch!.matchedSignals).toContain('REST-server');
  });

  it('matches by component framework tags', () => {
    const scan = makeScanResult();
    const components = [
      makeComponent({ id: 'server', tags: ['framework:express'] }),
    ];
    const results = detectBlueprints(scan, components);
    const apiMatch = results.find((r) => r.blueprintId === 'fake-api');
    expect(apiMatch).toBeDefined();
    expect(apiMatch!.matchedSignals).toContain('framework:express');
  });

  it('matches by file indicators in directory tree', () => {
    const scan = makeScanResult({
      directoryTree: 'src/\n  routes/\n  middleware/\n  controllers/',
    });
    const results = detectBlueprints(scan, []);
    const apiMatch = results.find((r) => r.blueprintId === 'fake-api');
    expect(apiMatch).toBeDefined();
    expect(apiMatch!.matchedSignals).toContain('routes/');
    expect(apiMatch!.matchedSignals).toContain('controllers/');
  });

  it('results sorted by confidence descending', () => {
    // Provide signals that match both fake-api and fake-cli but with more matches for fake-api
    const scan = makeScanResult({
      detectedPatterns: ['REST-server', 'http-server', 'CLI-app'],
      capabilities: ['REST-server', 'CLI-app'],
      directoryTree: 'routes/\ncontrollers/\nbin/',
    });
    const components = [
      makeComponent({ id: 'server', tags: ['framework:express', 'framework:commander'] }),
    ];
    const results = detectBlueprints(scan, components);
    expect(results.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < results.length; i++) {
      expect(results[i].confidence).toBeLessThanOrEqual(results[i - 1].confidence);
    }
  });

  it('confidence is calculated as (matched/total) * weight', () => {
    // fake-api has: 2 patterns, 2 frameworks, 1 capability, 2 fileIndicators = 7 total hints
    // Provide 1 pattern match out of 7 total possible with weight 0.8
    const scan = makeScanResult({
      detectedPatterns: ['REST-server'],
    });
    const results = detectBlueprints(scan, []);
    const apiMatch = results.find((r) => r.blueprintId === 'fake-api');
    expect(apiMatch).toBeDefined();
    // matched = 1, total = 7 (2 patterns + 2 frameworks + 1 capability + 2 fileIndicators), weight = 0.8
    // confidence = (1/7) * 0.8 = 0.1142... rounded to 0.11
    const expected = Math.round((1 / 7) * 0.8 * 100) / 100;
    expect(apiMatch!.confidence).toBe(expected);
  });

  it('multiple blueprints can match with different confidences', () => {
    const scan = makeScanResult({
      detectedPatterns: ['REST-server', 'CLI-app'],
      capabilities: ['REST-server', 'CLI-app'],
    });
    const results = detectBlueprints(scan, []);
    const apiMatch = results.find((r) => r.blueprintId === 'fake-api');
    const cliMatch = results.find((r) => r.blueprintId === 'fake-cli');
    expect(apiMatch).toBeDefined();
    expect(cliMatch).toBeDefined();
    // They should have different confidences due to different weights and match ratios
    expect(apiMatch!.confidence).not.toBe(cliMatch!.confidence);
  });

  it('does not include blueprints with zero matches', () => {
    const scan = makeScanResult({
      detectedPatterns: ['REST-server'],
    });
    const results = detectBlueprints(scan, []);
    const emptyMatch = results.find((r) => r.blueprintId === 'fake-empty');
    expect(emptyMatch).toBeUndefined();
  });
});
