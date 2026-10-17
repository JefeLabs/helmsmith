import { describe, expect, it } from 'vitest';
import { WorkkitError, exitCodeFor, toErrorBody } from './errors.js';

describe('WorkkitError', () => {
  it('maps refusals to exit 2 and faults to exit 1', () => {
    expect(exitCodeFor('SCOPE_CONFLICT')).toBe(2);
    expect(exitCodeFor('PROTECTED_BRANCH')).toBe(2);
    expect(exitCodeFor('GIT_FAILED')).toBe(1);
    expect(exitCodeFor('INTERNAL')).toBe(1);
  });
  it('serialises with code, message and details; unknown errors become INTERNAL', () => {
    const e = new WorkkitError('EFFORT_OPEN', 'an effort is open', { owner: 's1' });
    expect(toErrorBody(e)).toEqual({
      code: 'EFFORT_OPEN',
      message: 'an effort is open',
      details: { owner: 's1' },
    });
    expect(toErrorBody(new Error('boom'))).toEqual({ code: 'INTERNAL', message: 'boom' });
  });
});
