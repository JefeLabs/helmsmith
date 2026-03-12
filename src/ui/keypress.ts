/**
 * Raw keypress reader for TUI navigation.
 *
 * Replaces @inquirer/prompts with instant single-key actions.
 * Enters raw mode, captures one keypress, cleans up, returns.
 */

export interface KeyEvent {
  raw: string;
  name: string;
  ctrl: boolean;
}

/**
 * Normalize a raw keypress byte sequence into a named key.
 */
export function normalizeKey(raw: string): KeyEvent {
  const ctrl = raw.length === 1 && raw.charCodeAt(0) < 32;

  // Ctrl sequences
  if (raw === '\x03') return { raw, name: 'ctrl-c', ctrl: true };
  if (raw === '\x04') return { raw, name: 'ctrl-d', ctrl: true };

  // Special keys
  if (raw === '\r' || raw === '\n') return { raw, name: 'return', ctrl: false };
  if (raw === '\x1b') return { raw, name: 'escape', ctrl: false };
  if (raw === '\x09') return { raw, name: 'tab', ctrl: false };
  if (raw === '\x7f' || raw === '\x08') return { raw, name: 'backspace', ctrl: false };

  // Arrow keys (escape sequences)
  if (raw === '\x1b[A') return { raw, name: 'up', ctrl: false };
  if (raw === '\x1b[B') return { raw, name: 'down', ctrl: false };
  if (raw === '\x1b[C') return { raw, name: 'right', ctrl: false };
  if (raw === '\x1b[D') return { raw, name: 'left', ctrl: false };

  // Regular character
  return { raw, name: raw.toLowerCase(), ctrl };
}

/**
 * Read a single keypress from stdin in raw mode.
 *
 * Returns a normalized KeyEvent. Throws on Ctrl+C so callers
 * can handle it as an exit signal (matching @inquirer/prompts behavior).
 *
 * Must only be called when process.stdin.isTTY is true.
 */
export function readKey(): Promise<KeyEvent> {
  return new Promise<KeyEvent>((resolve, reject) => {
    if (!process.stdin.isTTY) {
      reject(new Error('readKey requires a TTY stdin'));
      return;
    }

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    const cleanup = () => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener('data', handler);
    };

    const handler = (chunk: string) => {
      cleanup();
      const key = normalizeKey(chunk);

      if (key.name === 'ctrl-c') {
        reject(new Error('SIGINT'));
        return;
      }

      resolve(key);
    };

    process.stdin.once('data', handler);
  });
}

/**
 * Read a single keypress, but give up after `timeoutMs` milliseconds
 * or when the optional `signal` is aborted (whichever comes first).
 *
 * Returns `null` on timeout or abort — the caller can use the idle
 * tick to poll for external state changes (e.g. database updates
 * from a background --watch process) and then re-render.
 *
 * The `signal` parameter enables reactive TUI updates: a DbWatcher
 * can abort it when the SQLite file changes, collapsing the poll
 * latency from `timeoutMs` to near-zero.
 */
export function readKeyWithTimeout(
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<KeyEvent | null> {
  return new Promise<KeyEvent | null>((resolve, reject) => {
    if (!process.stdin.isTTY) {
      reject(new Error('readKeyWithTimeout requires a TTY stdin'));
      return;
    }

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    let settled = false;

    const cleanup = () => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener('data', handler);
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };

    const settle = () => {
      if (settled) return false;
      settled = true;
      cleanup();
      return true;
    };

    const handler = (chunk: string) => {
      if (!settle()) return;
      const key = normalizeKey(chunk);

      if (key.name === 'ctrl-c') {
        reject(new Error('SIGINT'));
        return;
      }

      resolve(key);
    };

    const timer = setTimeout(() => {
      if (settle()) resolve(null);
    }, timeoutMs);

    const onAbort = () => {
      if (settle()) resolve(null);
    };

    // If already aborted, resolve immediately
    if (signal?.aborted) {
      settle();
      resolve(null);
      return;
    }

    signal?.addEventListener('abort', onAbort, { once: true });
    process.stdin.once('data', handler);
  });
}
