import { InvalidArgumentError } from 'commander';
import { describe, expect, it } from 'vitest';
import type { CheckResponse } from '../../types.js';
import { collect, formatCheckResults, parseClip, parseViewport, waitForFrom } from './inspect.js';

describe('inspect option parsers', () => {
  it('parses WxH viewports and rejects malformed ones', () => {
    expect(parseViewport('1280x720')).toEqual({ width: 1280, height: 720 });
    expect(parseViewport('375X812')).toEqual({ width: 375, height: 812 });
    for (const bad of ['1280', '0x10', 'axb', '1280x720x1', '-1x5'])
      expect(() => parseViewport(bad)).toThrow(InvalidArgumentError);
  });

  it('parses clip modes', () => {
    expect(parseClip('root')).toBe('root');
    expect(parseClip('page')).toBe('page');
    expect(() => parseClip('sideways')).toThrow(InvalidArgumentError);
  });

  it('collects repeatable options', () => {
    expect(collect('b', ['a'])).toEqual(['a', 'b']);
  });

  it('builds waitFor from exactly one of the two flags', () => {
    expect(waitForFrom({})).toBeUndefined();
    expect(waitForFrom({ waitForText: 'Go' })).toEqual({ text: 'Go' });
    expect(waitForFrom({ waitForSelector: 'h2' })).toEqual({ selector: 'h2' });
    expect(() => waitForFrom({ waitForText: 'a', waitForSelector: 'b' })).toThrow(/one of/);
  });
});

describe('formatCheckResults', () => {
  it('prints one line per story and a summary', () => {
    const res: CheckResponse = {
      instanceId: 'i',
      results: [
        { storyId: 'p--a', status: 'pass', played: false, durationMs: 120 },
        { storyId: 'p--b', status: 'pass', played: true, durationMs: 340 },
        {
          storyId: 'p--c',
          status: 'fail',
          played: false,
          durationMs: 310,
          error: { message: 'expected x', event: 'playFunctionThrewException' },
        },
        {
          storyId: 'p--d',
          status: 'timeout',
          played: false,
          durationMs: 30000,
          error: { message: 'did not settle', event: 'timeout' },
        },
      ],
      summary: { pass: 2, fail: 1, timeout: 1 },
    };
    const lines = formatCheckResults(res);
    expect(lines[0]).toMatch(/^✓ p--a\s+120ms$/);
    expect(lines[1]).toMatch(/^✓ p--b\s+340ms \(played\)$/);
    expect(lines[2]).toMatch(/^✗ p--c\s+310ms\s+expected x$/);
    expect(lines[3]).toMatch(/^⏱ p--d\s+30000ms\s+did not settle$/);
    expect(lines[4]).toBe('4 stories: 2 pass, 1 fail, 1 timeout');
  });
});
