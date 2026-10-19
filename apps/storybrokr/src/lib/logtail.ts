import { closeSync, openSync, readSync, statSync } from 'node:fs';
import type { LogBuffer } from './logbuffer.js';

/**
 * Feed `into` with whatever gets appended to `path` after `startOffset`, polling every
 * 100 ms. Used for every Storybook child (they write straight to storybook.log) and for
 * `logs --follow` on an instance adopted after a daemon restart, which has no process handle.
 */
export function tailFile(
  path: string,
  startOffset: number,
  into: LogBuffer,
): { drain(): void; stop(): void } {
  let offset = startOffset;
  const drain = (): void => {
    let fd: number;
    try {
      fd = openSync(path, 'r');
    } catch {
      return;
    }
    try {
      const size = statSync(path).size;
      if (size <= offset) return;
      const buf = Buffer.alloc(size - offset);
      const n = readSync(fd, buf, 0, buf.length, offset);
      offset += n;
      into.push(buf.subarray(0, n).toString());
    } finally {
      closeSync(fd);
    }
  };
  const timer = setInterval(drain, 100);
  timer.unref();
  return {
    drain,
    stop: () => {
      clearInterval(timer);
      drain();
    },
  };
}

/** The current size of a file, or 0 when it does not exist. */
export function fileSize(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0;
  }
}
