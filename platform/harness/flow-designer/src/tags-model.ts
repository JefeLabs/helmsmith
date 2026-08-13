/**
 * Pure semantics behind the tag builder — valid blanks per tag and the
 * pruning rule that keeps the wire clean (an empty tags object is the
 * absent field, never `{}`). Approval ⊥ suspend is a validator rule the
 * TagsField enforces structurally (one pause slot); loop composes with
 * either. Kept free of React, unit-tested.
 */
import type { ApprovalTag, LoopTag, SuspendTag, TaskStepTags } from '@helmsmith/flow-spec';

export function defaultLoopTag(): LoopTag {
  return {
    source: 'collection',
    path: { kind: 'jsonpath', path: '$.output' },
    mode: 'sequential',
  };
}

/** 24h SLA — long enough to be a real review window, short enough that
 *  a forgotten approval auto-rejects within a day. */
export function defaultApprovalTag(): ApprovalTag {
  return { assigneeRole: 'reviewer', slaMs: 86_400_000, concurrency: 'pessimistic' };
}

export function defaultSuspendTag(kind: 'timer' | 'event'): SuspendTag {
  return kind === 'timer'
    ? { trigger: { kind: 'timer', durationMs: 3_600_000 } }
    : { trigger: { kind: 'event', eventType: 'my-event' } };
}

/** The wire never carries an empty tags object: all-absent → undefined
 *  (removes the field from the step). */
export function prunedTags(tags: TaskStepTags): TaskStepTags | undefined {
  if (!tags.loop && !tags.approval && !tags.suspend) return undefined;
  return tags;
}
