/**
 * GeminiStreamParser unit tests.
 *
 * Fed with stream-json transcripts whose event shapes are verified against
 * @google/gemini-cli-core's JsonStreamEventType (init/message/tool_use/
 * tool_result/error/result) — see fixtures/*.jsonl — plus hand-crafted edge
 * cases: lines split across stdout chunks, a tool sequence, warning vs error
 * severity, an error result, and the delta-then-aggregate de-dup.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AuthError, BillingError, ProviderError, RateLimitError } from '../../errors.ts';
import type { AgentChunk } from '../../stream.ts';
import { reduceStream } from '../../stream.ts';
import {
  classifyGeminiError,
  GeminiStreamParser,
  mapGeminiFinishReason,
  mapGeminiUsage,
} from './stream-parser.ts';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

function fixtureLines(name: string): string[] {
  return readFileSync(join(FIXTURES, name), 'utf8')
    .split('\n')
    .filter((l) => l.trim().length > 0);
}

function parseLines(lines: string[]): AgentChunk[] {
  const parser = new GeminiStreamParser();
  const out: AgentChunk[] = [];
  for (const line of lines) out.push(...parser.pushLine(line));
  out.push(...parser.flush());
  return out;
}

async function* fromArray(chunks: AgentChunk[]): AsyncIterable<AgentChunk> {
  for (const c of chunks) yield c;
}

// ---------------------------------------------------------------------------
// Real-schema transcript: simple text
// ---------------------------------------------------------------------------

describe('GeminiStreamParser — simple-text transcript', () => {
  it('skips init + user echo, emits assistant text + usage + stop', () => {
    const chunks = parseLines(fixtureLines('simple-text.jsonl'));
    expect(chunks).toEqual([
      { type: 'text-delta', text: 'pong' },
      { type: 'usage', usage: { inputTokens: 8, outputTokens: 5 } },
      { type: 'message-stop', finishReason: 'stop' },
    ]);
  });

  it('reduces to content="pong", finishReason="stop", usage', async () => {
    const result = await reduceStream(fromArray(parseLines(fixtureLines('simple-text.jsonl'))));
    expect(result.content).toBe('pong');
    expect(result.finishReason).toBe('stop');
    expect(result.usage).toEqual({ inputTokens: 8, outputTokens: 5 });
  });
});

// ---------------------------------------------------------------------------
// Real-schema transcript: tool use
// ---------------------------------------------------------------------------

describe('GeminiStreamParser — tool-use transcript', () => {
  it('emits tool-call-*, tool-result, text, usage, stop in order', () => {
    const chunks = parseLines(fixtureLines('tool-use.jsonl'));
    expect(chunks).toEqual([
      { type: 'tool-call-start', toolCallId: 'tool-1', toolName: 'run_shell_command' },
      {
        type: 'tool-call-input',
        toolCallId: 'tool-1',
        partialInput: JSON.stringify({ command: 'echo hi' }),
      },
      { type: 'tool-call-end', toolCallId: 'tool-1', input: { command: 'echo hi' } },
      { type: 'tool-result', toolCallId: 'tool-1', output: 'hi' },
      { type: 'text-delta', text: '`hi`' },
      { type: 'usage', usage: { inputTokens: 10, outputTokens: 20 } },
      { type: 'message-stop', finishReason: 'stop' },
    ]);
  });

  it('reduceStream builds a tool-use content block', async () => {
    const result = await reduceStream(fromArray(parseLines(fixtureLines('tool-use.jsonl'))));
    expect(result.content).toBe('`hi`');
    expect(result.contentBlocks?.find((b) => b.type === 'tool-use')).toMatchObject({
      type: 'tool-use',
      id: 'tool-1',
      name: 'run_shell_command',
      input: { command: 'echo hi' },
    });
  });
});

// ---------------------------------------------------------------------------
// Lines split across stdout chunks
// ---------------------------------------------------------------------------

describe('GeminiStreamParser — push() reassembles split lines', () => {
  it('produces the same chunks fed byte-by-byte', () => {
    const whole = `${fixtureLines('simple-text.jsonl').join('\n')}\n`;
    const expected = parseLines(fixtureLines('simple-text.jsonl'));
    const parser = new GeminiStreamParser();
    const got: AgentChunk[] = [];
    for (const ch of whole) got.push(...parser.push(ch));
    got.push(...parser.flush());
    expect(got).toEqual(expected);
  });
});

// ---------------------------------------------------------------------------
// Assistant delta-then-aggregate de-dup
// ---------------------------------------------------------------------------

describe('GeminiStreamParser — assistant text de-dup', () => {
  it('concatenates delta events and skips a trailing non-delta aggregate', () => {
    const lines = [
      JSON.stringify({ type: 'message', role: 'assistant', content: 'po', delta: true }),
      JSON.stringify({ type: 'message', role: 'assistant', content: 'ng', delta: true }),
      // Trailing aggregate full message AFTER deltas → skipped.
      JSON.stringify({ type: 'message', role: 'assistant', content: 'pong' }),
      JSON.stringify({ type: 'result', status: 'success' }),
    ];
    const chunks = parseLines(lines);
    expect(chunks).toEqual([
      { type: 'text-delta', text: 'po' },
      { type: 'text-delta', text: 'ng' },
      { type: 'message-stop', finishReason: 'stop' },
    ]);
  });

  it('emits a single full non-delta assistant message when no deltas were seen', () => {
    const chunks = parseLines([
      JSON.stringify({ type: 'message', role: 'assistant', content: 'pong' }),
    ]);
    expect(chunks).toEqual([{ type: 'text-delta', text: 'pong' }]);
  });
});

// ---------------------------------------------------------------------------
// Error / warning handling
// ---------------------------------------------------------------------------

describe('GeminiStreamParser — error handling', () => {
  it('drops a warning-severity error event (non-terminal)', () => {
    const chunks = parseLines([
      JSON.stringify({ type: 'error', severity: 'warning', message: 'Loop detected' }),
    ]);
    expect(chunks).toEqual([]);
  });

  it('maps an error-severity event to an error chunk', () => {
    const chunks = parseLines([
      JSON.stringify({ type: 'error', severity: 'error', message: 'API key not valid' }),
    ]);
    expect(chunks).toHaveLength(1);
    expect((chunks[0] as { error: unknown }).error).toBeInstanceOf(AuthError);
  });

  it('emits usage before the error chunk on an error result', () => {
    const chunks = parseLines([
      JSON.stringify({
        type: 'result',
        status: 'error',
        error: { type: 'RateLimit', message: 'Resource exhausted (429)' },
        stats: { input_tokens: 5, output_tokens: 0 },
      }),
    ]);
    expect(chunks[0]).toEqual({ type: 'usage', usage: { inputTokens: 5, outputTokens: 0 } });
    expect((chunks[1] as { error: unknown }).error).toBeInstanceOf(RateLimitError);
  });

  it('skips a non-JSON stdout line without throwing', () => {
    expect(parseLines(['not json at all', '{"type":"init","model":"x"}'])).toEqual([]);
  });

  it('reduceStream throws the embedded error chunk', async () => {
    const chunks = parseLines([
      JSON.stringify({ type: 'error', severity: 'error', message: 'weird failure' }),
    ]);
    await expect(reduceStream(fromArray(chunks))).rejects.toBeInstanceOf(ProviderError);
  });
});

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe('mapGeminiUsage', () => {
  it('maps stats token fields', () => {
    expect(mapGeminiUsage({ input_tokens: 8, output_tokens: 5, total_tokens: 13 })).toEqual({
      inputTokens: 8,
      outputTokens: 5,
    });
  });
  it('returns undefined for absent/empty stats', () => {
    expect(mapGeminiUsage(undefined)).toBeUndefined();
    expect(mapGeminiUsage({ duration_ms: 100 })).toBeUndefined();
  });
});

describe('mapGeminiFinishReason', () => {
  it.each([
    ['success', 'stop'],
    [undefined, 'stop'],
    ['error', 'error'],
  ] as const)('maps %s → %s', (input, expected) => {
    expect(mapGeminiFinishReason(input)).toBe(expected);
  });
});

describe('classifyGeminiError', () => {
  it('classifies auth, billing, rate-limit, and generic messages', () => {
    expect(classifyGeminiError('API key not valid')).toBeInstanceOf(AuthError);
    expect(classifyGeminiError('You exceeded your quota')).toBeInstanceOf(BillingError);
    expect(classifyGeminiError('RESOURCE_EXHAUSTED')).toBeInstanceOf(RateLimitError);
    expect(classifyGeminiError('something odd happened')).toBeInstanceOf(ProviderError);
  });
});
