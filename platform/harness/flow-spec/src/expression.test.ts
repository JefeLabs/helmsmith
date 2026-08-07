import { describe, expect, it } from 'vitest';
import { evalExpression, resolveExpressionValue } from './index.ts';

describe('evalExpression', () => {
  const state = { output: 'hello', review: { score: 0.9 }, repos: ['a', 'b'] };

  it('jsonpath resolves dot paths against arbitrary state', () => {
    expect(evalExpression({ kind: 'jsonpath', path: '$.review.score' }, state)).toBe(true);
    expect(evalExpression({ kind: 'jsonpath', path: '$.missing.deep' }, state)).toBe(false);
  });

  it('compare: NaN on either side of a numeric op is false', () => {
    expect(
      evalExpression(
        {
          kind: 'compare',
          lhs: { kind: 'literal', value: 'x' },
          op: '<',
          rhs: { kind: 'literal', value: 5 },
        },
        state,
      ),
    ).toBe(false);
  });

  it('in requires an array rhs', () => {
    expect(
      evalExpression(
        {
          kind: 'compare',
          lhs: { kind: 'literal', value: 'a' },
          op: 'in',
          rhs: { kind: 'jsonpath', path: '$.repos' },
        },
        state,
      ),
    ).toBe(true);
    expect(
      evalExpression(
        {
          kind: 'compare',
          lhs: { kind: 'literal', value: 'ell' },
          op: 'in',
          rhs: { kind: 'jsonpath', path: '$.output' },
        },
        state,
      ),
    ).toBe(false);
  });

  it('vacuous identities: all([]) true, any([]) false', () => {
    expect(evalExpression({ kind: 'all', exprs: [] }, state)).toBe(true);
    expect(evalExpression({ kind: 'any', exprs: [] }, state)).toBe(false);
  });

  it('js throws', () => {
    expect(() => evalExpression({ kind: 'js', expression: '1' }, state)).toThrow(
      /not yet supported/,
    );
  });

  it('resolveExpressionValue returns raw values, booleans for compositions', () => {
    expect(resolveExpressionValue({ kind: 'jsonpath', path: '$.review.score' }, state)).toBe(0.9);
    expect(
      resolveExpressionValue({ kind: 'not', expr: { kind: 'literal', value: false } }, state),
    ).toBe(true);
  });

  // Lives here rather than in fixtures.ts because NaN is not
  // JSON-serializable and the fixture set must stay replayable by
  // schema/Java consumers. Only reachable via runtime state anyway —
  // JSON catalogs cannot encode NaN.
  it('in uses SameValueZero (Array.includes): NaN from state self-matches', () => {
    expect(
      evalExpression(
        {
          kind: 'compare',
          lhs: { kind: 'jsonpath', path: '$.x' },
          op: 'in',
          rhs: { kind: 'jsonpath', path: '$.arr' },
        },
        { x: Number.NaN, arr: [Number.NaN] },
      ),
    ).toBe(true);
  });
});
