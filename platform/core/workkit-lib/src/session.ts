import { hostname, userInfo } from 'node:os';
import type { Owner } from './types.js';

/** Who holds a lease: a named session when the shell says so, else user@host:ppid. */
export function currentOwner(env: NodeJS.ProcessEnv = process.env): Owner {
  const session =
    env.WORK_SESSION && env.WORK_SESSION.length > 0
      ? env.WORK_SESSION
      : env.CLAUDE_SESSION_NAME && env.CLAUDE_SESSION_NAME.length > 0
        ? env.CLAUDE_SESSION_NAME
        : `${userInfo().username}@${hostname()}:${process.ppid}`;
  return { session, pid: process.pid };
}
