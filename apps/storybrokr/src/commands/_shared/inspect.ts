import chalk from 'chalk';
import { InvalidArgumentError } from 'commander';
import { StorybrokrError } from '../../lib/errors.js';
import type { CheckResponse, ScreenshotClip, Viewport, WaitFor } from '../../types.js';

/** Commander parser for `--viewport WxH`. */
export function parseViewport(value: string): Viewport {
  const m = /^(\d+)[xX](\d+)$/.exec(value);
  const width = m ? Number(m[1]) : 0;
  const height = m ? Number(m[2]) : 0;
  if (!m || width < 1 || height < 1) {
    throw new InvalidArgumentError('must be WIDTHxHEIGHT, e.g. 1280x720');
  }
  return { width, height };
}

const CLIPS: ScreenshotClip[] = ['root', 'viewport', 'page'];

export function parseClip(value: string): ScreenshotClip {
  if ((CLIPS as string[]).includes(value)) return value as ScreenshotClip;
  throw new InvalidArgumentError(`must be one of ${CLIPS.join(', ')}`);
}

/** Commander accumulator for repeatable options (`--story a --story b`). */
export function collect(value: string, prev: string[]): string[] {
  return [...prev, value];
}

export function waitForFrom(o: {
  waitForText?: string;
  waitForSelector?: string;
}): WaitFor | undefined {
  if (o.waitForText !== undefined && o.waitForSelector !== undefined) {
    throw new StorybrokrError(
      'BAD_REQUEST',
      'give only one of --wait-for-text and --wait-for-selector',
    );
  }
  if (o.waitForText !== undefined) return { text: o.waitForText };
  if (o.waitForSelector !== undefined) return { selector: o.waitForSelector };
  return undefined;
}

const MARK = { pass: chalk.green('✓'), fail: chalk.red('✗'), timeout: chalk.yellow('⏱') } as const;

/** One line per story plus a summary line; colors are stripped under FORCE_COLOR=0. */
export function formatCheckResults(res: CheckResponse): string[] {
  const width = Math.max(...res.results.map((r) => r.storyId.length), 1);
  const lines = res.results.map((r) => {
    const head = `${MARK[r.status]} ${r.storyId.padEnd(width)}  ${r.durationMs}ms`;
    if (r.status === 'pass') return r.played ? `${head} (played)` : head;
    return `${head}  ${r.error?.message ?? ''}`;
  });
  const n = res.results.length;
  lines.push(
    `${n} ${n === 1 ? 'story' : 'stories'}: ${res.summary.pass} pass, ${res.summary.fail} fail, ${res.summary.timeout} timeout`,
  );
  return lines;
}
