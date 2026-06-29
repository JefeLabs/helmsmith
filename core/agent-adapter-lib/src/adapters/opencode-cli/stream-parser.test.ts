/**
 * OpencodeStreamParser unit tests.
 *
 * Fed with REAL `opencode run --format json` transcripts captured from
 * v1.17.5 (fixtures/*.jsonl) plus hand-crafted edge cases: a multi-step
 * tool-use turn (per-step usage accumulation), a reasoning event, lines split
 * across stdout chunks, non-JSON log noise, and classified error events.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AuthError, BillingError, ConfigError, ProviderError } from '../../errors.ts';
import type { AgentChunk } from '../../stream.ts';
import { reduceStream } from '../../stream.ts';
import {
  classifyOpencodeError,
  classifyOpencodeMessage,
  isContinuationReason,
  mapStopReason,
  mapTokens,
  OpencodeStreamParser,
} from './stream-parser.ts';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

function fixtureLines(name: string): string[] {
  return readFileSync(join(FIXTURES, name), 'utf8')
    .split('\n')
    .filter((l) => l.trim().length > 0);
}

function parseLines(lines: string[]): AgentChunk[] {
  const parser = new OpencodeStreamParser();
  const out: AgentChunk[] = [];
  for (const line of lines) out.push(...parser.pushLine(line));
  out.push(...parser.flush());
  return out;
}

async function* fromArray(chunks: AgentChunk[]): AsyncIterable<AgentChunk> {
  for (const c of chunks) yield c;
}

// ---------------------------------------------------------------------------
// Real transcript: simple text
// ---------------------------------------------------------------------------

describe('OpencodeStreamParser — real simple-text transcript', () => {
  it('skips step_start and emits text + usage + message-stop', () => {
    const chunks = parseLines(fixtureLines('simple-text.jsonl'));
    expect(chunks).toEqual([
      { type: 'text-delta', text: 'pong' },
      {
        type: 'usage',
        usage: { inputTokens: 6226, outputTokens: 7, cacheReadTokens: 0, cacheWriteTokens: 0 },
      },
      { type: 'message-stop', finishReason: 'stop' },
    ]);
  });

  it('reduces to content="pong", finishReason="stop", usage', async () => {
    const result = await reduceStream(fromArray(parseLines(fixtureLines('simple-text.jsonl'))));
    expect(result.content).toBe('pong');
    expect(result.finishReason).toBe('stop');
    expect(result.usage).toEqual({
      inputTokens: 6226,
      outputTokens: 7,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
  });
});

// ---------------------------------------------------------------------------
// Real transcript: multi-step tool use (per-step usage accumulation)
// ---------------------------------------------------------------------------

describe('OpencodeStreamParser — real tool-use transcript', () => {
  it('emits the tool sequence, accumulates per-step usage, and ends once', () => {
    const chunks = parseLines(fixtureLines('tool-use.jsonl'));
    expect(chunks).toEqual([
      { type: 'tool-call-start', toolCallId: 'call_elElia8ZeQSnQOl7aNS1nrnS', toolName: 'read' },
      {
        type: 'tool-call-input',
        toolCallId: 'call_elElia8ZeQSnQOl7aNS1nrnS',
        partialInput: JSON.stringify({ filePath: '/private/tmp/oc-test/note.txt' }),
      },
      {
        type: 'tool-call-end',
        toolCallId: 'call_elElia8ZeQSnQOl7aNS1nrnS',
        input: { filePath: '/private/tmp/oc-test/note.txt' },
      },
      {
        type: 'tool-result',
        toolCallId: 'call_elElia8ZeQSnQOl7aNS1nrnS',
        output:
          '<path>/private/tmp/oc-test/note.txt</path>\n<type>file</type>\n<content>\n1: secret-marker-42\n\n(End of file - total 1 lines)\n</content>',
      },
      // The intermediate step_finish (reason 'tool-calls') emits nothing.
      { type: 'text-delta', text: 'The marker in `note.txt` is `secret-marker-42`.' },
      // Cumulative usage = step1 (598/28/5632) + step2 (166/18/6144).
      {
        type: 'usage',
        usage: {
          inputTokens: 764,
          outputTokens: 46,
          cacheReadTokens: 11776,
          cacheWriteTokens: 0,
        },
      },
      { type: 'message-stop', finishReason: 'stop' },
    ]);
  });

  it('reduceStream builds the tool-use + text content blocks', async () => {
    const result = await reduceStream(fromArray(parseLines(fixtureLines('tool-use.jsonl'))));
    expect(result.content).toBe('The marker in `note.txt` is `secret-marker-42`.');
    expect(result.usage?.inputTokens).toBe(764);
    const toolBlock = result.contentBlocks?.find((b) => b.type === 'tool-use');
    expect(toolBlock).toMatchObject({
      type: 'tool-use',
      id: 'call_elElia8ZeQSnQOl7aNS1nrnS',
      name: 'read',
      input: { filePath: '/private/tmp/oc-test/note.txt' },
    });
  });
});

// ---------------------------------------------------------------------------
// Reasoning event → thinking-delta (crafted: real reasoning text is hidden)
// ---------------------------------------------------------------------------

describe('OpencodeStreamParser — reasoning', () => {
  it('maps a non-empty reasoning event to a thinking-delta', () => {
    const chunks = parseLines([
      JSON.stringify({ type: 'reasoning', part: { type: 'reasoning', text: 'Let me think.' } }),
      JSON.stringify({ type: 'text', part: { type: 'text', text: 'answer' } }),
      JSON.stringify({
        type: 'step_finish',
        part: { type: 'step-finish', reason: 'stop', tokens: { input: 1, output: 2 } },
      }),
    ]);
    expect(chunks[0]).toEqual({ type: 'thinking-delta', text: 'Let me think.' });
    expect(chunks[1]).toEqual({ type: 'text-delta', text: 'answer' });
  });

  it('drops an empty reasoning event (hidden provider reasoning)', () => {
    const chunks = parseLines([
      JSON.stringify({ type: 'reasoning', part: { type: 'reasoning', text: '' } }),
    ]);
    expect(chunks).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Lines split across stdout chunks
// ---------------------------------------------------------------------------

describe('OpencodeStreamParser — push() reassembles split lines', () => {
  it('produces the same chunks fed whole or character-by-character', () => {
    const lines = fixtureLines('simple-text.jsonl');
    const whole = `${lines.join('\n')}\n`;
    const expected = parseLines(lines);

    const parser = new OpencodeStreamParser();
    const got: AgentChunk[] = [];
    for (const ch of whole) got.push(...parser.push(ch));
    got.push(...parser.flush());

    expect(got).toEqual(expected);
  });

  it('buffers a JSON object split across two chunks', () => {
    const parser = new OpencodeStreamParser();
    const line = JSON.stringify({ type: 'text', part: { type: 'text', text: 'hello world' } });
    const mid = Math.floor(line.length / 2);

    expect(parser.push(line.slice(0, mid))).toEqual([]);
    expect(parser.push(`${line.slice(mid)}\n`)).toEqual([
      { type: 'text-delta', text: 'hello world' },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Error events + noise
// ---------------------------------------------------------------------------

describe('OpencodeStreamParser — error handling', () => {
  it('classifies the real 402 error fixture as a BillingError chunk', () => {
    const chunks = parseLines(fixtureLines('error-402.jsonl'));
    expect(chunks).toHaveLength(1);
    expect(chunks[0].type).toBe('error');
    expect((chunks[0] as { error: unknown }).error).toBeInstanceOf(BillingError);
  });

  it('maps a 401 APIError to an AuthError chunk', () => {
    const line = JSON.stringify({
      type: 'error',
      error: { name: 'APIError', data: { message: 'Unauthorized', statusCode: 401 } },
    });
    expect((parseLines([line])[0] as { error: unknown }).error).toBeInstanceOf(AuthError);
  });

  it('maps ProviderModelNotFoundError (no statusCode) to a ConfigError chunk', () => {
    const line = JSON.stringify({
      type: 'error',
      error: { name: 'UnknownError', data: { message: 'ProviderModelNotFoundError', ref: 'x' } },
    });
    expect((parseLines([line])[0] as { error: unknown }).error).toBeInstanceOf(ConfigError);
  });

  it('skips pino-style non-JSON log lines on stdout without throwing', () => {
    const chunks = parseLines([
      '[12:00:00.000] ERROR (#1): failed {',
      JSON.stringify({ type: 'text', part: { type: 'text', text: 'ok' } }),
    ]);
    expect(chunks).toEqual([{ type: 'text-delta', text: 'ok' }]);
  });

  it('reduceStream throws the embedded error for an error chunk', async () => {
    const chunks = parseLines(fixtureLines('error-402.jsonl'));
    await expect(reduceStream(fromArray(chunks))).rejects.toBeInstanceOf(BillingError);
  });
});

// ---------------------------------------------------------------------------
// flush() emits accumulated-but-unsent usage (cut-off mid-turn)
// ---------------------------------------------------------------------------

describe('OpencodeStreamParser — flush', () => {
  it('emits accumulated usage when the stream ends on a tool-calls step', () => {
    const parser = new OpencodeStreamParser();
    const mid = parser.pushLine(
      JSON.stringify({
        type: 'step_finish',
        part: { type: 'step-finish', reason: 'tool-calls', tokens: { input: 5, output: 1 } },
      }),
    );
    expect(mid).toEqual([]); // intermediate — no terminal yet
    expect(parser.flush()).toEqual([{ type: 'usage', usage: { inputTokens: 5, outputTokens: 1 } }]);
  });
});

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe('mapStopReason', () => {
  it.each([
    ['stop', 'stop'],
    ['length', 'length'],
    ['max-tokens', 'length'],
    ['tool-calls', 'tool_use'],
    ['content-filter', 'content_filter'],
    ['aborted', 'aborted'],
    ['error', 'error'],
    [null, 'stop'],
    [undefined, 'stop'],
    ['mystery', 'stop'],
  ] as const)('maps %s → %s', (input, expected) => {
    expect(mapStopReason(input)).toBe(expected);
  });
});

describe('isContinuationReason', () => {
  it('is true only for tool-calls', () => {
    expect(isContinuationReason('tool-calls')).toBe(true);
    expect(isContinuationReason('tool_calls')).toBe(true);
    expect(isContinuationReason('stop')).toBe(false);
    expect(isContinuationReason(undefined)).toBe(false);
  });
});

describe('mapTokens', () => {
  it('maps token + cache fields and omits absent cache', () => {
    expect(mapTokens({ input: 10, output: 20, cache: { read: 3 } })).toEqual({
      inputTokens: 10,
      outputTokens: 20,
      cacheReadTokens: 3,
    });
    expect(mapTokens({ input: 1, output: 2 })).toEqual({ inputTokens: 1, outputTokens: 2 });
    expect(mapTokens(undefined)).toBeUndefined();
  });
});

describe('classifyOpencodeError / classifyOpencodeMessage', () => {
  it('prefers statusCode, then name, then message string', () => {
    expect(classifyOpencodeError('APIError', { statusCode: 402, message: 'x' })).toBeInstanceOf(
      BillingError,
    );
    expect(classifyOpencodeError('ProviderModelNotFoundError', {})).toBeInstanceOf(ConfigError);
    expect(classifyOpencodeMessage('opencode-cli: not logged in')).toBeInstanceOf(AuthError);
    expect(classifyOpencodeMessage('opencode-cli: weird failure')).toBeInstanceOf(ProviderError);
  });
});
