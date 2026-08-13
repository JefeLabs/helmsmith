import type {
  Expression,
  GateConfig,
  Edge as SpecEdge,
  TaskStep,
  TransformConfig,
  TriggerConfig,
} from '@helmsmith/flow-spec';
import type { DesignerEdge, DesignerNode } from '../graph-model.ts';
import { kindColor } from '../kinds.ts';
import { AssertionsField, ExpressionField } from './ExpressionField.tsx';
import { InputMappingField } from './InputMappingField.tsx';
import { JsonField } from './JsonField.tsx';
import { TriggerConfigField } from './TriggerConfigField.tsx';

const EDGE_TYPES: ReadonlyArray<SpecEdge['type']> = [
  'sequence',
  'conditional',
  'fallback',
  'error',
  'reject',
];

export function PropertyPanel({
  selection,
  nodes,
  edges,
  onUpdateStep,
  onRenameStep,
  onUpdateEdge,
  onDeleteSelection,
}: {
  selection: { type: 'node' | 'edge'; id: string } | null;
  nodes: DesignerNode[];
  edges: DesignerEdge[];
  onUpdateStep: (id: string, step: TaskStep) => void;
  onRenameStep: (id: string, nextId: string) => void;
  onUpdateEdge: (id: string, edge: SpecEdge) => void;
  onDeleteSelection: () => void;
}) {
  if (!selection) {
    return (
      <div className="p-4 text-xs" style={{ color: 'var(--dim)' }}>
        Select a node or an edge to inspect and edit it. Drag from a node's right handle to draw a
        new edge; Backspace deletes the selection.
      </div>
    );
  }

  if (selection.type === 'node') {
    const node = nodes.find((n) => n.id === selection.id);
    if (!node) return null;
    const step = node.data.step;
    return (
      <div className="p-4 overflow-y-auto h-full">
        <div className="mb-3 flex items-center justify-between">
          <span
            className="kind-chip font-mono text-[10px] uppercase tracking-widest"
            style={{ color: kindColor(step.kind) }}
          >
            {step.kind}
          </span>
          <button type="button" className="btn" onClick={onDeleteSelection}>
            delete
          </button>
        </div>
        <div className="mb-3">
          <span className="field-label">id</span>
          <input
            className="input mt-1"
            defaultValue={step.id}
            key={step.id}
            onBlur={(e) => {
              const next = e.target.value.trim();
              if (next && next !== step.id) onRenameStep(step.id, next);
            }}
          />
        </div>
        {step.kind === 'trigger' ? (
          <TriggerConfigField
            value={step.config as TriggerConfig}
            onApply={(config) =>
              onUpdateStep(step.id, { ...step, config: config as TaskStep['config'] })
            }
          />
        ) : step.kind === 'transform' ? (
          <ExpressionField
            label="expression"
            value={(step.config as TransformConfig).expression}
            onApply={(expression) =>
              onUpdateStep(step.id, { ...step, config: { expression } as TaskStep['config'] })
            }
          />
        ) : step.kind === 'gate' ? (
          <>
            <span className="field-label">assertions</span>
            <div className="mt-1">
              <AssertionsField
                assertions={(step.config as GateConfig).assertions}
                onApply={(assertions) =>
                  onUpdateStep(step.id, { ...step, config: { assertions } as TaskStep['config'] })
                }
              />
            </div>
          </>
        ) : (
          <JsonField
            label="config"
            value={step.config}
            onApply={(parsed) =>
              onUpdateStep(step.id, { ...step, config: parsed as TaskStep['config'] })
            }
            rows={10}
          />
        )}
        <InputMappingField
          value={step.input}
          onApply={(input) =>
            onUpdateStep(
              step.id,
              input === undefined ? (({ input: _, ...rest }) => rest)(step) : { ...step, input },
            )
          }
        />
        <JsonField
          label="output contract (optional)"
          value={step.output}
          allowAbsent
          rows={4}
          onApply={(parsed) =>
            onUpdateStep(step.id, { ...step, output: parsed as TaskStep['output'] })
          }
        />
        <JsonField
          label="tags (optional)"
          value={step.tags}
          allowAbsent
          rows={4}
          onApply={(parsed) => onUpdateStep(step.id, { ...step, tags: parsed as TaskStep['tags'] })}
        />
        <JsonField
          label="policy (optional)"
          value={step.policy}
          allowAbsent
          rows={4}
          onApply={(parsed) =>
            onUpdateStep(step.id, { ...step, policy: parsed as TaskStep['policy'] })
          }
        />
        <div className="grid grid-cols-2 gap-2">
          <div>
            <span className="field-label">effect</span>
            <select
              className="select mt-1"
              value={step.effect ?? ''}
              onChange={(e) =>
                onUpdateStep(step.id, {
                  ...step,
                  effect: (e.target.value || undefined) as TaskStep['effect'],
                })
              }
            >
              <option value="">—</option>
              <option value="pure">pure</option>
              <option value="idempotent">idempotent</option>
              <option value="side-effecting">side-effecting</option>
            </select>
          </div>
          <div>
            <span className="field-label">terminal</span>
            <select
              className="select mt-1"
              value={step.terminal ?? ''}
              onChange={(e) =>
                onUpdateStep(step.id, {
                  ...step,
                  terminal: (e.target.value || undefined) as TaskStep['terminal'],
                })
              }
            >
              <option value="">—</option>
              <option value="success">success</option>
              <option value="fail">fail</option>
            </select>
          </div>
        </div>
        <div className="mt-3">
          <JsonField
            label="joinStrategy (optional)"
            value={step.joinStrategy}
            allowAbsent
            rows={2}
            onApply={(parsed) =>
              onUpdateStep(step.id, { ...step, joinStrategy: parsed as TaskStep['joinStrategy'] })
            }
          />
        </div>
      </div>
    );
  }

  const dEdge = edges.find((e) => e.id === selection.id);
  if (!dEdge) return null;
  const edge = dEdge.data.edge;
  return (
    <div className="p-4 overflow-y-auto h-full">
      <div className="mb-3 flex items-center justify-between">
        <span className="panel-title">
          {edge.from} → {edge.to}
        </span>
        <button type="button" className="btn" onClick={onDeleteSelection}>
          delete
        </button>
      </div>
      <div className="mb-3">
        <span className="field-label">type</span>
        <select
          className="select mt-1"
          value={edge.type}
          onChange={(e) => {
            const type = e.target.value as SpecEdge['type'];
            const base = { from: edge.from, to: edge.to };
            const next: SpecEdge =
              type === 'conditional'
                ? { ...base, type, condition: { kind: 'literal', value: true } }
                : type === 'reject'
                  ? { ...base, type, maxAttempts: 3 }
                  : ({ ...base, type } as SpecEdge);
            onUpdateEdge(dEdge.id, next);
          }}
        >
          {EDGE_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>
      {edge.type === 'conditional' && (
        <ExpressionField
          label="condition"
          value={edge.condition as Expression}
          onApply={(condition) =>
            onUpdateEdge(dEdge.id, { ...edge, condition: condition as never })
          }
        />
      )}
      {edge.type === 'error' && (
        <JsonField
          label="on (error names; empty = catch-all)"
          value={edge.on}
          allowAbsent
          rows={2}
          onApply={(parsed) => onUpdateEdge(dEdge.id, { ...edge, on: parsed as never })}
        />
      )}
      {edge.type === 'reject' && (
        <>
          <div className="mb-3">
            <span className="field-label">maxAttempts</span>
            <input
              className="input mt-1"
              type="number"
              min={1}
              value={edge.maxAttempts ?? 3}
              onChange={(e) =>
                onUpdateEdge(dEdge.id, { ...edge, maxAttempts: Number(e.target.value) })
              }
            />
          </div>
          <JsonField
            label="onMaxAttempts (optional)"
            value={edge.onMaxAttempts}
            allowAbsent
            rows={2}
            onApply={(parsed) =>
              onUpdateEdge(dEdge.id, { ...edge, onMaxAttempts: parsed as never })
            }
          />
        </>
      )}
    </div>
  );
}
