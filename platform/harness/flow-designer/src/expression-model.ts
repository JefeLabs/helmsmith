/**
 * Pure semantics behind the visual expression builder: blank defaults
 * per kind, and non-destructive kind switching (`converted`) so
 * flipping the kind select never throws away work the author can keep
 * — wrap into not/exists, unwrap back out, all↔any keep their clauses,
 * compare adopts the current expression as lhs. Kept free of React so
 * the rules are unit-testable; ExpressionField renders them.
 */
import type { CompareOp, Expression } from '@helmsmith/flow-spec';

export type ExpressionKind = Expression['kind'];

/** Select order: leaves first, then comparison/boolean composition,
 *  then constructors; `js` last (evaluator throws — declared intent). */
export const EXPRESSION_KINDS: readonly ExpressionKind[] = [
  'jsonpath',
  'literal',
  'compare',
  'exists',
  'not',
  'all',
  'any',
  'object',
  'array',
  'js',
];

export const COMPARE_OPS: readonly CompareOp[] = [
  '==',
  '!=',
  '<',
  '<=',
  '>',
  '>=',
  'in',
  'contains',
  'startsWith',
  'endsWith',
  'matches',
];

/** A valid blank for each kind. Empty all/any/object/array are valid
 *  per the validator (identity elements / placeholders). */
export function defaultExpression(kind: ExpressionKind): Expression {
  switch (kind) {
    case 'jsonpath':
      return { kind, path: '$.output' };
    case 'literal':
      return { kind, value: true };
    case 'js':
      return { kind, expression: 'true' };
    case 'compare':
      return {
        kind,
        lhs: { kind: 'jsonpath', path: '$.output' },
        op: '==',
        rhs: { kind: 'literal', value: true },
      };
    case 'all':
    case 'any':
      return { kind, exprs: [] };
    case 'not':
    case 'exists':
      return { kind, expr: { kind: 'jsonpath', path: '$.output' } };
    case 'object':
      return { kind, fields: {} };
    case 'array':
      return { kind, items: [] };
  }
}

/** Switch an expression to another kind, preserving whatever the
 *  target can carry. Falls back to the kind default. */
export function converted(expr: Expression, kind: ExpressionKind): Expression {
  if (expr.kind === kind) return expr;
  // Wrapper↔wrapper swaps keep the inner; wrapping keeps the current.
  if (kind === 'not' || kind === 'exists') {
    const inner = expr.kind === 'not' || expr.kind === 'exists' ? expr.expr : expr;
    return { kind, expr: inner };
  }
  // Leaving a wrapper: convert what it wrapped.
  if (expr.kind === 'not' || expr.kind === 'exists') return converted(expr.expr, kind);
  if (kind === 'all' || kind === 'any') {
    return { kind, exprs: expr.kind === 'all' || expr.kind === 'any' ? expr.exprs : [expr] };
  }
  if (kind === 'array') return { kind, items: [expr] };
  if (kind === 'object') return { kind, fields: { value: expr } };
  if (kind === 'compare') {
    return { kind, lhs: expr, op: '==', rhs: { kind: 'literal', value: true } };
  }
  if (expr.kind === 'compare' && expr.lhs.kind === kind) return expr.lhs;
  return defaultExpression(kind);
}
