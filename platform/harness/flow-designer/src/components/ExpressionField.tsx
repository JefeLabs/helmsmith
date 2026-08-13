import type { Assertion, CompareOp, Expression } from '@helmsmith/flow-spec';
import { useState } from 'react';
import {
  COMPARE_OPS,
  converted,
  defaultExpression,
  EXPRESSION_KINDS,
  type ExpressionKind,
} from '../expression-model.ts';
import { JsonField } from './JsonField.tsx';

/**
 * Visual builder for the Expression union — a recursive tree of
 * kind-selects and per-kind fields, with a `{}` toggle back to the raw
 * JSON editor per field. The builder can only construct shapes the
 * validator accepts (modulo emptied strings, which live validation
 * catches), and kind switches go through `converted` so work is
 * preserved rather than reset.
 */

/** Literals display as JSON (strings quoted) and parse leniently:
 *  valid JSON wins, anything else becomes a string. */
function literalText(value: unknown): string {
  return value === undefined ? '' : JSON.stringify(value);
}
function parsedLiteral(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Blur-commit input: uncontrolled while typing, remounts (via key) when
 *  the canonical value changes externally (undo, kind switch). */
export function CommitInput({
  value,
  onCommit,
  className,
  placeholder,
}: {
  value: string;
  onCommit: (text: string) => void;
  className?: string;
  placeholder?: string;
}) {
  return (
    <input
      key={value}
      className={className ?? 'input expr-mini'}
      defaultValue={value}
      placeholder={placeholder}
      spellCheck={false}
      onBlur={(e) => {
        if (e.target.value !== value) onCommit(e.target.value);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

function uniqueFieldName(existing: Readonly<Record<string, Expression>>): string {
  let n = 1;
  while (`f${n}` in existing) n += 1;
  return `f${n}`;
}

export function ExprNode({
  expr,
  onChange,
}: {
  expr: Expression;
  onChange: (next: Expression) => void;
}) {
  const kindSelect = (
    <select
      className="select expr-kind"
      value={expr.kind}
      onChange={(e) => onChange(converted(expr, e.target.value as ExpressionKind))}
    >
      {EXPRESSION_KINDS.map((k) => (
        <option key={k} value={k}>
          {k}
        </option>
      ))}
    </select>
  );

  switch (expr.kind) {
    case 'jsonpath':
      return (
        <div className="expr-row">
          {kindSelect}
          <CommitInput
            value={expr.path}
            placeholder="$.output"
            onCommit={(path) => onChange({ ...expr, path })}
          />
        </div>
      );
    case 'literal':
      return (
        <div className="expr-row">
          {kindSelect}
          <CommitInput
            value={literalText(expr.value)}
            placeholder='true · 0.8 · "text"'
            onCommit={(text) => onChange({ ...expr, value: parsedLiteral(text) })}
          />
        </div>
      );
    case 'js':
      return (
        <div className="expr-row" title="evaluator throws on js — declared intent only">
          {kindSelect}
          <CommitInput
            value={expr.expression}
            onCommit={(expression) => onChange({ ...expr, expression })}
          />
          <span className="expr-warn">⚠</span>
        </div>
      );
    case 'compare':
      return (
        <div>
          <div className="expr-row">
            {kindSelect}
            <select
              className="select expr-op"
              value={expr.op}
              onChange={(e) => onChange({ ...expr, op: e.target.value as CompareOp })}
            >
              {COMPARE_OPS.map((op) => (
                <option key={op} value={op}>
                  {op}
                </option>
              ))}
            </select>
          </div>
          <div className="expr-children">
            <span className="expr-tag">lhs</span>
            <ExprNode expr={expr.lhs} onChange={(lhs) => onChange({ ...expr, lhs })} />
            <span className="expr-tag">rhs</span>
            <ExprNode expr={expr.rhs} onChange={(rhs) => onChange({ ...expr, rhs })} />
          </div>
        </div>
      );
    case 'not':
    case 'exists':
      return (
        <div>
          <div className="expr-row">{kindSelect}</div>
          <div className="expr-children">
            <ExprNode expr={expr.expr} onChange={(inner) => onChange({ ...expr, expr: inner })} />
          </div>
        </div>
      );
    case 'all':
    case 'any':
      return (
        <div>
          <div className="expr-row">{kindSelect}</div>
          <div className="expr-children">
            {expr.exprs.map((sub, i) => (
              // Index is the identity of a clause slot.
              // biome-ignore lint/suspicious/noArrayIndexKey: positional edit
              <div className="expr-item" key={i}>
                <ExprNode
                  expr={sub}
                  onChange={(next) =>
                    onChange({ ...expr, exprs: expr.exprs.map((s, j) => (j === i ? next : s)) })
                  }
                />
                <button
                  type="button"
                  className="btn tiny"
                  title="remove clause"
                  onClick={() => onChange({ ...expr, exprs: expr.exprs.filter((_, j) => j !== i) })}
                >
                  ×
                </button>
              </div>
            ))}
            <button
              type="button"
              className="btn tiny"
              onClick={() =>
                onChange({ ...expr, exprs: [...expr.exprs, defaultExpression('jsonpath')] })
              }
            >
              + clause
            </button>
          </div>
        </div>
      );
    case 'array':
      return (
        <div>
          <div className="expr-row">{kindSelect}</div>
          <div className="expr-children">
            {expr.items.map((sub, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: positional edit
              <div className="expr-item" key={i}>
                <ExprNode
                  expr={sub}
                  onChange={(next) =>
                    onChange({ ...expr, items: expr.items.map((s, j) => (j === i ? next : s)) })
                  }
                />
                <button
                  type="button"
                  className="btn tiny"
                  title="remove item"
                  onClick={() => onChange({ ...expr, items: expr.items.filter((_, j) => j !== i) })}
                >
                  ×
                </button>
              </div>
            ))}
            <button
              type="button"
              className="btn tiny"
              onClick={() =>
                onChange({ ...expr, items: [...expr.items, defaultExpression('jsonpath')] })
              }
            >
              + item
            </button>
          </div>
        </div>
      );
    case 'object': {
      const entries = Object.entries(expr.fields);
      const withEntries = (next: Array<[string, Expression]>) =>
        onChange({ ...expr, fields: Object.fromEntries(next) });
      return (
        <div>
          <div className="expr-row">{kindSelect}</div>
          <div className="expr-children">
            {entries.map(([name, sub], i) => (
              <div className="expr-item" key={name}>
                <div className="expr-fieldname">
                  <CommitInput
                    value={name}
                    className="input expr-name"
                    onCommit={(next) => {
                      const trimmed = next.trim();
                      // Collisions would silently drop a sibling — keep the old name.
                      if (!trimmed || (trimmed !== name && trimmed in expr.fields)) return;
                      withEntries(entries.map((en, j) => (j === i ? [trimmed, en[1]] : en)));
                    }}
                  />
                  <button
                    type="button"
                    className="btn tiny"
                    title="remove field"
                    onClick={() => withEntries(entries.filter((_, j) => j !== i))}
                  >
                    ×
                  </button>
                </div>
                <ExprNode
                  expr={sub}
                  onChange={(next) =>
                    withEntries(entries.map((en, j) => (j === i ? [en[0], next] : en)))
                  }
                />
              </div>
            ))}
            <button
              type="button"
              className="btn tiny"
              onClick={() =>
                withEntries([
                  ...entries,
                  [uniqueFieldName(expr.fields), defaultExpression('jsonpath')],
                ])
              }
            >
              + field
            </button>
          </div>
        </div>
      );
    }
  }
}

export function ExpressionField({
  label,
  value,
  onApply,
}: {
  label: string;
  value: Expression;
  onApply: (next: Expression) => void;
}) {
  const [mode, setMode] = useState<'visual' | 'json'>('visual');
  return (
    <div className="mb-3">
      <div className="mb-1 flex items-center justify-between">
        <span className="field-label">{label}</span>
        <button
          type="button"
          className="mode-toggle"
          onClick={() => setMode((m) => (m === 'visual' ? 'json' : 'visual'))}
        >
          {mode === 'visual' ? '{ } json' : '⊞ visual'}
        </button>
      </div>
      {mode === 'visual' ? (
        <div className="expr-tree">
          <ExprNode expr={value} onChange={onApply} />
        </div>
      ) : (
        <JsonField
          label=""
          value={value}
          rows={8}
          onApply={(parsed) => onApply(parsed as Expression)}
        />
      )}
    </div>
  );
}

/** Gate assertions: message + expression per row, add/remove. */
export function AssertionsField({
  assertions,
  onApply,
}: {
  assertions: readonly Assertion[];
  onApply: (next: Assertion[]) => void;
}) {
  return (
    <div className="mb-3">
      {assertions.map((a, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: positional edit
        <div className="assertion" key={i}>
          <div className="expr-row mb-1">
            <CommitInput
              value={a.message}
              placeholder="failure message"
              onCommit={(message) =>
                onApply(assertions.map((x, j) => (j === i ? { ...x, message } : x)))
              }
            />
            <button
              type="button"
              className="btn tiny"
              title="remove assertion"
              onClick={() => onApply(assertions.filter((_, j) => j !== i))}
            >
              ×
            </button>
          </div>
          <ExpressionField
            label={`assertion ${i + 1}`}
            value={a.expression}
            onApply={(expression) =>
              onApply(assertions.map((x, j) => (j === i ? { ...x, expression } : x)))
            }
          />
        </div>
      ))}
      <button
        type="button"
        className="btn tiny"
        onClick={() =>
          onApply([
            ...assertions,
            { expression: defaultExpression('exists'), message: 'output exists' },
          ])
        }
      >
        + assertion
      </button>
    </div>
  );
}
