import { afterEach, describe, expect, it, vi } from 'vitest';
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

describe('confirm', () => {
  const tty = process.stdin.isTTY;
  afterEach(() => {
    process.stdin.isTTY = tty;
    vi.doUnmock('@inquirer/prompts');
    vi.resetModules();
  });

  it('hands inquirer the prompt context, so a --json run can draw its prompt on stderr', async () => {
    vi.resetModules();
    vi.doMock('@inquirer/prompts', () => ({ confirm: vi.fn(async () => true), editor: vi.fn() }));
    process.stdin.isTTY = true;
    const { confirm } = await import('./prompts.js');
    const inquirer = await import('@inquirer/prompts');

    await expect(confirm({ message: 'Proceed?' }, { output: process.stderr })).resolves.toBe(true);
    expect(inquirer.confirm).toHaveBeenCalledWith(
      { message: 'Proceed?' },
      { output: process.stderr },
    );
  });
});

describe('input', () => {
  const tty = process.stdin.isTTY;
  afterEach(() => {
    process.stdin.isTTY = tty;
    vi.doUnmock('@inquirer/prompts');
    vi.resetModules();
  });

  it('asks through inquirer with the prompt context when a terminal is attached', async () => {
    vi.resetModules();
    vi.doMock('@inquirer/prompts', () => ({
      confirm: vi.fn(),
      editor: vi.fn(),
      input: vi.fn(async () => 'abc-1'),
    }));
    process.stdin.isTTY = true;
    const { input } = await import('./prompts.js');
    const inquirer = await import('@inquirer/prompts');

    await expect(input({ message: 'Label?' }, { output: process.stderr })).resolves.toBe('abc-1');
    expect(inquirer.input).toHaveBeenCalledWith({ message: 'Label?' }, { output: process.stderr });
  });

  it('fails with the unattended flag instead of asking when stdin is not a terminal', async () => {
    vi.resetModules();
    const ask = vi.fn();
    vi.doMock('@inquirer/prompts', () => ({ confirm: vi.fn(), editor: vi.fn(), input: ask }));
    process.stdin.isTTY = false;
    const { input } = await import('./prompts.js');

    await expect(input({ message: 'Label?' })).rejects.toThrow(/--auto-approve/);
    expect(ask).not.toHaveBeenCalled();
  });
});
