import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { readStdin } from './stdin.js';

describe('readStdin', () => {
  it('reads the whole stream as UTF-8, even a character split across chunks', async () => {
    const bytes = Buffer.from('{"label":"é"}');
    const at = bytes.indexOf(0xc3) + 1;
    expect(await readStdin(Readable.from([bytes.subarray(0, at), bytes.subarray(at)]))).toBe(
      '{"label":"é"}',
    );
  });

  it('reads an empty stream as an empty string', async () => {
    expect(await readStdin(Readable.from([]))).toBe('');
  });
});
