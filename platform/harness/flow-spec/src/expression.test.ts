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

describe('object / array constructors', () => {
  it('object resolves each field against state', () => {
    expect(
      resolveExpressionValue(
        {
          kind: 'object',
          fields: {
            item: { kind: 'jsonpath', path: '$.repos.0' },
            max: { kind: 'literal', value: 3 },
          },
        },
        { repos: ['api'] },
      ),
    ).toEqual({ item: 'api', max: 3 });
  });

  it('array resolves each item against state', () => {
    expect(
      resolveExpressionValue(
        {
          kind: 'array',
          items: [{ kind: 'jsonpath', path: '$.a' }, { kind: 'literal', value: 2 }],
        },
        { a: 1 },
      ),
    ).toEqual([1, 2]);
  });

  it('constructors are truthy as predicates', () => {
    expect(evalExpression({ kind: 'object', fields: {} }, {})).toBe(true);
    expect(evalExpression({ kind: 'array', items: [] }, {})).toBe(true);
  });
});

describe('string compare ops', () => {
  it('matches with an invalid pattern from state is false, never throws', () => {
    expect(
      evalExpression(
        {
          kind: 'compare',
          lhs: { kind: 'literal', value: 'abc' },
          op: 'matches',
          rhs: { kind: 'jsonpath', path: '$.pat' },
        },
        { pat: '(' },
      ),
    ).toBe(false);
  });
});
