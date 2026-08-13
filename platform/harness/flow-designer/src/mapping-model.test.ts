import type { Expression, TaskStep, TriggerConfig } from '@helmsmith/flow-spec';
import { describe, expect, it } from 'vitest';
import {
  defaultTriggerConfig,
  fieldsFromSingle,
  isSingleExpression,
  singleFromFields,
  uniqueMappingName,
} from './mapping-model.ts';

const jp = (path: string): Expression => ({ kind: 'jsonpath', path });

describe('input-mapping model', () => {
  it('detects the single-Expression form by a string kind (the wire heuristic)', () => {
    expect(isSingleExpression(jp('$.a'))).toBe(true);
    expect(isSingleExpression({ task: jp('$.input') } as NonNullable<TaskStep['input']>)).toBe(
      false,
    );
  });

  it('fields → single wraps as an object constructor (identical runtime semantics)', () => {
    expect(singleFromFields({ a: jp('$.x'), b: jp('$.y') })).toEqual({
      kind: 'object',
      fields: { a: jp('$.x'), b: jp('$.y') },
    });
  });

  it('single → fields unwraps an object constructor losslessly', () => {
    const single: Expression = { kind: 'object', fields: { a: jp('$.x') } };
    expect(fieldsFromSingle(single)).toEqual({ a: jp('$.x') });
  });

  it('single → fields wraps a non-object expression under "value"', () => {
    expect(fieldsFromSingle(jp('$.input'))).toEqual({ value: jp('$.input') });
  });

  it('unique mapping names skip taken names AND the reserved "kind" key', () => {
    expect(uniqueMappingName({})).toBe('f1');
    expect(uniqueMappingName({ f1: jp('$.a') })).toBe('f2');
    // "kind" is the single-form discriminator — never generated.
    expect(uniqueMappingName({}, 'kind')).not.toBe('kind');
  });
});

describe('trigger model', () => {
  it('produces a valid default for every trigger kind', () => {
    const kinds: TriggerConfig['kind'][] = ['manual', 'webhook', 'schedule', 'event', 'message'];
    for (const kind of kinds) {
      expect(defaultTriggerConfig(kind).kind).toBe(kind);
    }
    expect(defaultTriggerConfig('webhook')).toEqual({ kind: 'webhook', path: 'my-hook' });
    expect(defaultTriggerConfig('schedule')).toEqual({ kind: 'schedule', cron: '0 9 * * 1-5' });
    expect(defaultTriggerConfig('event')).toEqual({ kind: 'event', eventType: 'my-event' });
    expect(defaultTriggerConfig('message')).toEqual({ kind: 'message', channel: 'ops' });
  });
});
