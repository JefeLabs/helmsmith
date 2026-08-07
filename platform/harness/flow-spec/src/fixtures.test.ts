import { describe, expect, it } from 'vitest';
import { EXPRESSION_CASES, evalExpression } from './index.ts';

describe('conformance fixtures', () => {
  it('ships at least 10 expression cases', () => {
    expect(EXPRESSION_CASES.length).toBeGreaterThanOrEqual(10);
  });

  it('fixtures are JSON-serializable (schema / Java consumers replay them from data)', () => {
    expect(JSON.parse(JSON.stringify(EXPRESSION_CASES))).toEqual(EXPRESSION_CASES);
  });

  for (const c of EXPRESSION_CASES) {
    it(`expression: ${c.name}`, () => {
      expect(evalExpression(c.expr, c.state)).toBe(c.expected);
    });
  }
});
