import type { TaskStepTags } from '@helmsmith/flow-spec';
import { describe, expect, it } from 'vitest';
import { defaultApprovalTag, defaultLoopTag, defaultSuspendTag, prunedTags } from './tags-model.ts';

describe('tags model', () => {
  it('loop default is a valid sequential collection loop', () => {
    expect(defaultLoopTag()).toEqual({
      source: 'collection',
      path: { kind: 'jsonpath', path: '$.output' },
      mode: 'sequential',
    });
  });

  it('approval default carries the required fields with pessimistic concurrency', () => {
    expect(defaultApprovalTag()).toEqual({
      assigneeRole: 'reviewer',
      slaMs: 86_400_000,
      concurrency: 'pessimistic',
    });
  });

  it('suspend defaults per trigger kind', () => {
    expect(defaultSuspendTag('timer')).toEqual({
      trigger: { kind: 'timer', durationMs: 3_600_000 },
    });
    expect(defaultSuspendTag('event')).toEqual({
      trigger: { kind: 'event', eventType: 'my-event' },
    });
  });

  it('prunedTags returns undefined when every tag is absent (removes the field)', () => {
    expect(prunedTags({})).toBeUndefined();
    const tags: TaskStepTags = { loop: defaultLoopTag() };
    expect(prunedTags(tags)).toEqual(tags);
  });
});
