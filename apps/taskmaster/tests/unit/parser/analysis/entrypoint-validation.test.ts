import { describe, expect, it } from 'vitest';
import {
  applyValidation,
  generateValidationWarnings,
  validateEntryPointCoverage,
} from '../../../../src/parser/analysis/entrypoint-validation.js';
import type {
  ComponentIndex,
  EntryPoint,
  EntryPointIndex,
  EntryPointTrace,
} from '../../../../src/parser/analysis/types.js';

function makeComponentIndex(ids: string[]): ComponentIndex {
  return {
    version: 1,
    repoRoot: '/test',
    generatedAt: '2026-01-01T00:00:00Z',
    components: ids.map((id) => ({
      id,
      name: id,
      rootPath: `/test/${id}`,
      languageSet: ['typescript'],
      entrypoints: [],
      entryPointIds: [],
      publicSurface: [],
      tags: [],
    })),
  };
}

function makeEntryPoint(id: string, componentId: string): EntryPoint {
  return {
    id,
    name: `EP ${id}`,
    category: 'http-api',
    componentId,
    filePath: 'src/routes.ts',
    metadata: {},
    detectedBy: 'static',
    confidence: 0.9,
    tags: [],
  };
}

function makeTrace(entryPointId: string, chain: string[]): EntryPointTrace {
  return {
    entryPointId,
    componentChain: chain,
    sideEffects: [],
    externalSystems: [],
    dataSourcesAccessed: [],
  };
}

function makeIndex(entryPoints: EntryPoint[], traces: EntryPointTrace[] = []): EntryPointIndex {
  return {
    version: 1,
    repoRoot: '/test',
    generatedAt: '2026-01-01T00:00:00Z',
    entryPoints,
    traces,
    validation: {
      orphanComponents: [],
      unreachableComponents: [],
      entryPointsWithoutTraces: [],
      coveragePercentage: 0,
    },
  };
}

describe('validateEntryPointCoverage', () => {
  it('calculates 100% coverage when all components have entry points', () => {
    const componentIndex = makeComponentIndex(['api', 'auth', 'db']);
    const epIndex = makeIndex([
      makeEntryPoint('ep:api:get', 'api'),
      makeEntryPoint('ep:auth:login', 'auth'),
      makeEntryPoint('ep:db:migrate', 'db'),
    ]);

    const result = validateEntryPointCoverage(epIndex, componentIndex);
    expect(result.coveragePercentage).toBe(100);
    expect(result.orphanComponents).toEqual([]);
  });

  it('identifies orphan components with zero entry points', () => {
    const componentIndex = makeComponentIndex(['api', 'auth', 'email-templates', 'legacy-utils']);
    const epIndex = makeIndex([
      makeEntryPoint('ep:api:get', 'api'),
      makeEntryPoint('ep:auth:login', 'auth'),
    ]);

    const result = validateEntryPointCoverage(epIndex, componentIndex);
    expect(result.orphanComponents).toContain('email-templates');
    expect(result.orphanComponents).toContain('legacy-utils');
    expect(result.orphanComponents).toHaveLength(2);
    expect(result.coveragePercentage).toBe(50);
  });

  it('components in traces are reachable even without owning entry points', () => {
    const componentIndex = makeComponentIndex(['api', 'auth', 'shared-lib']);
    const epIndex = makeIndex(
      [makeEntryPoint('ep:api:get', 'api')],
      [makeTrace('ep:api:get', ['api', 'auth', 'shared-lib'])],
    );

    const result = validateEntryPointCoverage(epIndex, componentIndex);
    expect(result.orphanComponents).toEqual([]);
    expect(result.coveragePercentage).toBe(100);
  });

  it('identifies entry points without traces', () => {
    const componentIndex = makeComponentIndex(['api', 'worker']);
    const epIndex = makeIndex(
      [makeEntryPoint('ep:api:get', 'api'), makeEntryPoint('ep:worker:process', 'worker')],
      [makeTrace('ep:api:get', ['api'])],
    );

    const result = validateEntryPointCoverage(epIndex, componentIndex);
    expect(result.entryPointsWithoutTraces).toContain('ep:worker:process');
    expect(result.entryPointsWithoutTraces).toHaveLength(1);
  });

  it('handles empty component index', () => {
    const componentIndex = makeComponentIndex([]);
    const epIndex = makeIndex([]);

    const result = validateEntryPointCoverage(epIndex, componentIndex);
    expect(result.coveragePercentage).toBe(0);
    expect(result.orphanComponents).toEqual([]);
  });

  it('handles entry points referencing unknown components', () => {
    const componentIndex = makeComponentIndex(['api']);
    const epIndex = makeIndex([
      makeEntryPoint('ep:api:get', 'api'),
      makeEntryPoint('ep:unknown:do', 'unknown-service'),
    ]);

    const result = validateEntryPointCoverage(epIndex, componentIndex);
    expect(result.coveragePercentage).toBe(100);
    // 'unknown-service' not in component index → not counted
    expect(result.orphanComponents).toEqual([]);
  });

  it('handles traces referencing unknown components gracefully', () => {
    const componentIndex = makeComponentIndex(['api']);
    const epIndex = makeIndex(
      [makeEntryPoint('ep:api:get', 'api')],
      [makeTrace('ep:api:get', ['api', 'external-system'])],
    );

    const result = validateEntryPointCoverage(epIndex, componentIndex);
    expect(result.coveragePercentage).toBe(100);
    expect(result.orphanComponents).toEqual([]);
  });

  it('correctly separates orphan from unreachable components', () => {
    const componentIndex = makeComponentIndex(['api', 'auth', 'util', 'dead-code']);
    const epIndex = makeIndex(
      [makeEntryPoint('ep:api:get', 'api')],
      [makeTrace('ep:api:get', ['api', 'auth'])],
    );

    const result = validateEntryPointCoverage(epIndex, componentIndex);
    // 'util' and 'dead-code' are not reached at all
    expect(result.orphanComponents).toContain('util');
    expect(result.orphanComponents).toContain('dead-code');
    expect(result.coveragePercentage).toBe(50);
  });
});

describe('applyValidation', () => {
  it('returns a new index with validation populated', () => {
    const componentIndex = makeComponentIndex(['api', 'orphan']);
    const epIndex = makeIndex([makeEntryPoint('ep:api:get', 'api')]);

    const result = applyValidation(epIndex, componentIndex);
    expect(result.validation.orphanComponents).toContain('orphan');
    expect(result.validation.coveragePercentage).toBe(50);
    // Original should be unchanged
    expect(epIndex.validation.orphanComponents).toEqual([]);
  });
});

describe('generateValidationWarnings', () => {
  it('generates orphan component warnings', () => {
    const warnings = generateValidationWarnings({
      orphanComponents: ['email-templates', 'legacy-utils'],
      unreachableComponents: [],
      entryPointsWithoutTraces: [],
      coveragePercentage: 80,
    });

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('email-templates');
    expect(warnings[0]).toContain('legacy-utils');
  });

  it('generates entry-points-without-traces warnings', () => {
    const warnings = generateValidationWarnings({
      orphanComponents: [],
      unreachableComponents: [],
      entryPointsWithoutTraces: ['ep:x:a', 'ep:x:b'],
      coveragePercentage: 100,
    });

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('without traces');
  });

  it('returns empty array when everything is fine', () => {
    const warnings = generateValidationWarnings({
      orphanComponents: [],
      unreachableComponents: [],
      entryPointsWithoutTraces: [],
      coveragePercentage: 100,
    });

    expect(warnings).toEqual([]);
  });
});
