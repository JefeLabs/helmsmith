import { resolve } from 'node:path';
import type { Command } from 'commander';
import type { DaemonClient } from '../client/index.js';
import type { ScreenshotClip, Viewport } from '../types.js';
import { parseClip, parseViewport, waitForFrom } from './_shared/inspect.js';
import { fail, parseIntegerInRange, printJson } from './_shared/output.js';

interface ScreenshotOpts {
  out?: string;
  viewport?: Viewport;
  clip?: ScreenshotClip;
  waitForText?: string;
  waitForSelector?: string;
  timeout?: number;
  json?: boolean;
}

export function registerScreenshot(program: Command, connect: () => Promise<DaemonClient>): void {
  program
    .command('screenshot <id-or-path> <story-id>')
    .description('Write a PNG of one story at the requested viewport')
    .option(
      '--out <path>',
      'output file (default: <instance configDir>/screenshots/<story>-<WxH>.png)',
    )
    .option('--viewport <WxH>', 'viewport size (default 1280x720)', parseViewport)
    .option('--clip <mode>', 'root | viewport | page (default root)', parseClip)
    .option('--wait-for-text <text>', 'after render, also wait for this visible text')
    .option('--wait-for-selector <selector>', 'after render, also wait for this selector')
    .option(
      '--timeout <ms>',
      'settle budget, 1000-300000 (default 30000)',
      parseIntegerInRange(1000, 300_000),
    )
    .option('--json', 'print JSON')
    .action(async (idOrPath: string, storyId: string, o: ScreenshotOpts) => {
      try {
        // The daemon's cwd is meaningless to the caller: resolve relative paths here.
        const outPath = o.out === undefined ? undefined : resolve(process.cwd(), o.out);
        const res = await (await connect()).screenshot(idOrPath, {
          storyId,
          outPath,
          viewport: o.viewport,
          clip: o.clip,
          waitFor: waitForFrom(o),
          timeoutMs: o.timeout,
        });
        if (o.json) printJson(res);
        else console.log(res.path);
      } catch (err) {
        fail(err, Boolean(o.json));
      }
    });
}
