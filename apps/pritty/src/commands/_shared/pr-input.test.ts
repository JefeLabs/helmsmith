import { describe, expect, it } from 'vitest';
import { parsePrInput } from './pr-input.js';

const HINT = 'expected a JSON document on stdin: { "title": "…", "body": "…" }';

describe('parsePrInput', () => {
  it('reads title, body, draft and labels', () => {
    expect(
      parsePrInput(JSON.stringify({ title: 't', body: 'b', draft: true, labels: ['x'] })),
    ).toEqual({ title: 't', body: 'b', draft: true, labels: ['x'] });
  });

  it('refuses a body without a title', () => {
    expect(() => parsePrInput(JSON.stringify({ body: 'b' }))).toThrow(/title/);
    expect(() => parsePrInput(JSON.stringify({ title: '' }))).toThrow(/title/);
  });

  it('ignores the keys a dry run or an outcome prints, and unknown keys', () => {
    expect(
      parsePrInput(
        JSON.stringify({
          title: 't',
          dryRun: true,
          number: 4,
          url: 'u',
          created: true,
          head: 'h',
          base: 'b',
          other: 1,
        }),
      ),
    ).toEqual({ title: 't' });
  });

  it('refuses empty and non-JSON input with the stdin message', () => {
    expect(() => parsePrInput('')).toThrow(HINT);
    expect(() => parsePrInput('nope')).toThrow(HINT);
  });
});
