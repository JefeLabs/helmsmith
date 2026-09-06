import { describe, expect, it } from 'vitest';
import { LogBuffer } from './logbuffer.js';

describe('LogBuffer', () => {
  it('splits chunks into lines, keeps a partial trailing line, and caps capacity', () => {
    const buf = new LogBuffer(3);
    buf.push('a\nb\nc');
    expect(buf.lines).toEqual(['a', 'b']);
    buf.push('c-rest\nd\n');
    expect(buf.lines).toEqual(['b', 'cc-rest', 'd']);
    expect(buf.tail(2)).toEqual(['cc-rest', 'd']);
  });

  it('notifies line listeners and lets them unsubscribe', () => {
    const buf = new LogBuffer();
    const seen: string[] = [];
    const off = buf.onLine((l) => seen.push(l));
    buf.push('one\ntwo\n');
    off();
    buf.push('three\n');
    expect(seen).toEqual(['one', 'two']);
  });

  it('strips a trailing \\r from CRLF-terminated lines', () => {
    const buf = new LogBuffer();
    buf.push('a\r\nb\r\n');
    expect(buf.lines).toEqual(['a', 'b']);
  });

  it('removes a listener that throws, leaving other listeners and later lines unaffected', () => {
    const buf = new LogBuffer();
    let throwingCalls = 0;
    buf.onLine(() => {
      throwingCalls += 1;
      throw new Error('boom');
    });
    const seen: string[] = [];
    buf.onLine((l) => seen.push(l));

    buf.push('x\ny\n');
    expect(seen).toEqual(['x', 'y']);
    expect(buf.lines).toEqual(['x', 'y']);
    expect(throwingCalls).toBe(1);

    buf.push('z\n');
    expect(throwingCalls).toBe(1);
  });
});
