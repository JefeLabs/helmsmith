/**
 * CodexStreamParser unit tests.
 *
 * Fed with:
 *   - fixtures/error-402.jsonl — a REAL transcript captured from `codex exec
 *     --json` v0.133.0 (the ChatGPT workspace was deactivated → 402), exercising
 *     the real thread.started / turn.started / error / turn.failed envelope.
 *   - fixtures/simple-text.jsonl + tool-use.jsonl — item/usage shapes verified
 *     against the codex 0.133.0 binary's serde enums (agent_message/reasoning/
 *     command_execution ThreadItems; TokenUsage input/output/cached tokens).
 *   - hand-crafted edge cases: split lines, the dual item_type/type discriminator.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AuthError, BillingError, ProviderError, RateLimitError } from '../../errors.ts';
import type { AgentChunk } from '../../stream.ts';
import { reduceStream } from '../../stream.ts';
import {
  CodexStreamParser,
  classifyCodexError,
  getItemType,
  getToolName,
  isReconnectError,
  mapCodexUsage,
} from './stream-parser.ts';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

function fixtureLines(name: string): string[] {
  return readFileSync(join(FIXTURES, name), 'utf8')
    .split('\n')
    .filter((l) => l.trim().length > 0);
}

function parseLines(lines: string[]): AgentChunk[] {
  const parser = new CodexStreamParser();
  const out: AgentChunk[] = [];
  for (const line of lines) out.push(...parser.pushLine(line));
  out.push(...parser.flush());
  return out;
}

async function* fromArray(chunks: AgentChunk[]): AsyncIterable<AgentChunk> {
  for (const c of chunks) yield c;
}

// ---------------------------------------------------------------------------
// Verified-schema transcript: simple text
// ---------------------------------------------------------------------------

describe('CodexStreamParser — simple-text transcript', () => {
  it('skips thread/turn started, emits agent text + usage + stop', () => {
    expect(parseLines(fixtureLines('simple-text.jsonl'))).toEqual([
      { type: 'text-delta', text: 'pong' },
      { type: 'usage', usage: { inputTokens: 12, outputTokens: 3, cacheReadTokens: 4 } },
      { type: 'message-stop', finishReason: 'stop' },
    ]);
  });

  it('reduces to content="pong" with usage', async () => {
    const result = await reduceStream(fromArray(parseLines(fixtureLines('simple-text.jsonl'))));
    expect(result.content).toBe('pong');
    expect(result.finishReason).toBe('stop');
    expect(result.usage).toEqual({ inputTokens: 12, outputTokens: 3, cacheReadTokens: 4 });
  });
});

// ---------------------------------------------------------------------------
// Verified-schema transcript: reasoning + tool use
// ---------------------------------------------------------------------------

describe('CodexStreamParser — tool-use transcript', () => {
  it('emits thinking, tool-call-*, tool-result, text, usage, stop in order', () => {
    expect(parseLines(fixtureLines('tool-use.jsonl'))).toEqual([
      { type: 'thinking-delta', text: 'I should run echo hi.' },
      { type: 'tool-call-start', toolCallId: 'item_1', toolName: 'exec' },
      {
        type: 'tool-call-input',
        toolCallId: 'item_1',
        partialInput: JSON.stringify({ command: 'echo hi' }),
      },
      { type: 'tool-call-end', toolCallId: 'item_1', input: { command: 'echo hi' } },
      {
        type: 'tool-result',
        toolCallId: 'item_1',
        output: { status: 'completed', aggregatedOutput: 'hi\n', exitCode: 0 },
      },
      { type: 'text-delta', text: '`hi`' },
      { type: 'usage', usage: { inputTokens: 20, outputTokens: 15, cacheReadTokens: 0 } },
      { type: 'message-stop', finishReason: 'stop' },
    ]);
  });

  it('reduceStream builds tool-use + thinking + text blocks', async () => {
    const result = await reduceStream(fromArray(parseLines(fixtureLines('tool-use.jsonl'))));
    expect(result.content).toBe('`hi`');
    expect(result.contentBlocks?.find((b) => b.type === 'tool-use')).toMatchObject({
      type: 'tool-use',
      id: 'item_1',
      name: 'exec',
      input: { command: 'echo hi' },
    });
    expect(result.contentBlocks?.find((b) => b.type === 'thinking')).toMatchObject({
      type: 'thinking',
      thinking: 'I should run echo hi.',
    });
  });
});

// ---------------------------------------------------------------------------
// REAL captured 402 transcript
// ---------------------------------------------------------------------------

describe('CodexStreamParser — real 402 (deactivated_workspace) transcript', () => {
  it('classifies the 402 Payment Required error events as BillingError', () => {
    const chunks = parseLines(fixtureLines('error-402.jsonl'));
    // Every error + the final turn.failed maps to an error chunk; all 402.
    expect(chunks.length).toBeGreaterThan(0);
    for (const c of chunks) {
      expect(c.type).toBe('error');
      expect((c as { error: unknown }).error).toBeInstanceOf(BillingError);
    }
  });

  it('reduceStream rejects with the first BillingError', async () => {
    const chunks = parseLines(fixtureLines('error-402.jsonl'));
    await expect(reduceStream(fromArray(chunks))).rejects.toBeInstanceOf(BillingError);
  });
});

// ---------------------------------------------------------------------------
// Reconnect error is non-terminal (only turn.failed is terminal)
// ---------------------------------------------------------------------------

describe('CodexStreamParser — reconnect error is non-terminal', () => {
  it('skips a standalone reconnecting error and still completes the turn', () => {
    const chunks = parseLines([
      JSON.stringify({ type: 'thread.started', thread_id: 't1' }),
      JSON.stringify({ type: 'turn.started' }),
      JSON.stringify({ type: 'error', message: 'Reconnecting…' }),
      JSON.stringify({
        type: 'item.completed',
        item: { id: 'i0', item_type: 'agent_message', text: 'recovered' },
      }),
      JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 3, output_tokens: 4 } }),
    ]);
    // The reconnect produced NO error chunk; the turn completed normally.
    expect(chunks).toEqual([
      { type: 'text-delta', text: 'recovered' },
      { type: 'usage', usage: { inputTokens: 3, outputTokens: 4 } },
      { type: 'message-stop', finishReason: 'stop' },
    ]);
    expect(chunks.some((c) => c.type === 'error')).toBe(false);
  });

  it('keeps turn.failed terminal even when its message mentions reconnect', () => {
    const chunks = parseLines([
      JSON.stringify({ type: 'turn.failed', error: { message: 'reconnect attempts exhausted' } }),
    ]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.type).toBe('error');
  });
});

describe('isReconnectError', () => {
  it('matches reconnecting messages, not unrelated errors', () => {
    expect(isReconnectError('Reconnecting…')).toBe(true);
    expect(isReconnectError('stream disconnected, reconnecting')).toBe(true);
    expect(isReconnectError('402 Payment Required')).toBe(false);
    expect(isReconnectError('')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Split lines + discriminator fallback
// ---------------------------------------------------------------------------

describe('CodexStreamParser — push() reassembles split lines', () => {
  it('produces the same chunks fed byte-by-byte', () => {
    const whole = `${fixtureLines('simple-text.jsonl').join('\n')}\n`;
    const expected = parseLines(fixtureLines('simple-text.jsonl'));
    const parser = new CodexStreamParser();
    const got: AgentChunk[] = [];
    for (const ch of whole) got.push(...parser.push(ch));
    got.push(...parser.flush());
    expect(got).toEqual(expected);
  });
});

describe('CodexStreamParser — item type discriminator', () => {
  it('accepts the modern `type` discriminator for the assistant message', () => {
    const chunks = parseLines([
      JSON.stringify({
        type: 'item.completed',
        item: { id: 'i0', type: 'agent_message', text: 'hey' },
      }),
    ]);
    expect(chunks).toEqual([{ type: 'text-delta', text: 'hey' }]);
  });

  it('skips an unknown item type', () => {
    const chunks = parseLines([
      JSON.stringify({ type: 'item.completed', item: { id: 'i0', item_type: 'todo_list' } }),
    ]);
    expect(chunks).toEqual([]);
  });

  it('skips a non-JSON stdout line without throwing', () => {
    expect(parseLines(['not json', '{"type":"turn.started"}'])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe('getItemType', () => {
  it('prefers item_type, falls back to type', () => {
    expect(getItemType({ item_type: 'agent_message', type: 'x' })).toBe('agent_message');
    expect(getItemType({ type: 'reasoning' })).toBe('reasoning');
    expect(getItemType({})).toBeUndefined();
  });
});

describe('getToolName', () => {
  it.each([
    ['command_execution', 'exec'],
    ['file_change', 'patch'],
    ['mcp_tool_call', 'mcp_tool'],
    ['web_search', 'web_search'],
  ] as const)('maps %s → %s', (input, expected) => {
    expect(getToolName(input)).toBe(expected);
  });
});

describe('mapCodexUsage', () => {
  it('maps token fields incl. cached → cacheReadTokens', () => {
    expect(mapCodexUsage({ input_tokens: 12, output_tokens: 3, cached_input_tokens: 4 })).toEqual({
      inputTokens: 12,
      outputTokens: 3,
      cacheReadTokens: 4,
    });
  });
  it('omits cacheReadTokens when absent; returns undefined for empty', () => {
    expect(mapCodexUsage({ input_tokens: 1, output_tokens: 2 })).toEqual({
      inputTokens: 1,
      outputTokens: 2,
    });
    expect(mapCodexUsage(undefined)).toBeUndefined();
  });
});

describe('classifyCodexError', () => {
  it('classifies auth, billing (402/deactivated), rate-limit, generic', () => {
    expect(classifyCodexError('401 Unauthorized')).toBeInstanceOf(AuthError);
    expect(
      classifyCodexError('402 Payment Required: {"detail":{"code":"deactivated_workspace"}}'),
    ).toBeInstanceOf(BillingError);
    expect(classifyCodexError('429 rate limit exceeded')).toBeInstanceOf(RateLimitError);
    expect(classifyCodexError('some other failure')).toBeInstanceOf(ProviderError);
  });
});
