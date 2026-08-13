import type {
  ApprovalTag,
  Expression,
  LoopTag,
  SuspendTag,
  TaskStepTags,
} from '@helmsmith/flow-spec';
import { useState } from 'react';
import {
  defaultApprovalTag,
  defaultLoopTag,
  defaultSuspendTag,
  prunedTags,
} from '../tags-model.ts';
import { CommitInput, ExpressionField, ExprNode } from './ExpressionField.tsx';
import { JsonField } from './JsonField.tsx';

/**
 * Visual builder for `TaskStep.tags` — the JsonField seam's last
 * holdout. Two independent sections:
 *
 *   - `loop` — source/mode selects, the iterable `path` as a real
 *     expression tree, concurrency (parallel only), recursive
 *     (directory only).
 *   - one PAUSE slot — approval ⊥ suspend is a validator rule, so the
 *     UI has a single select (— | approval | suspend) making the
 *     invalid combination unrepresentable. Approval edits role/SLA and
 *     optional steering-input rows (concurrency is pinned
 *     'pessimistic', the only v1 value). Suspend edits its trigger —
 *     timer duration, or event type + optional matcher via the full
 *     expression builder against the `{ type, payload }` envelope.
 *
 * All-absent prunes to an absent field (the wire never carries `{}`).
 * `{ } json` keeps the raw editor, as everywhere.
 */
export function TagsField({
  value,
  onApply,
}: {
  value: TaskStepTags | undefined;
  onApply: (next: TaskStepTags | undefined) => void;
}) {
  const [mode, setMode] = useState<'visual' | 'json'>('visual');
  const tags: TaskStepTags = value ?? {};
  const apply = (next: TaskStepTags) => onApply(prunedTags(next));
  const pause: '' | 'approval' | 'suspend' = tags.approval
    ? 'approval'
    : tags.suspend
      ? 'suspend'
      : '';

  return (
    <div className="mb-3">
      <div className="mb-1 flex items-center justify-between">
        <span className="field-label">tags (optional)</span>
        <button
          type="button"
          className="mode-toggle"
          onClick={() => setMode((m) => (m === 'visual' ? 'json' : 'visual'))}
        >
          {mode === 'visual' ? '{ } json' : '⊞ visual'}
        </button>
      </div>
      {mode === 'json' ? (
        <JsonField
          label=""
          value={value}
          allowAbsent
          rows={5}
          onApply={(parsed) => onApply(parsed as TaskStepTags | undefined)}
        />
      ) : (
        <div className="expr-tree">
          {/* ── loop ── */}
          {tags.loop ? (
            <LoopEditor
              loop={tags.loop}
              onChange={(loop) => apply({ ...tags, loop })}
              onRemove={() => apply({ ...tags, loop: undefined })}
            />
          ) : (
            <div className="expr-row">
              <button
                type="button"
                className="btn tiny"
                onClick={() => apply({ ...tags, loop: defaultLoopTag() })}
              >
                + loop
              </button>
            </div>
          )}

          {/* ── pause slot (approval ⊥ suspend) ── */}
          <div className="expr-row">
            <span className="expr-tag">pause</span>
            <select
              className="select expr-kind"
              value={pause}
              onChange={(e) => {
                const next = e.target.value as typeof pause;
                apply({
                  ...tags,
                  approval: next === 'approval' ? defaultApprovalTag() : undefined,
                  suspend: next === 'suspend' ? defaultSuspendTag('timer') : undefined,
                });
              }}
            >
              <option value="">—</option>
              <option value="approval">approval</option>
              <option value="suspend">suspend</option>
            </select>
          </div>
          {tags.approval && (
            <ApprovalEditor
              approval={tags.approval}
              onChange={(approval) => apply({ ...tags, approval })}
            />
          )}
          {tags.suspend && (
            <SuspendEditor
              suspend={tags.suspend}
              onChange={(suspend) => apply({ ...tags, suspend })}
            />
          )}
        </div>
      )}
    </div>
  );
}

/** Blur-commit number input: invalid text reverts to the prior value. */
function NumberCommit({
  value,
  onCommit,
  title,
}: {
  value: number;
  onCommit: (n: number) => void;
  title?: string;
}) {
  return (
    <CommitInput
      value={String(value)}
      className="input expr-mini"
      placeholder={title}
      onCommit={(text) => {
        const n = Number(text);
        if (Number.isFinite(n) && n > 0) onCommit(n);
      }}
    />
  );
}

