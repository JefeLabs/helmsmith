import { describe, expect, it } from 'vitest';
import { GittyupError } from '../core/errors.js';
import { createJsonOutput, type JsonIo, redirectConsoleToStderr, wantsJson } from './json.js';

const EXIT = new Error('exit called');

function fakeIo(): JsonIo & { out: string[]; err: string[]; exitCode: number | null } {
  const io = {
    out: [] as string[],
    err: [] as string[],
    exitCode: null as number | null,
    writeOut: (s: string) => {
      io.out.push(s);
    },
    writeErr: (s: string) => {
      io.err.push(s);
    },
    exit: (code: number): never => {
      io.exitCode = code;
      throw EXIT;
    },
  };
  return io;
}

describe('wantsJson', () => {
  it('finds --json but not after --', () => {
    expect(wantsJson(['status', '--json'])).toBe(true);
    expect(wantsJson(['status'])).toBe(false);
    expect(wantsJson(['repo', 'add', '--', '--json'])).toBe(false);
    expect(wantsJson(['repo', 'add', 'g', 'n', 'p', '--branches', '{"json":1}'])).toBe(false);
  });
});

describe('createJsonOutput', () => {
  it('emit writes one compact line, escaping newlines inside values', () => {
    const io = fakeIo();
    createJsonOutput(io).emit({ a: 'x\ny', n: null });
    expect(io.out).toEqual(['{"a":"x\\ny","n":null}\n']);
  });

  it('emit refuses a second document', () => {
    const out = createJsonOutput(fakeIo());
    out.emit({});
    expect(() => out.emit({})).toThrow(/twice/);
  });

  it('fail writes the error body to stderr and exits 2 for a refusal', () => {
    const io = fakeIo();
    expect(() => createJsonOutput(io).fail(new GittyupError('TARGET_UNKNOWN', 'nope'))).toThrow(
      EXIT,
    );
    expect(io.err).toEqual(['{"code":"TARGET_UNKNOWN","message":"nope"}\n']);
    expect(io.exitCode).toBe(2);
    expect(io.out).toEqual([]);
  });

  it('fail exits 1 for an unexpected error', () => {
    const io = fakeIo();
    expect(() => createJsonOutput(io).fail(new Error('boom'))).toThrow(EXIT);
    expect(io.err).toEqual(['{"code":"INTERNAL","message":"boom"}\n']);
    expect(io.exitCode).toBe(1);
  });
});

describe('redirectConsoleToStderr', () => {
  it('formats like console.log and restores', () => {
    const target = { log: (..._a: unknown[]) => {}, info: (..._a: unknown[]) => {} };
    const original = target.log;
    const err: string[] = [];
    const restore = redirectConsoleToStderr(target, (s) => err.push(s));
    target.log('a', 1, { b: 2 });
    target.info('i');
    expect(err).toEqual(['a 1 { b: 2 }\n', 'i\n']);
    restore();
    expect(target.log).toBe(original);
  });
});
