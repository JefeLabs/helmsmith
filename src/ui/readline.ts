import { normalizeKey } from "./keypress.js";

/**
 * Read a line of text from stdin in raw mode.
 *
 * Supports: typing characters, backspace, Escape to cancel, Enter to submit.
 * Renders inline: shows prompt + current buffer, redraws on each keypress.
 *
 * Returns the entered string, or null if the user pressed Escape.
 * Throws on Ctrl+C (consistent with readKey).
 */
export function readLine(prompt: string): Promise<string | null> {
  return new Promise<string | null>((resolve, reject) => {
    if (!process.stdin.isTTY) {
      reject(new Error("readLine requires a TTY stdin"));
      return;
    }

    let buffer = "";

    const render = () => {
      // Clear the current line and redraw
      process.stdout.write(`\r\x1B[K${prompt}${buffer}`);
    };

    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");

    render();

    const cleanup = () => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener("data", handler);
    };

    const handler = (chunk: string) => {
      const key = normalizeKey(chunk);

      if (key.name === "ctrl-c") {
        cleanup();
        process.stdout.write("\n");
        reject(new Error("SIGINT"));
        return;
      }

      if (key.name === "escape") {
        cleanup();
        process.stdout.write("\n");
        resolve(null);
        return;
      }

      if (key.name === "return") {
        cleanup();
        process.stdout.write("\n");
        resolve(buffer);
        return;
      }

      if (key.name === "backspace") {
        if (buffer.length > 0) {
          buffer = buffer.slice(0, -1);
        }
        render();
        return;
      }

      // Only accept printable characters
      if (chunk.length === 1 && chunk.charCodeAt(0) >= 32) {
        buffer += chunk;
        render();
      }
    };

    process.stdin.on("data", handler);
  });
}