function LoopEditor({
  loop,
  onChange,
  onRemove,
}: {
  loop: LoopTag;
  onChange: (next: LoopTag) => void;
  onRemove: () => void;
}) {
  return (
    <div>
      <div className="expr-row">
        <span className="expr-tag">loop</span>
        <select
          className="select expr-kind"
          value={loop.source}
          onChange={(e) => onChange({ ...loop, source: e.target.value as LoopTag['source'] })}
        >
          <option value="collection">collection</option>
          <option value="directory">directory</option>
        </select>
        <select
          className="select expr-kind"
          value={loop.mode}
          onChange={(e) => onChange({ ...loop, mode: e.target.value as LoopTag['mode'] })}
        >
          <option value="sequential">sequential</option>
          <option value="parallel">parallel</option>
        </select>
        {loop.mode === 'parallel' && (
          <NumberCommit
            value={loop.concurrency ?? 4}
            title="concurrency"
            onCommit={(concurrency) => onChange({ ...loop, concurrency })}
          />
        )}
        {loop.source === 'directory' && (
          <label className="expr-tag flex items-center gap-1" style={{ cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={loop.recursive === true}
              onChange={(e) =>
                onChange({ ...loop, recursive: e.target.checked ? true : undefined })
              }
            />
            recursive
          </label>
        )}
        <button type="button" className="btn tiny" title="remove loop" onClick={onRemove}>
          ×
        </button>
      </div>
      <div className="expr-children">
        <span className="expr-tag">path — resolves to the iterable</span>
        <ExprNode expr={loop.path} onChange={(path) => onChange({ ...loop, path })} />
      </div>
    </div>
  );
}

function ApprovalEditor({
  approval,
  onChange,
}: {
  approval: ApprovalTag;
  onChange: (next: ApprovalTag) => void;
}) {
  const fields = approval.steeringInputs?.fields ?? [];
  const withFields = (next: typeof fields) =>
    onChange({
      ...approval,
      steeringInputs: next.length > 0 ? { fields: next } : undefined,
    });
  return (
    <div className="expr-children">
      <div className="expr-row">
        <span className="expr-tag">role</span>
        <CommitInput
          value={approval.assigneeRole}
          placeholder="assignee role"
          onCommit={(assigneeRole) => onChange({ ...approval, assigneeRole })}
        />
        <span className="expr-tag">sla ms</span>
        <NumberCommit
          value={approval.slaMs}
          title="slaMs"
          onCommit={(slaMs) => onChange({ ...approval, slaMs })}
        />
      </div>
      {fields.map((f, i) => (
        <div className="expr-row" key={f.name}>
          <CommitInput
            value={f.name}
            className="input expr-name"
            onCommit={(name) => {
              const trimmed = name.trim();
              if (!trimmed || fields.some((x, j) => j !== i && x.name === trimmed)) return;
              withFields(fields.map((x, j) => (j === i ? { ...x, name: trimmed } : x)));
            }}
          />
          <select
            className="select expr-kind"
            value={f.type}
            onChange={(e) =>
              withFields(
                fields.map((x, j) =>
                  j === i ? { ...x, type: e.target.value as (typeof f)['type'] } : x,
                ),
              )
            }
          >
            <option value="string">string</option>
            <option value="number">number</option>
            <option value="boolean">boolean</option>
          </select>
          <label className="expr-tag flex items-center gap-1" style={{ cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={f.required === true}
              onChange={(e) =>
                withFields(
                  fields.map((x, j) =>
                    j === i ? { ...x, required: e.target.checked ? true : undefined } : x,
                  ),
                )
              }
            />
            required
          </label>
          <button
            type="button"
            className="btn tiny"
            title="remove steering field"
            onClick={() => withFields(fields.filter((_, j) => j !== i))}
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        className="btn tiny"
        onClick={() => {
          let n = 1;
          while (fields.some((f) => f.name === `field${n}`)) n += 1;
          withFields([...fields, { name: `field${n}`, type: 'string' }]);
        }}
      >
        + steering field
      </button>
    </div>
  );
}

function SuspendEditor({
  suspend,
  onChange,
}: {
  suspend: SuspendTag;
  onChange: (next: SuspendTag) => void;
}) {
  const trigger = suspend.trigger;
  return (
    <div className="expr-children">
      <div className="expr-row">
        <span className="expr-tag">wake on</span>
        <select
          className="select expr-kind"
          value={trigger.kind}
          onChange={(e) => onChange(defaultSuspendTag(e.target.value as 'timer' | 'event'))}
        >
          <option value="timer">timer</option>
          <option value="event">event</option>
        </select>
        {trigger.kind === 'timer' && (
          <NumberCommit
            value={trigger.durationMs}
            title="durationMs"
            onCommit={(durationMs) => onChange({ trigger: { kind: 'timer', durationMs } })}
          />
        )}
        {trigger.kind === 'event' && (
          <CommitInput
            value={trigger.eventType}
            placeholder="event type"
            onCommit={(eventType) => onChange({ trigger: { ...trigger, eventType } })}
          />
        )}
      </div>
      {trigger.kind === 'event' &&
        (trigger.matcher ? (
          <div className="expr-item">
            <ExpressionField
              label="matcher — against { type, payload }"
              value={trigger.matcher}
              onApply={(matcher: Expression) => onChange({ trigger: { ...trigger, matcher } })}
            />
            <button
              type="button"
              className="btn tiny"
              title="remove matcher (any event of this type wakes)"
              onClick={() => onChange({ trigger: { kind: 'event', eventType: trigger.eventType } })}
            >
              ×
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="btn tiny"
            onClick={() =>
              onChange({
                trigger: {
                  ...trigger,
                  matcher: {
                    kind: 'compare',
                    lhs: { kind: 'jsonpath', path: '$.payload.jobId' },
                    op: '==',
                    rhs: { kind: 'jsonpath', path: '$.payload.jobId' },
                  },
                },
              })
            }
          >
            + matcher
          </button>
        ))}
    </div>
  );
}
