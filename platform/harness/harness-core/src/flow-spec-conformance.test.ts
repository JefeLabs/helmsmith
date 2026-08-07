import { EXPRESSION_CASES } from '@helmsmith/flow-spec';
import { describe, expect, it } from 'vitest';
import { evalExpression } from './flow-graph.ts';

// The runtime must implement spec expression semantics exactly — the
// fixture set is the contract a designer UI previews against.
describe('runtime conforms to flow-spec expression fixtures', () => {
  for (const c of EXPRESSION_CASES) {
    it(c.name, () => {
      expect(evalExpression(c.expr, c.state as never)).toBe(c.expected);
    });
  }
});
