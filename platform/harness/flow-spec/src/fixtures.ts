/**
 * Conformance fixtures — executable spec data.
 *
 * Each case is plain data (no functions) so any consumer can replay
 * them: flow-spec's own tests, harness-core's conformance suite (which
 * proves the runtime's re-exported evaluator matches the spec), a
 * future designer UI's preview tests, or a future Java-side validator.
 *
 * When expression semantics change, change the fixture here FIRST —
 * every conforming implementation then fails until it catches up.
 */
import type { Expression } from './types.ts';

export interface ExpressionCase {
  name: string;
  expr: Expression;
  state: unknown;
  expected: boolean;
}

const STATE = {
  output: 'hello',
  review: { score: 0.9, approved: true },
  repos: ['api', 'web'],
  count: '10',
};

export const EXPRESSION_CASES: readonly ExpressionCase[] = [
  {
    name: 'literal truthy value passes',
    expr: { kind: 'literal', value: 'yes' },
    state: STATE,
    expected: true,
  },
  {
    name: 'literal falsy value fails',
    expr: { kind: 'literal', value: 0 },
    state: STATE,
    expected: false,
  },
  {
    name: 'jsonpath dot-path hit is truthy',
    expr: { kind: 'jsonpath', path: '$.review.score' },
    state: STATE,
    expected: true,
  },
  {
    name: 'jsonpath miss through non-object is falsy, never throws',
    expr: { kind: 'jsonpath', path: '$.output.deep.deeper' },
    state: STATE,
    expected: false,
  },
  {
    name: 'jsonpath root $ returns whole state (truthy for objects)',
    expr: { kind: 'jsonpath', path: '$' },
    state: STATE,
    expected: true,
  },
  {
    name: 'compare == is strict: string "5" never equals number 5',
    expr: {
      kind: 'compare',
      lhs: { kind: 'literal', value: '5' },
      op: '==',
      rhs: { kind: 'literal', value: 5 },
    },
    state: STATE,
    expected: false,
  },
  {
    name: 'compare > coerces numeric strings via Number()',
    expr: {
      kind: 'compare',
      lhs: { kind: 'jsonpath', path: '$.count' },
      op: '>',
      rhs: { kind: 'literal', value: 5 },
    },
    state: STATE,
    expected: true,
  },
  {
    name: 'compare numeric op with NaN on either side is false',
    expr: {
      kind: 'compare',
      lhs: { kind: 'literal', value: 'not-a-number' },
      op: '>=',
      rhs: { kind: 'literal', value: 0 },
    },
    state: STATE,
    expected: false,
  },
  {
    name: 'in matches array membership by strict equality',
    expr: {
      kind: 'compare',
      lhs: { kind: 'literal', value: 'api' },
      op: 'in',
      rhs: { kind: 'jsonpath', path: '$.repos' },
    },
    state: STATE,
    expected: true,
  },
  {
    name: 'in with non-array rhs is false (no substring semantics)',
    expr: {
      kind: 'compare',
      lhs: { kind: 'literal', value: 'ell' },
      op: 'in',
      rhs: { kind: 'jsonpath', path: '$.output' },
    },
    state: STATE,
    expected: false,
  },
  {
    name: 'all([]) is vacuously true',
    expr: { kind: 'all', exprs: [] },
    state: STATE,
    expected: true,
  },
  {
    name: 'any([]) is vacuously false',
    expr: { kind: 'any', exprs: [] },
    state: STATE,
    expected: false,
  },
  {
    name: 'not inverts the inner predicate',
    expr: { kind: 'not', expr: { kind: 'jsonpath', path: '$.missing' } },
    state: STATE,
    expected: true,
  },
  {
    name: 'nested composition: all(compare, not(any(...)))',
    expr: {
      kind: 'all',
      exprs: [
        {
          kind: 'compare',
          lhs: { kind: 'jsonpath', path: '$.review.approved' },
          op: '==',
          rhs: { kind: 'literal', value: true },
        },
        {
          kind: 'not',
          expr: {
            kind: 'any',
            exprs: [{ kind: 'jsonpath', path: '$.cancelRequested' }],
          },
        },
      ],
    },
    state: STATE,
    expected: true,
  },
];
