import {
  EXPRESSION_CASES,
  resolveExpressionValue,
  UNSUPPORTED_CASES,
  VALIDATION_CASES,
} from '@helmsmith/flow-spec';
import { describe, expect, it } from 'vitest';
import { CatalogError, validateFlowCatalog } from './catalog.ts';
import { evalExpression } from './flow-graph.ts';

// The runtime must implement spec semantics exactly — these fixture
// sets are the contract a designer UI or Java-side validator previews
// against. All three behaviors replay: expressions (predicate + value
// semantics via expectedValue), validation verdicts, and unsupported-
// feature reports (EXACT set match — a stale report after implementing
// a feature, or a missing report on new dead config, fails here until
// the fixture is updated FIRST).
describe('runtime conforms to flow-spec expression fixtures', () => {
  for (const c of EXPRESSION_CASES) {
    it(c.name, () => {
      expect(evalExpression(c.expr, c.state as never)).toBe(c.expected);
      if (c.expectedValue !== undefined) {
        expect(resolveExpressionValue(c.expr, c.state)).toEqual(c.expectedValue);
      }
    });
  }
});

describe('runtime conforms to flow-spec validation fixtures', () => {
  for (const c of VALIDATION_CASES) {
    it(c.name, () => {
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
});

describe('runtime conforms to flow-spec unsupported-feature fixtures', () => {
  for (const c of UNSUPPORTED_CASES) {
    it(c.name, () => {
      const reported: string[] = [];
      validateFlowCatalog({ flows: [c.flow] }, 'fixture', {
        onUnsupported: (f) => reported.push(f.feature),
      });
      expect([...reported].sort()).toEqual([...c.expectedFeatures].sort());
    });
  }
});
