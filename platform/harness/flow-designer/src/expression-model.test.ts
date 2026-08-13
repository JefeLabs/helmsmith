import type { Expression } from '@helmsmith/flow-spec';
import { describe, expect, it } from 'vitest';
import { converted, defaultExpression, EXPRESSION_KINDS } from './expression-model.ts';

const jp = (path: string): Expression => ({ kind: 'jsonpath', path });

describe('defaultExpression', () => {
  it('produces a valid blank for every kind in the union', () => {
    expect(EXPRESSION_KINDS).toHaveLength(10);
    for (const kind of EXPRESSION_KINDS) {
      expect(defaultExpression(kind).kind).toBe(kind);
    }
    expect(defaultExpression('compare')).toEqual({
      kind: 'compare',
      lhs: { kind: 'jsonpath', path: '$.output' },
      op: '==',
      rhs: { kind: 'literal', value: true },
    });
  });
});

describe('converted — non-destructive kind switching', () => {
  it('same kind is identity', () => {
    const e = jp('$.a');
    expect(converted(e, 'jsonpath')).toBe(e);
  });

  it('wraps the current expression when switching to not/exists', () => {
    expect(converted(jp('$.a'), 'not')).toEqual({ kind: 'not', expr: jp('$.a') });
    expect(converted(jp('$.a'), 'exists')).toEqual({ kind: 'exists', expr: jp('$.a') });
  });

  it('swaps wrapper kinds without double-wrapping', () => {
    expect(converted({ kind: 'not', expr: jp('$.a') }, 'exists')).toEqual({
      kind: 'exists',
      expr: jp('$.a'),
    });
  });

  it('unwraps when switching a wrapper to its inner kind', () => {
    expect(converted({ kind: 'not', expr: jp('$.a') }, 'jsonpath')).toEqual(jp('$.a'));
  });

  it('all↔any preserves the clause list', () => {
    const exprs = [jp('$.a'), jp('$.b')];
    expect(converted({ kind: 'all', exprs }, 'any')).toEqual({ kind: 'any', exprs });
  });

  it('switching to a combinator wraps the current expression as the first clause', () => {
    expect(converted(jp('$.a'), 'all')).toEqual({ kind: 'all', exprs: [jp('$.a')] });
    expect(converted(jp('$.a'), 'array')).toEqual({ kind: 'array', items: [jp('$.a')] });
    expect(converted(jp('$.a'), 'object')).toEqual({
      kind: 'object',
      fields: { value: jp('$.a') },
    });
  });

  it('switching to compare keeps the current expression as lhs', () => {
    expect(converted(jp('$.score'), 'compare')).toEqual({
      kind: 'compare',
      lhs: jp('$.score'),
      op: '==',
      rhs: { kind: 'literal', value: true },
    });
  });

  it('switching a compare to jsonpath recovers a jsonpath lhs', () => {
    const cmp: Expression = {
      kind: 'compare',
      lhs: jp('$.score'),
      op: '>',
      rhs: { kind: 'literal', value: 0.8 },
    };
    expect(converted(cmp, 'jsonpath')).toEqual(jp('$.score'));
  });

  it('falls back to the kind default when nothing is preservable', () => {
    expect(converted({ kind: 'literal', value: 42 }, 'js')).toEqual(defaultExpression('js'));
  });
});
