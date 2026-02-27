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
