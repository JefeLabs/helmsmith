import { hostname, userInfo } from 'node:os';
import type { Owner } from './types.js';

/**
 * Who holds a lease. `WORK_SESSION` when the shell says so, else Claude Code's session id, else
 * `user@host`. No pid or ppid: a git hook runs as a child of git and must agree with the shell
 * that started the effort.
 */
export function currentOwner(env: NodeJS.ProcessEnv = process.env): Owner {
  const named = [env.WORK_SESSION, env.CLAUDE_SESSION_NAME, env.CLAUDE_CODE_SESSION_ID].find(
    (v) => v !== undefined && v.length > 0,
  );
  return { session: named ?? `${userInfo().username}@${hostname()}`, pid: process.pid };
}
