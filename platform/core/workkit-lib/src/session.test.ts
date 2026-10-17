import { describe, expect, it } from 'vitest';
import { currentOwner } from './session.js';

describe('currentOwner', () => {
  it('prefers WORK_SESSION, then CLAUDE_SESSION_NAME, then user@host:ppid', () => {
    expect(currentOwner({ WORK_SESSION: 'w1', CLAUDE_SESSION_NAME: 'c1' }).session).toBe('w1');
    expect(currentOwner({ CLAUDE_SESSION_NAME: 'c1' }).session).toBe('c1');
    expect(currentOwner({}).session).toMatch(/^[^@]+@[^:]+:\d+$/);
    expect(currentOwner({}).pid).toBe(process.pid);
  });
});
