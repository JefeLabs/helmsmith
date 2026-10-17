import { describe, expect, it } from 'vitest';
import { currentOwner } from './session.js';

describe('currentOwner', () => {
  it('prefers WORK_SESSION, then CLAUDE_SESSION_NAME, then user@host:ppid', () => {
    expect(currentOwner({ WORK_SESSION: 'w1', CLAUDE_SESSION_NAME: 'c1' }).session).toBe('w1');
    expect(currentOwner({ CLAUDE_SESSION_NAME: 'c1' }).session).toBe('c1');
    expect(currentOwner({ CLAUDE_CODE_SESSION_ID: 'cc1' }).session).toBe('cc1');
    // no ppid in the fallback: a hook (child of git) and the shell that started the effort must agree
    expect(currentOwner({}).session).toMatch(/^[^@]+@[^:]+$/);
    expect(currentOwner({}).session).toBe(currentOwner({}).session);
    expect(currentOwner({}).pid).toBe(process.pid);
  });
});
