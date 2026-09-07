import { writeFile as fsWriteFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { StorybrokrError } from '../lib/errors.js';
import { RECORDER_SCRIPT, type SettlePage, settleStory } from '../lib/settle.js';
import type {
  CheckRequest,
  CheckResponse,
  CheckResult,
  InstanceRecord,
  ScreenshotRequest,
  ScreenshotResponse,
  StoryEntry,
  Viewport,
} from '../types.js';

/** The slice of Playwright's Page/BrowserContext the inspector uses; fakes satisfy it in tests. */
export interface InspectorPage extends SettlePage {
  locator(selector: string): {
    boundingBox(): Promise<{ x: number; y: number; width: number; height: number } | null>;
    screenshot(): Promise<Buffer>;
  };
  screenshot(opts?: {
    fullPage?: boolean;
    clip?: { x: number; y: number; width: number; height: number };
  }): Promise<Buffer>;
}

export interface InspectorContext {
  // Playwright's BrowserContext#addInitScript resolves to a Disposable, not void; widened to
  // Promise<unknown> so a real BrowserContext satisfies this interface without a cast.
  addInitScript(script: string): Promise<unknown>;
  newPage(): Promise<InspectorPage>;
  close(): Promise<void>;
}

export interface InspectorDeps {
  pool: { acquire(viewport?: Viewport): Promise<InspectorContext> };
  settle?: typeof settleStory;
  writeFile?: (path: string, data: Buffer) => Promise<void>;
  now?: () => number;
}

export interface Inspector {
  check(record: InstanceRecord, req: CheckRequest): Promise<CheckResponse>;
  screenshot(record: InstanceRecord, req: ScreenshotRequest): Promise<ScreenshotResponse>;
}

export const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_VIEWPORT: Viewport = { width: 1280, height: 720 };

function assertReady(record: InstanceRecord): void {
  if (record.status !== 'ready') {
    throw new StorybrokrError(
      'INSTANCE_NOT_READY',
      `instance ${record.id} is ${record.status}; check and screenshot need a ready instance`,
    );
  }
}

function findStories(record: InstanceRecord, ids: string[] | undefined): StoryEntry[] {
  if (!ids) return record.stories;
  const byId = new Map(record.stories.map((s) => [s.id, s]));
  const unknown = ids.filter((id) => !byId.has(id));
  if (unknown.length > 0) {
    throw new StorybrokrError(
      'STORY_NOT_FOUND',
      `unknown story id${unknown.length > 1 ? 's' : ''} for ${record.id}: ${unknown.join(', ')}`,
    );
  }
  return ids.map((id) => byId.get(id) as StoryEntry);
}

async function defaultWriteFile(path: string, data: Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await fsWriteFile(path, data);
}

/** PNG stores width/height big-endian at bytes 16 and 20 of the IHDR chunk. */
function pngSize(buf: Buffer): { width: number; height: number } {
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

export function createInspector(deps: InspectorDeps): Inspector {
  const settle = deps.settle ?? settleStory;
  const writeFile = deps.writeFile ?? defaultWriteFile;
  const now = deps.now ?? Date.now;

  return {
    async check(record, req) {
      assertReady(record);
      const stories = findStories(record, req.storyIds);
      const timeoutMs = req.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const results: CheckResult[] = [];
      const ctx = await deps.pool.acquire();
      try {
        await ctx.addInitScript(RECORDER_SCRIPT);
        const page = await ctx.newPage();
        for (const story of stories) {
          const t0 = now();
          const outcome = await settle(page, {
            iframeUrl: story.iframeUrl,
            waitFor: req.waitFor,
            timeoutMs,
          });
          const durationMs = now() - t0;
          if (outcome.kind === 'pass') {
            results.push({ storyId: story.id, status: 'pass', played: outcome.played, durationMs });
          } else if (outcome.kind === 'fail') {
            results.push({
              storyId: story.id,
              status: 'fail',
              played: false,
              durationMs,
              error:
                outcome.stack === undefined
                  ? { message: outcome.reason, event: outcome.event }
                  : { message: outcome.reason, event: outcome.event, stack: outcome.stack },
            });
          } else {
            // 'timeout' carries an optional lastPhase; settleStory's contract never resolves
            // 'pending' (its loop only returns on a terminal state or a timeout), but the type
            // allows it, so treat it the same as an unqualified timeout.
            const lastPhase = outcome.kind === 'timeout' ? outcome.lastPhase : undefined;
            results.push({
              storyId: story.id,
              status: 'timeout',
              played: false,
              durationMs,
              error: {
                message: `did not settle within ${timeoutMs}ms (last phase: ${lastPhase ?? 'none'})`,
                event: 'timeout',
              },
            });
          }
        }
      } finally {
        await ctx.close();
      }
      const summary = { pass: 0, fail: 0, timeout: 0 };
      for (const r of results) summary[r.status]++;
      return { instanceId: record.id, results, summary };
    },

    async screenshot(record, req) {
      assertReady(record);
      const [story] = findStories(record, [req.storyId]);
      const viewport = req.viewport ?? DEFAULT_VIEWPORT;
      const clip = req.clip ?? 'root';
      const timeoutMs = req.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const outPath =
        req.outPath ??
        join(
          record.configDir,
          'screenshots',
          `${story.id}-${viewport.width}x${viewport.height}.png`,
        );
      const t0 = now();
      const ctx = await deps.pool.acquire(viewport);
      let png: Buffer;
      try {
        await ctx.addInitScript(RECORDER_SCRIPT);
        const page = await ctx.newPage();
        const outcome = await settle(page, {
          iframeUrl: story.iframeUrl,
          waitFor: req.waitFor,
          timeoutMs,
        });
        if (outcome.kind === 'fail') {
          throw new StorybrokrError(
            'STORY_FAILED',
            `${story.id}: ${outcome.reason} (${outcome.event})`,
          );
        }
        if (outcome.kind === 'timeout') {
          throw new StorybrokrError(
            'STORY_TIMEOUT',
            `${story.id} did not settle within ${timeoutMs}ms (last phase: ${outcome.lastPhase ?? 'none'})`,
          );
        }
        if (clip === 'page') png = await page.screenshot({ fullPage: true });
        else if (clip === 'viewport') png = await page.screenshot({});
        else {
          // Capture #storybook-root as an element screenshot rather than computing a clip box:
          // locator.boundingBox() is viewport-relative, but Playwright's `clip` under
          // `fullPage: true` is document-relative, so combining them silently screenshots the
          // wrong region once the page is scrolled. locator.screenshot() lets Playwright convert
          // coordinates itself.
          const root = page.locator('#storybook-root');
          const box = await root.boundingBox();
          png =
            box && box.width > 0 && box.height > 0
              ? await root.screenshot()
              : await page.screenshot({});
        }
      } finally {
        await ctx.close();
      }
      try {
        await writeFile(outPath, png);
      } catch (err) {
        throw new StorybrokrError(
          'SCREENSHOT_WRITE_FAILED',
          `could not write ${outPath}: ${(err as Error).message}`,
        );
      }
      const { width, height } = pngSize(png);
      return {
        instanceId: record.id,
        storyId: story.id,
        path: outPath,
        width,
        height,
        durationMs: now() - t0,
      };
    },
  };
}
