import type { Expression, TaskStep } from '@helmsmith/flow-spec';
import { useState } from 'react';
import { defaultExpression } from '../expression-model.ts';
import {
  fieldsFromSingle,
  isSingleExpression,
  singleFromFields,
  uniqueMappingName,
} from '../mapping-model.ts';
import { CommitInput, ExprNode } from './ExpressionField.tsx';
import { JsonField } from './JsonField.tsx';

/**
 * Visual builder for `TaskStep.input` — the last data-plane JsonField.
 * Two wire forms, toggled losslessly (a Record mapping and an object-
 * constructor Expression share runtime semantics — see mapping-model):
 *
 *   - `named fields` — one row per mapping entry: [name][expression].
 *     Names guard the wire heuristic: `kind` is banned (it marks the
 *     single form) and collisions revert (they'd drop a sibling).
 *   - `single` — one expression resolving to the whole effective input.
 *
 * The field is optional: absent renders as one add button; × removes
 * the mapping (legacy behavior: the node reads `$.output` as-is).
 * A `{ } json` toggle keeps the raw editor, as everywhere.
 */
export function InputMappingField({
  value,
  onApply,
}: {
  value: TaskStep['input'];
  onApply: (next: TaskStep['input'] | undefined) => void;
}) {
  const [mode, setMode] = useState<'visual' | 'json'>('visual');

  if (value === undefined) {
    return (
      <div className="mb-3">
        <span className="field-label">input mapping (optional)</span>
        <div className="mt-1">
          <button
            type="button"
            className="btn tiny"
            onClick={() => onApply({ task: { kind: 'jsonpath', path: '$.input' } })}
          >
            + input mapping
          </button>
        </div>
      </div>
    );
  }

  const single = isSingleExpression(value);
  return (
    <div className="mb-3">
      <div className="mb-1 flex items-center justify-between">
        <span className="field-label">input mapping</span>
        <span className="flex items-center gap-2">
          <button
            type="button"
            className="mode-toggle"
            title="switch mapping form (lossless — an object expression IS a field map)"
            onClick={() =>
              onApply(
                single
                  ? fieldsFromSingle(value as Expression)
                  : singleFromFields(value as Readonly<Record<string, Expression>>),
              )
            }
          >
            {single ? '⊟ named fields' : '⊞ single'}
          </button>
          <button
            type="button"
            className="mode-toggle"
            onClick={() => setMode((m) => (m === 'visual' ? 'json' : 'visual'))}
          >
            {mode === 'visual' ? '{ } json' : '⊞ visual'}
          </button>
          <button
            type="button"
            className="btn tiny"
            title="remove mapping (node reads $.output as-is)"
            onClick={() => onApply(undefined)}
          >
            ×
          </button>
        </span>
      </div>
      {mode === 'json' ? (
        <JsonField
          label=""
          value={value}
          rows={6}
          allowAbsent
          onApply={(parsed) => onApply(parsed as TaskStep['input'])}
        />
      ) : single ? (
        <div className="expr-tree">
          <ExprNode expr={value as Expression} onChange={(next) => onApply(next)} />
        </div>
      ) : (
        <MappingFieldsEditor
          fields={value as Readonly<Record<string, Expression>>}
          onApply={onApply}
        />
      )}
    </div>
  );
}

function MappingFieldsEditor({
  fields,
  onApply,
}: {
  fields: Readonly<Record<string, Expression>>;
  onApply: (next: Readonly<Record<string, Expression>>) => void;
}) {
  const entries = Object.entries(fields);
  const withEntries = (next: Array<[string, Expression]>) => onApply(Object.fromEntries(next));
  return (
    <div className="expr-tree">
      {entries.map(([name, expr], i) => (
        <div className="expr-item" key={name}>
          <div className="expr-fieldname">
            <CommitInput
              value={name}
              className="input expr-name"
              onCommit={(next) => {
                const trimmed = next.trim();
                // `kind` marks the single form on the wire; collisions
                // would drop a sibling — both revert.
                if (!trimmed || trimmed === 'kind' || (trimmed !== name && trimmed in fields))
                  return;
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
            expr={expr}
            onChange={(next) => withEntries(entries.map((en, j) => (j === i ? [en[0], next] : en)))}
          />
        </div>
      ))}
      <button
        type="button"
        className="btn tiny"
        onClick={() =>
          withEntries([...entries, [uniqueMappingName(fields), defaultExpression('jsonpath')]])
        }
      >
        + field
      </button>
    </div>
  );
}
