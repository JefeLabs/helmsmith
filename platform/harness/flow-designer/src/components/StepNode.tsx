import type { NodeProps } from '@xyflow/react';
import { Handle, Position } from '@xyflow/react';
import type { DesignerNode } from '../graph-model.ts';
import { kindColor, stepSummary } from '../kinds.ts';

export function StepNode({ data, selected }: NodeProps & { data: DesignerNode['data'] }) {
  const step = data.step;
  const badges: Array<{ text: string; fail?: boolean }> = [];
  if (step.tags?.approval) badges.push({ text: 'approval' });
  if (step.tags?.suspend) badges.push({ text: 'suspend' });
  if (step.tags?.loop) badges.push({ text: 'loop' });
  if (step.policy) badges.push({ text: 'policy' });
  if (step.joinStrategy) badges.push({ text: 'join' });
  if (step.effect === 'side-effecting') badges.push({ text: 'effect!' });
  if (step.output?.kind === 'json') badges.push({ text: 'json' });
  if (step.terminal === 'fail') badges.push({ text: 'FAIL ⏻', fail: true });

  return (
    <div
      className={`step-node ${selected ? 'selected' : ''}`}
      style={{ '--kind': kindColor(step.kind) } as React.CSSProperties}
    >
      {step.kind !== 'trigger' && <Handle type="target" position={Position.Left} />}
      <div className="kind-chip">{step.kind}</div>
      <div className="node-id">{step.id}</div>
      <div className="node-sub">{stepSummary(step)}</div>
      {badges.length > 0 && (
        <div className="badges">
          {badges.map((b) => (
            <span key={b.text} className={`badge ${b.fail ? 'fail' : ''}`}>
              {b.text}
            </span>
          ))}
        </div>
      )}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
