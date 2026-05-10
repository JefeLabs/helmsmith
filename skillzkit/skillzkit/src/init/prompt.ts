/**
 * Tiny stdlib-only interactive prompt helpers used by `skillzkit init`
 * when args aren't passed up front. We avoid pulling in `prompts` /
 * `enquirer` / `inquirer` to keep the dependency tree minimal — these
 * are ~50 lines of glue around node:readline + raw-mode stdin.
 *
 * Implementation note: a single readline interface is shared across
 * all visible-prompt calls within a process. Creating a new interface
 * per prompt ends up closing stdin on `.close()` when stdin is piped
 * (not a TTY), which causes subsequent prompts to receive EOF
 * immediately. The shared interface is closed exactly once before
 * promptHidden() switches stdin to raw mode, since readline's
 * line-buffered handling conflicts with raw-mode keystroke capture.
 */

import { createInterface, type Interface as ReadlineInterface } from "node:readline/promises";

let sharedRl: ReadlineInterface | undefined;

function getReadline(): ReadlineInterface {
  if (!sharedRl) {
    sharedRl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
  }
  return sharedRl;
}

function closeReadline(): void {
  if (sharedRl) {
    sharedRl.close();
    sharedRl = undefined;
  }
}

/** Visible-input prompt — used for email, URL, key, mode, etc. */
export async function prompt(question: string): Promise<string> {
  return getReadline().question(question);
}

/**
 * Hidden-input prompt — characters echo as `*` so shoulder-surfers
 * and terminal scrollback don't capture the secret. Used for the PIN
 * and the plaintext API key during init.
 *
 * Implementation notes:
 *   - Closes any active readline interface first, since readline's
 *     line-buffered stdin handling conflicts with raw-mode keystroke
 *     capture. After this, all further prompts in the process must
 *     also be hidden (the visible prompt() would re-create readline
 *     and re-conflict).
 *   - Switches stdin to raw mode so we get each keystroke individually
 *     (line-buffered mode would echo the secret before we could mask it).
 *   - Handles backspace, Enter, and Ctrl-C explicitly. Other control
 *     codes are filtered so they can't corrupt the captured value.
 *   - Restores stdin to its prior state on every exit path so a Ctrl-C
 *     or unexpected error doesn't leave the terminal stuck in raw mode.
 */
export function promptHidden(question: string): Promise<string> {
  closeReadline();
  return new Promise((resolve, reject) => {
    process.stdout.write(question);
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    let value = "";

    const restore = () => {
      stdin.setRawMode(wasRaw);
      stdin.removeListener("data", onData);
      stdin.pause();
    };

    const onData = (chunk: Buffer) => {
      const str = chunk.toString("utf8");
      for (const ch of str) {
        if (ch === "\r" || ch === "\n") {
          process.stdout.write("\n");
          restore();
          resolve(value);
          return;
        }
        if (ch === "") {
          // Ctrl-C — restore terminal state before exit so the parent
          // shell isn't left in raw mode.
          process.stdout.write("\n");
          restore();
          process.exit(130);
        }
        if (ch === "\b" || ch === "") {
          // Backspace (\b = ) or DEL () — terminals send
          // one or the other depending on platform/config.
          if (value.length > 0) {
            value = value.slice(0, -1);
            process.stdout.write("\b \b");
          }
          continue;
        }
        // Filter non-printable control codes so escape sequences,
        // arrow keys, etc. can't pollute the captured value.
        if (ch >= " ") {
          value += ch;
          process.stdout.write("*");
        }
      }
    };

    try {
      stdin.setRawMode(true);
      stdin.resume();
      stdin.on("data", onData);
    } catch (err) {
      restore();
      reject(err);
    }
  });
}

/**
 * Yes/no prompt — accepts y/yes (true) or n/no (false), case-insensitive,
 * empty input falls back to `defaultValue`.
 */
export async function promptYesNo(
  question: string,
  defaultValue: boolean,
): Promise<boolean> {
  const suffix = defaultValue ? " [Y/n] " : " [y/N] ";
  const answer = (await prompt(question + suffix)).trim().toLowerCase();
  if (answer === "") return defaultValue;
  return answer === "y" || answer === "yes";
}

/**
 * Cleanly close the shared readline interface. Call after the last
 * visible prompt() if subsequent code needs raw stdin or just to free
 * the resource — node will hang waiting for stdin otherwise.
 */
export function closePrompts(): void {
  closeReadline();
}
