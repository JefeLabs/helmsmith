import { describe, expect, it } from 'vitest';
import { EXPRESSION_CASES, evalExpression } from './index.ts';

describe('conformance fixtures', () => {
  it('ships at least 10 expression cases', () => {
    expect(EXPRESSION_CASES.length).toBeGreaterThanOrEqual(10);
  });

  for (const c of EXPRESSION_CASES) {
    it(`expression: ${c.name}`, () => {
      expect(evalExpression(c.expr, c.state)).toBe(c.expected);
    });
  }
});
