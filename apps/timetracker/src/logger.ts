/**
 * Minimal structured logger — timestamped, leveled lines. Enough for a
 * long-running local process to leave a useful trail (reconnects, errors)
 * without pulling in a logging dependency.
 */
type Level = 'info' | 'warn' | 'error';

function emit(level: Level, msg: string, args: unknown[]): void {
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${msg}`;
  const sink = level === 'info' ? console.log : level === 'warn' ? console.warn : console.error;
  sink(line, ...args);
}

export const log = {
  info: (msg: string, ...args: unknown[]) => emit('info', msg, args),
  warn: (msg: string, ...args: unknown[]) => emit('warn', msg, args),
  error: (msg: string, ...args: unknown[]) => emit('error', msg, args),
};
