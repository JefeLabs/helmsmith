import type { Expression, TriggerConfig } from '@helmsmith/flow-spec';
import { useState } from 'react';
import { defaultTriggerConfig } from '../mapping-model.ts';
import { CommitInput, ExpressionField } from './ExpressionField.tsx';
import { JsonField } from './JsonField.tsx';

/**
 * Visual builder for trigger-node config — kind select + per-kind
 * fields (webhook path/method, schedule cron, event type + optional
 * matcher via the expression builder, message channel). Kind switches
 * take the kind's valid blank (configs are disjoint — nothing to
 * preserve, unlike expression kinds). The matcher evaluates against
 * the event envelope `{ type, payload }` — same semantics as suspend
 * wakes. `{ } json` keeps the raw editor, as everywhere.
 */
export function TriggerConfigField({
  value,
  onApply,
}: {
  value: TriggerConfig;
  onApply: (next: TriggerConfig) => void;
}) {
  const [mode, setMode] = useState<'visual' | 'json'>('visual');
  return (
    <div className="mb-3">
      <div className="mb-1 flex items-center justify-between">
        <span className="field-label">trigger</span>
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
          rows={5}
          onApply={(parsed) => onApply(parsed as TriggerConfig)}
        />
      ) : (
        <div className="expr-tree">
          <div className="expr-row">
            <select
              className="select expr-kind"
              value={value.kind}
              onChange={(e) =>
                onApply(defaultTriggerConfig(e.target.value as TriggerConfig['kind']))
              }
            >
              {(['manual', 'webhook', 'schedule', 'event', 'message'] as const).map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
            {value.kind === 'webhook' && (
              <>
                <CommitInput
                  value={value.path}
                  placeholder="hook path"
                  onCommit={(path) => onApply({ ...value, path })}
                />
                <select
                  className="select expr-op"
                  value={value.method ?? 'POST'}
                  onChange={(e) => onApply({ ...value, method: e.target.value as 'GET' | 'POST' })}
                >
                  <option value="POST">POST</option>
                  <option value="GET">GET</option>
                </select>
              </>
            )}
            {value.kind === 'schedule' && (
              <CommitInput
                value={value.cron}
                placeholder="0 9 * * 1-5 (server-local)"
                onCommit={(cron) => onApply({ ...value, cron })}
              />
            )}
            {value.kind === 'event' && (
              <CommitInput
                value={value.eventType}
                placeholder="event type"
                onCommit={(eventType) => onApply({ ...value, eventType })}
              />
            )}
            {value.kind === 'message' && (
              <CommitInput
                value={value.channel}
                placeholder="channel"
                onCommit={(channel) => onApply({ ...value, channel })}
              />
            )}
          </div>
          {value.kind === 'event' && (
            <div className="expr-children">
              {value.matcher ? (
                <div className="expr-item">
                  <ExpressionField
                    label="matcher — against { type, payload }"
                    value={value.matcher}
                    onApply={(matcher: Expression) => onApply({ ...value, matcher })}
                  />
                  <button
                    type="button"
                    className="btn tiny"
                    title="remove matcher (every event of this type fires)"
                    onClick={() => {
                      const { matcher: _, ...rest } = value;
                      onApply(rest);
                    }}
                  >
                    ×
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className="btn tiny"
                  onClick={() =>
                    onApply({
                      ...value,
                      matcher: {
                        kind: 'compare',
                        lhs: { kind: 'jsonpath', path: '$.payload.source' },
                        op: '==',
                        rhs: { kind: 'literal', value: 'ci' },
                      },
                    })
                  }
                >
                  + matcher
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
