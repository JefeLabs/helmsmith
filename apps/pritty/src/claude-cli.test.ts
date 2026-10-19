import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createClaudeCliAdapter, findClaudeBinary } from './claude-cli.js';

/**
 * The `claude` provider spawns the Claude Code binary headlessly on the
 * developer's own login. A fake binary records what it was given and answers
 * with a canned `--output-format json` array.
 */

const RESULT_OK = [
  { type: 'system', subtype: 'init' },
  { type: 'assistant' },
  {
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: '{"message":"feat: hello"}',
    num_turns: 1,
    modelUsage: { 'claude-opus-5-5': {} },
  },
];

let dir: string;
let binary: string;

function fakeClaude(response: unknown): void {
  writeFileSync(join(dir, 'response.json'), JSON.stringify(response));
  writeFileSync(
    binary,
    [
      '#!/bin/sh',
      `printf '%s\\n' "$@" > "${dir}/argv"`,
      `cat > "${dir}/stdin"`,
      `env > "${dir}/env"`,
      'if [ -n "$FAKE_CLAUDE_EXIT" ]; then echo "boom from fake" >&2; exit "$FAKE_CLAUDE_EXIT"; fi',
      `cat "${dir}/response.json"`,
      '',
    ].join('\n'),
  );
  chmodSync(binary, 0o755);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pritty-claude-cli-'));
  binary = join(dir, 'claude');
});

afterEach(() => {
  delete process.env.FAKE_CLAUDE_EXIT;
  rmSync(dir, { recursive: true, force: true });
});

describe('findClaudeBinary', () => {
  it('returns the first executable named claude on PATH, or null', () => {
    fakeClaude(RESULT_OK);
    expect(findClaudeBinary(`${dir}:/nonexistent`)).toBe(binary);
    expect(findClaudeBinary('/nonexistent')).toBeNull();
  });
});

describe('createClaudeCliAdapter', () => {
  it('sends the prompt on stdin and the model, system prompt and headless flags as arguments', async () => {
    fakeClaude(RESULT_OK);
    process.env.CLAUDECODE = '1';
    const adapter = createClaudeCliAdapter({
      binary,
      model: 'claude-opus-5-5',
      timeoutMs: 10_000,
      cwd: dir,
    });
    const result = await adapter.invoke({
      messages: [{ role: 'user', content: 'DIFF HERE' }],
      systemPrompt: 'You write commit messages.',
    });
    delete process.env.CLAUDECODE;

    expect(result.content).toBe('{"message":"feat: hello"}');
    const argv = readFileSync(join(dir, 'argv'), 'utf8').split('\n');
    expect(argv).toContain('-p');
    expect(argv.slice(argv.indexOf('--model'))[1]).toBe('claude-opus-5-5');
    expect(argv.slice(argv.indexOf('--system-prompt'))[1]).toBe('You write commit messages.');
    expect(argv.slice(argv.indexOf('--output-format'))[1]).toBe('json');
    expect(argv.slice(argv.indexOf('--max-turns'))[1]).toBe('1');
    expect(argv).toContain('--strict-mcp-config');
    expect(argv).toContain('--no-session-persistence');
    expect(argv).toContain('--tools');
    expect(readFileSync(join(dir, 'stdin'), 'utf8')).toBe('DIFF HERE');
    // Runs from inside a Claude Code session too: the nesting guards are dropped.
    expect(readFileSync(join(dir, 'env'), 'utf8')).not.toMatch(/^CLAUDECODE=/m);
  });

  it('reports the adapter type claude-cli', () => {
    fakeClaude(RESULT_OK);
    expect(createClaudeCliAdapter({ binary, model: 'm', timeoutMs: 1000, cwd: dir }).type).toBe(
      'claude-cli',
    );
  });

  it('throws with stderr when the binary exits non-zero', async () => {
    fakeClaude(RESULT_OK);
    process.env.FAKE_CLAUDE_EXIT = '3';
    const adapter = createClaudeCliAdapter({ binary, model: 'm', timeoutMs: 10_000, cwd: dir });
    await expect(adapter.invoke({ messages: [{ role: 'user', content: 'x' }] })).rejects.toThrow(
      /claude exited with code 3[\s\S]*boom from fake/,
    );
  });

  it('throws when the result message reports an error', async () => {
    fakeClaude([
      { type: 'result', subtype: 'error_during_execution', is_error: true, result: 'quota' },
    ]);
    const adapter = createClaudeCliAdapter({ binary, model: 'm', timeoutMs: 10_000, cwd: dir });
    await expect(adapter.invoke({ messages: [{ role: 'user', content: 'x' }] })).rejects.toThrow(
      /claude reported error_during_execution: quota/,
    );
  });

  it('throws when the output has no result message', async () => {
    fakeClaude([{ type: 'system', subtype: 'init' }]);
    const adapter = createClaudeCliAdapter({ binary, model: 'm', timeoutMs: 10_000, cwd: dir });
    await expect(adapter.invoke({ messages: [{ role: 'user', content: 'x' }] })).rejects.toThrow(
      /no result message/,
    );
  });

  it('throws when the binary is missing', async () => {
    const adapter = createClaudeCliAdapter({
      binary: join(dir, 'missing'),
      model: 'm',
      timeoutMs: 10_000,
      cwd: dir,
    });
    await expect(adapter.invoke({ messages: [{ role: 'user', content: 'x' }] })).rejects.toThrow(
      /missing/,
    );
  });
});
