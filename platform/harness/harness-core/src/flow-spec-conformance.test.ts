import { EXPRESSION_CASES, resolveExpressionValue } from '@helmsmith/flow-spec';
import { describe, expect, it } from 'vitest';
import { evalExpression } from './flow-graph.ts';

// The runtime must implement spec expression semantics exactly — the
// fixture set is the contract a designer UI previews against. Cases
// carrying `expectedValue` additionally pin value semantics
// (constructors, raw lookups), not just the predicate coercion.
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
