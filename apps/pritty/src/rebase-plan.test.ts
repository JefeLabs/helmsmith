import { describe, expect, it } from 'vitest';
import { validateRebasePlan } from './ai.js';

const a = 'a'.repeat(40);
const b = 'b'.repeat(40);
const c = 'c'.repeat(40);
const input = [a, b, c];

describe('validateRebasePlan', () => {
  it('accepts a plan that uses every commit once, in any order', () => {
    expect(() =>
      validateRebasePlan(
        [
          { hash: a, action: 'pick' },
          { hash: c, action: 'pick' },
          { hash: b.slice(0, 7), action: 'fixup' },
        ],
        input,
      ),
    ).not.toThrow();
  });

  it('rejects a plan that repeats one commit and drops another', () => {
    expect(() =>
      validateRebasePlan(
        [
          { hash: a, action: 'pick' },
          { hash: a, action: 'pick' },
          { hash: c, action: 'pick' },
        ],
        input,
      ),
    ).toThrow(/bbbbbbb/);
  });

  it('rejects an unknown hash, a bad action, a wrong length and a non-pick first step', () => {
    expect(() =>
      validateRebasePlan(
        [
          { hash: a, action: 'pick' },
          { hash: b, action: 'pick' },
          { hash: 'ffff', action: 'pick' },
        ],
        input,
      ),
    ).toThrow(/unknown hash/);
    expect(() =>
      validateRebasePlan(
        [
          { hash: a, action: 'pick' },
          { hash: b, action: 'yeet' as never },
          { hash: c, action: 'pick' },
        ],
        input,
      ),
    ).toThrow(/invalid action/);
    expect(() => validateRebasePlan([{ hash: a, action: 'pick' }], input)).toThrow(/3 commits/);
    expect(() =>
      validateRebasePlan(
        [
          { hash: a, action: 'squash' },
          { hash: b, action: 'pick' },
          { hash: c, action: 'pick' },
        ],
        input,
      ),
    ).toThrow(/first step/i);
  });
});
