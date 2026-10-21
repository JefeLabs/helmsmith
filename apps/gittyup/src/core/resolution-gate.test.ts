import { describe, expect, it } from 'vitest';
import { checkResolution } from './resolution-gate.js';

const sides = { ours: 'a\nb\nc\n', theirs: 'a\nB\nc\n' };

describe('checkResolution', () => {
  it('accepts a complete merged file', () => {
    expect(checkResolution('a\nb\nB\nc\n', sides)).toEqual({ ok: true });
  });

  it('rejects content that still contains conflict markers', () => {
    expect(checkResolution('a\n<<<<<<< HEAD\nb\n=======\nB\n>>>>>>> main\nc\n', sides)).toEqual({
      ok: false,
      reason: 'still contains conflict markers',
    });
  });

  it('sees markers on CRLF lines', () => {
    expect(checkResolution('a\r\n>>>>>>> main\r\nc\r\n', sides).ok).toBe(false);
  });

  it('rejects markers larger than the default size (conflict-marker-size > 7) (G7)', () => {
    const marked = 'a\n<<<<<<<< ours\nb\n========\nB\n>>>>>>>> main\nc\n';
    expect(checkResolution(marked, sides)).toEqual({
      ok: false,
      reason: 'still contains conflict markers',
    });
  });

  it('accepts a Setext/RST heading underline of exactly seven = signs (G18)', () => {
    const doc = 'Title\n=======\n\nbody line two\n';
    expect(checkResolution(doc, sides)).toEqual({ ok: true });
  });

  it('rejects an empty resolution when both sides have content', () => {
    expect(checkResolution('', sides)).toEqual({
      ok: false,
      reason: 'empty resolution while both sides have content',
    });
  });

  it('accepts an empty resolution when one side is empty', () => {
    expect(checkResolution('', { ours: '', theirs: 'x\n' })).toEqual({ ok: true });
  });

  it('rejects a single line when both sides are multi-line', () => {
    expect(checkResolution('just one line', sides)).toEqual({
      ok: false,
      reason: 'single line where both sides are multi-line',
    });
  });

  it('accepts a single line when a side is single-line', () => {
    expect(checkResolution('x', { ours: 'x', theirs: 'y\nz\n' })).toEqual({ ok: true });
  });

  it('does not treat a deleted side as content', () => {
    expect(checkResolution('', { ours: undefined, theirs: 'x\n' })).toEqual({ ok: true });
  });
});
