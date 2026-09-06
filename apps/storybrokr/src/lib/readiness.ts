import type { StoryEntry } from '../types.js';
import { StorybrokrError } from './errors.js';
import type { LogBuffer } from './logbuffer.js';

interface IndexJson {
  entries?: Record<
    string,
    { id: string; type: string; title: string; name: string; importPath: string }
  >;
}

export function parseIndex(json: unknown, port: number): StoryEntry[] {
  const entries = (json as IndexJson).entries ?? {};
  const base = `http://127.0.0.1:${port}`;
  return Object.values(entries)
    .filter((e) => e.type === 'story')
    .map((e) => ({
      id: e.id,
      title: e.title,
      name: e.name,
      importPath: e.importPath,
      url: `${base}/?path=/story/${e.id}`,
      iframeUrl: `${base}/iframe.html?id=${e.id}&viewMode=story`,
    }));
}

export async function fetchStories(port: number): Promise<StoryEntry[] | null> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/index.json`);
    if (!res.ok) return null;
    return parseIndex(await res.json(), port);
  } catch {
    return null;
  }
}

const BANNER_RE = /Local:\s+http/;
const FAILURE_RE = /\b(EADDRINUSE|Cannot find module|SB_[A-Z_]+_\d+|Error: Failed to)\b/;

export interface WaitOptions {
  port: number;
  log: LogBuffer;
  exited: Promise<number | null>;
  timeoutMs: number;
  pollMs?: number;
}

export async function waitForReady(opts: WaitOptions): Promise<StoryEntry[]> {
  const poll = opts.pollMs ?? 500;
  const deadline = Date.now() + opts.timeoutMs;
  let exitCode: number | null | undefined;
  void opts.exited.then((code) => {
    exitCode = code;
  });
  let failure: string | null = null;
  const off = opts.log.onLine((line) => {
    if (failure === null && FAILURE_RE.test(line)) failure = line;
  });
  try {
    for (;;) {
      if (exitCode !== undefined) {
        throw new StorybrokrError(
          'BOOT_FAILED',
          `storybook exited with code ${exitCode} before becoming ready`,
          opts.log.tail(50),
        );
      }
      if (failure !== null) {
        throw new StorybrokrError(
          'BOOT_FAILED',
          `storybook reported a failure: ${failure}`,
          opts.log.tail(50),
        );
      }
      const bannerSeen = opts.log.lines.some((l) => BANNER_RE.test(l));
      const stories = bannerSeen ? await fetchStories(opts.port) : null;
      if (stories) return stories;
      if (Date.now() > deadline) {
        throw new StorybrokrError(
          'BOOT_TIMEOUT',
          `storybook did not become ready within ${opts.timeoutMs} ms`,
          opts.log.tail(50),
        );
      }
      await new Promise((r) => setTimeout(r, poll));
    }
  } finally {
    off();
  }
}
