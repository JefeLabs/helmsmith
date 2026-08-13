import {
  evalExpression,
  resolveExpressionValue,
  schemaViolations,
  type UnsupportedFeature,
} from '@helmsmith/flow-spec';
import { useState } from 'react';

export interface ValidationState {
  errors: string[];
  warnings: UnsupportedFeature[];
}

/**
 * Validation report + live playgrounds. The playgrounds run the EXACT
 * evaluator and schema checker the runtime routes with — the designer
 * previews what the router will do, not an approximation of it.
 */
export function BottomPanel({ validation }: { validation: ValidationState }) {
  const [tab, setTab] = useState<'validation' | 'expression' | 'schema'>('validation');
  return (
    <div className="flex h-full flex-col">
      <div
        className="flex items-center gap-1 border-b px-3 py-1.5"
        style={{ borderColor: 'var(--line-soft)' }}
      >
        {(['validation', 'expression', 'schema'] as const).map((t) => (
          <button
            key={t}
            type="button"
            className="btn"
            style={
              tab === t
                ? { borderColor: 'var(--brass)', color: 'var(--brass)' }
                : { borderColor: 'transparent' }
            }
            onClick={() => setTab(t)}
          >
            {t === 'validation'
              ? `validation ${validation.errors.length > 0 ? '✕' : '✓'}`
              : `${t} playground`}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3 font-mono text-xs">
        {tab === 'validation' && <ValidationReport validation={validation} />}
        {tab === 'expression' && <ExpressionPlayground />}
        {tab === 'schema' && <SchemaPlayground />}
      </div>
    </div>
  );
}

function ValidationReport({ validation }: { validation: ValidationState }) {
  if (validation.errors.length === 0 && validation.warnings.length === 0) {
    return (
      <div style={{ color: 'var(--ok)' }}>
        ✓ catalog is valid — every declared feature is executed by the runtime
      </div>
    );
  }
  return (
    <div className="space-y-1">
      {validation.errors.map((e) => (
        <div key={e} style={{ color: 'var(--error)' }}>
          ✕ {e}
        </div>
      ))}
      {validation.warnings.map((w) => (
        <div key={`${w.where}:${w.feature}`} style={{ color: 'var(--warn)' }}>
          ⚠ {w.where}: '{w.feature}' — {w.detail}
        </div>
      ))}
    </div>
  );
}

function ExpressionPlayground() {
  const [expr, setExpr] = useState(
    '{\n  "kind": "compare",\n  "lhs": { "kind": "jsonpath", "path": "$.nodes.reviewer.score" },\n  "op": ">",\n  "rhs": { "kind": "literal", "value": 0.8 }\n}',
  );
  const [state, setState] = useState(
    '{\n  "input": "fix the bug",\n  "output": "done",\n  "nodes": { "reviewer": { "score": 0.9 } }\n}',
  );
  let verdict: string;
  let color = 'var(--ok)';
  try {
    const e = JSON.parse(expr);
    const s = JSON.parse(state);
    const predicate = evalExpression(e, s);
    const value = resolveExpressionValue(e, s);
    verdict = `predicate ⇒ ${String(predicate)}   ·   value ⇒ ${JSON.stringify(value)}`;
    if (!predicate) color = 'var(--warn)';
  } catch (err) {
    verdict = (err as Error).message;
    color = 'var(--error)';
  }
  return (
    <div className="grid h-full grid-cols-2 gap-3">
      <div>
        <div className="field-label mb-1">expression</div>
        <textarea
          className="json h-[calc(100%-40px)]"
          value={expr}
          onChange={(e) => setExpr(e.target.value)}
          spellCheck={false}
        />
      </div>
      <div className="flex flex-col">
        <div className="field-label mb-1">run state ($)</div>
        <textarea
          className="json flex-1"
          value={state}
          onChange={(e) => setState(e.target.value)}
          spellCheck={false}
        />
        <div className="mt-2" style={{ color }}>
          {verdict}
        </div>
      </div>
    </div>
  );
}

function SchemaPlayground() {
  const [schema, setSchema] = useState(
    '{\n  "type": "object",\n  "required": ["score"],\n  "properties": { "score": { "type": "number", "minimum": 0, "maximum": 1 } }\n}',
  );
  const [value, setValue] = useState('{ "score": 2 }');
  let verdict: string;
  let color = 'var(--ok)';
  try {
    const issues = schemaViolations(JSON.parse(value), JSON.parse(schema));
    verdict = issues.length === 0 ? '✓ conforms' : issues.join('\n');
    if (issues.length > 0) color = 'var(--error)';
  } catch (err) {
    verdict = (err as Error).message;
    color = 'var(--error)';
  }
  return (
    <div className="grid h-full grid-cols-2 gap-3">
      <div>
        <div className="field-label mb-1">output schema (enforced subset)</div>
        <textarea
          className="json h-[calc(100%-40px)]"
          value={schema}
          onChange={(e) => setSchema(e.target.value)}
          spellCheck={false}
        />
      </div>
      <div className="flex flex-col">
        <div className="field-label mb-1">candidate value</div>
        <textarea
          className="json flex-1"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          spellCheck={false}
        />
        <div className="mt-2 whitespace-pre-wrap" style={{ color }}>
          {verdict}
        </div>
      </div>
    </div>
  );
}
