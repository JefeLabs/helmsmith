import { describe, expect, it } from 'vitest';
import {
  CatalogError,
  EXPRESSION_CASES,
  evalExpression,
  resolveExpressionValue,
  UNSUPPORTED_CASES,
  VALIDATION_CASES,
  validateFlowCatalog,
} from './index.ts';

describe('conformance fixtures', () => {
  it('ships at least 10 expression cases', () => {
    expect(EXPRESSION_CASES.length).toBeGreaterThanOrEqual(10);
  });

  it('fixtures are JSON-serializable (schema / Java consumers replay them from data)', () => {
    for (const set of [EXPRESSION_CASES, VALIDATION_CASES, UNSUPPORTED_CASES]) {
      expect(JSON.parse(JSON.stringify(set))).toEqual(set);
    }
  });

  for (const c of EXPRESSION_CASES) {
    it(`expression: ${c.name}`, () => {
      expect(evalExpression(c.expr, c.state)).toBe(c.expected);
      if (c.expectedValue !== undefined) {
        expect(resolveExpressionValue(c.expr, c.state)).toEqual(c.expectedValue);
      }
    });
  }

  for (const c of VALIDATION_CASES) {
    it(`validation: ${c.name}`, () => {
      if (c.valid) {
        expect(() => validateFlowCatalog(c.catalog, 'fixture')).not.toThrow();
      } else {
        expect(() => validateFlowCatalog(c.catalog, 'fixture')).toThrow(CatalogError);
        if (c.errorIncludes !== undefined) {
          expect(() => validateFlowCatalog(c.catalog, 'fixture')).toThrow(c.errorIncludes);
        }
      }
    });
  }

  for (const c of UNSUPPORTED_CASES) {
    it(`unsupported: ${c.name}`, () => {
      const reported: string[] = [];
      validateFlowCatalog({ flows: [c.flow] }, 'fixture', {
        onUnsupported: (f) => reported.push(f.feature),
      });
      expect([...reported].sort()).toEqual([...c.expectedFeatures].sort());
    });
  }
});
