import { describe, expect, it } from 'vitest';
import type { InstanceRecord } from '../types.js';
import { selectDownTargets } from './down.js';

const rec = (id: string) => ({ id }) as InstanceRecord;

describe('selectDownTargets', () => {
  it('returns every id when --all is given, even with zero running instances', () => {
    expect(selectDownTargets([], undefined, true)).toEqual([]);
    expect(selectDownTargets([rec('a'), rec('b')], undefined, true)).toEqual(['a', 'b']);
  });

  it('returns the single target when an id/path is given', () => {
    expect(selectDownTargets([], 'abc', false)).toEqual(['abc']);
  });

  it('throws when neither --all nor an id/path is given', () => {
    expect(() => selectDownTargets([], undefined, false)).toThrow(
      /give an instance id\/path or --all/,
    );
  });
});
