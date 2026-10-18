import { describe, expect, it } from 'vitest';
import { guardPrompt } from './prompts.js';

describe('guardPrompt', () => {
  it('fails with instructions instead of opening a prompt when stdin is not a terminal', async () => {
    let called = false;
    const ask = guardPrompt(
      async () => {
        called = true;
        return true;
      },
      { isTTY: false },
    );
    await expect(ask({ message: 'Proceed?' })).rejects.toThrow(/--auto-approve/);
    expect(called).toBe(false);
  });

  it('passes through when a terminal is attached', async () => {
    const ask = guardPrompt(async (o: { message: string }) => o.message === 'Proceed?', {
      isTTY: true,
    });
    await expect(ask({ message: 'Proceed?' })).resolves.toBe(true);
  });
});
