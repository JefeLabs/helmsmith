import type { TaskStep } from '@helmsmith/flow-spec';

export const STEP_KINDS: ReadonlyArray<TaskStep['kind']> = [
  'trigger',
  'agent',
  'tool',
  'script',
  'transform',
  'gate',
  'subflow',
  'publish',
];

export function kindColor(kind: TaskStep['kind']): string {
  return `var(--k-${kind})`;
}

/** One-line config summary for the node card. */
export function stepSummary(step: TaskStep): string {
  const c = step.config as Record<string, unknown>;
  switch (step.kind) {
    case 'trigger':
      return String(c.kind ?? 'manual');
    case 'agent': {
      const agent = c.agent as { role?: string; adapter?: string } | undefined;
      return `${agent?.role ?? '—'} · ${agent?.adapter ?? ''}`;
    }
    case 'tool':
      return String(c.toolId ?? '—');
    case 'script':
      return String(c.language ?? '—');
    case 'transform':
      return 'expression';
    case 'gate':
      return `${(c.assertions as unknown[] | undefined)?.length ?? 0} assertion(s)`;
    case 'subflow':
      return `→ ${String(c.flowId ?? '—')}`;
    case 'publish':
      return String(c.action ?? '—');
  }
}
