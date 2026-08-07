/**
 * Expression semantics for the flow spec. Moved from harness-core's
 * flow-graph.ts and retyped against structural `unknown` state — the
 * evaluator only ever traverses state via dot-path lookup, so any
 * consumer (the LangGraph runtime's FlowStateT, a browser designer's
 * plain preview object) can pass its own shape.
 *
 * These functions ARE the spec for expression evaluation: a designer
 * previewing a conditional edge and the runtime router must agree, and
 * both call this code. Semantic fixtures live in `fixtures.ts`;
 * harness-core's flow-spec-conformance test replays them against its
 * re-exported evaluator.
 */
import type { CompareOp, Expression } from './types.ts';

/**
 * Predicate evaluator for conditional edge expressions.
 *
 *   - literal: value coerced to boolean (truthy check).
 *   - jsonpath: resolves `$.path.into.state`; truthy result counts as
 *     match. Minimal path syntax — `$.field` and `$.field.subfield`,
 *     including dot-numeric array indexing (`$.repos.0`, pinned by
 *     fixture). No bracket syntax / filters / wildcards.
 *   - compare: evaluates lhs and rhs to RAW values (via
 *     resolveExpressionValue) and applies op. ==/!= are strict
 *     (===/!==) — which for objects means REFERENCE equality; two
 *     structurally equal objects are never ==. Numeric ops
 *     (< <= > >=) coerce both sides via Number(); NaN on either
 *     side ⇒ false. `in` requires rhs to resolve to an array;
 *     membership is Array.includes — SameValueZero, so NaN
 *     self-matches (reachable only via runtime state; JSON cannot
 *     encode NaN).
 *   - all / any: short-circuit AND / OR over the expression list.
 *     Empty all([]) is true (identity for AND); empty any([]) is
 *     false (identity for OR).
 *   - not: inverts the inner predicate.
 *   - js: NOT supported. Throws with guidance to use compare /
 *     all / any / not instead. Catalog authors who hit a real wall
 *     should propose extending the language additively rather than
 *     reaching for a JS sandbox.
 */
export function evalExpression(expr: Expression, state: unknown): boolean {
  switch (expr.kind) {
    case 'literal':
      return Boolean(expr.value);
    case 'jsonpath':
      return Boolean(resolveJsonPath(expr.path, state));
    case 'compare':
      return evalCompare(expr.lhs, expr.op, expr.rhs, state);
    case 'all':
      // Short-circuit AND. Empty list ⇒ true (vacuous truth: AND of
      // no clauses holds).
      for (const sub of expr.exprs) {
        if (!evalExpression(sub, state)) return false;
      }
      return true;
    case 'any':
      // Short-circuit OR. Empty list ⇒ false (no clause is satisfied).
      for (const sub of expr.exprs) {
        if (evalExpression(sub, state)) return true;
      }
      return false;
    case 'not':
      return !evalExpression(expr.expr, state);
    case 'js':
      throw new Error(
        '"js" expression kind is not yet supported — use compare / all / any / not / jsonpath / literal',
      );
  }
}

/**
 * Apply a compare op to two evaluated values. Pulled out so both
 * evalExpression and resolveExpressionValue can share the logic
 * without re-evaluating the subexpressions.
 */
function evalCompare(lhs: Expression, op: CompareOp, rhs: Expression, state: unknown): boolean {
  const lhsValue = resolveExpressionValue(lhs, state);
  const rhsValue = resolveExpressionValue(rhs, state);
  switch (op) {
    case '==':
      return lhsValue === rhsValue;
    case '!=':
      return lhsValue !== rhsValue;
    case '<':
    case '<=':
    case '>':
    case '>=': {
      const a = Number(lhsValue);
      const b = Number(rhsValue);
      // NaN on either side ⇒ comparison is false. Avoids the
      // surprising "NaN < 5" === false but "NaN >= 5" === false too;
      // catalog authors who really want number-or-bust should pre-
      // gate with a `compare lhs == null` check.
      if (Number.isNaN(a) || Number.isNaN(b)) return false;
      if (op === '<') return a < b;
      if (op === '<=') return a <= b;
      if (op === '>') return a > b;
      return a >= b; // '>='
    }
    case 'in':
      // rhs MUST resolve to an array. Anything else (string,
      // object, primitive) returns false. This keeps the op
      // specifically about collection membership; catalog authors
      // who want substring containment should compose with a
      // tool/transform step. Note: includes() is SameValueZero, not
      // strict equality — NaN self-matches (runtime-state-only case).
      return Array.isArray(rhsValue) && rhsValue.includes(lhsValue);
  }
}

/** Minimal dot-path resolver: `$` returns the whole state; `$.a.b`
 *  walks object properties. Arrays index via dot-numeric segments
 *  (`$.repos.0` — JS string-indexing; pinned by fixture). Non-object
 *  intermediates and out-of-bounds indexes resolve to undefined
 *  rather than throwing. */
export function resolveJsonPath(path: string, state: unknown): unknown {
  if (path === '$') return state;
  if (!path.startsWith('$.')) return undefined;
  const parts = path.slice(2).split('.');
  let cur: unknown = state;
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

/**
 * Resolve an Expression to its raw value (used for Loop iteration and
 * inside `compare` for lhs/rhs). Like evalExpression but returns the
 * raw value, not a boolean coercion. The boolean composition kinds
 * (compare / all / any / not) collapse to their boolean result here
 * — catalog authors using them as raw values get a `true` / `false`,
 * which matches the conditional-edge semantic and avoids surprising
 * polymorphism.
 *
 *   - literal → expr.value
 *   - jsonpath → resolved value or undefined
 *   - compare / all / any / not → the boolean result of evalExpression
 *   - js → throws (no sandbox; same as evalExpression)
 */
export function resolveExpressionValue(expr: Expression, state: unknown): unknown {
  switch (expr.kind) {
    case 'literal':
      return expr.value;
    case 'jsonpath':
      return resolveJsonPath(expr.path, state);
    case 'compare':
    case 'all':
    case 'any':
    case 'not':
      return evalExpression(expr, state);
    case 'js':
      throw new Error('"js" expression kind is not yet supported');
  }
}
