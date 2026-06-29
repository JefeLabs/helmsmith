/**
 * ClaudeStreamParser unit tests.
 *
 * Fed with REAL stream-json transcripts captured from `claude` v2.1.195
 * (fixtures/*.jsonl) plus hand-crafted edge cases: lines split across stdout
 * chunks, a tool_use sequence, an error result, a top-level error event, and a
 * final result with usage.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AuthError, BillingError, ProviderError } from '../../errors.ts';
import type { AgentChunk } from '../../stream.ts';
import { reduceStream } from '../../stream.ts';
import {
  ClaudeStreamParser,
  classifyClaudeError,
  mapStopReason,
  mapUsage,
} from './stream-parser.ts';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

function fixtureLines(name: string): string[] {
  return readFileSync(join(FIXTURES, name), 'utf8')
    .split('\n')
    .filter((l) => l.trim().length > 0);
}

function parseLines(lines: string[]): AgentChunk[] {
  const parser = new ClaudeStreamParser();
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

describe('ClaudeStreamParser — real simple-text transcript', () => {
  it('maps system/rate_limit lines to nothing and emits text + usage + stop', () => {
    const chunks = parseLines(fixtureLines('simple-text.jsonl'));
    expect(chunks).toEqual([
      { type: 'text-delta', text: 'pong' },
      {
        type: 'usage',
        usage: {
          inputTokens: 3,
          outputTokens: 5,
          cacheReadTokens: 16094,
          cacheWriteTokens: 10144,
        },
      },
      { type: 'message-stop', finishReason: 'stop' },
    ]);
  });

  it('reduces to a result with content="pong", finishReason="stop", usage', async () => {
    const chunks = parseLines(fixtureLines('simple-text.jsonl'));
    const result = await reduceStream(fromArray(chunks));
    expect(result.content).toBe('pong');
    expect(result.finishReason).toBe('stop');
    expect(result.usage).toEqual({
      inputTokens: 3,
      outputTokens: 5,
      cacheReadTokens: 16094,
      cacheWriteTokens: 10144,
    });
  });
});

// ---------------------------------------------------------------------------
// Real transcript: tool use (thinking → tool_use → tool_result → text → result)
// ---------------------------------------------------------------------------

describe('ClaudeStreamParser — real tool-use transcript', () => {
  it('emits thinking, tool-call-* , tool-result, text, usage, stop in order', () => {
    const chunks = parseLines(fixtureLines('tool-use.jsonl'));
    expect(chunks).toEqual([
      {
        type: 'thinking-delta',
        text: 'The user wants me to run exactly the bash command `echo hi` and nothing else.',
      },
      { type: 'tool-call-start', toolCallId: 'toolu_0131AiTaQm8Vjp3Xo8yStZon', toolName: 'Bash' },
      {
        type: 'tool-call-input',
        toolCallId: 'toolu_0131AiTaQm8Vjp3Xo8yStZon',
        partialInput: JSON.stringify({ command: 'echo hi', description: 'Echo hi' }),
      },
      {
        type: 'tool-call-end',
        toolCallId: 'toolu_0131AiTaQm8Vjp3Xo8yStZon',
        input: { command: 'echo hi', description: 'Echo hi' },
      },
      {
        type: 'tool-result',
        toolCallId: 'toolu_0131AiTaQm8Vjp3Xo8yStZon',
        output: 'hi',
      },
      { type: 'text-delta', text: '`hi`' },
      {
        type: 'usage',
        usage: {
          inputTokens: 4,
          outputTokens: 110,
          cacheReadTokens: 35574,
          cacheWriteTokens: 20389,
        },
      },
      // Final result line's stop_reason is "end_turn" → 'stop'.
      { type: 'message-stop', finishReason: 'stop' },
    ]);
  });

  it('reduceStream builds tool-use + text content blocks', async () => {
    const chunks = parseLines(fixtureLines('tool-use.jsonl'));
    const result = await reduceStream(fromArray(chunks));
    expect(result.content).toBe('`hi`');
    const toolBlock = result.contentBlocks?.find((b) => b.type === 'tool-use');
    expect(toolBlock).toMatchObject({
      type: 'tool-use',
      id: 'toolu_0131AiTaQm8Vjp3Xo8yStZon',
      name: 'Bash',
      input: { command: 'echo hi', description: 'Echo hi' },
    });
  });
});

// ---------------------------------------------------------------------------
// Lines split across stdout chunks
// ---------------------------------------------------------------------------

describe('ClaudeStreamParser — push() reassembles lines split across chunks', () => {
  it('produces the same chunks whether fed whole or byte-by-byte', () => {
    const whole = `${fixtureLines('simple-text.jsonl').join('\n')}\n`;
    const expected = parseLines(fixtureLines('simple-text.jsonl'));

    const parser = new ClaudeStreamParser();
    const got: AgentChunk[] = [];
    // Feed one character at a time — maximally adversarial splitting.
    for (const ch of whole) got.push(...parser.push(ch));
    got.push(...parser.flush());

    expect(got).toEqual(expected);
  });

  it('handles a line split in the middle of a JSON object across two chunks', () => {
    const parser = new ClaudeStreamParser();
    const line = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'hello world' }] },
    });
    const mid = Math.floor(line.length / 2);

    let out: AgentChunk[] = [];
    out = out.concat(parser.push(line.slice(0, mid)));
    expect(out).toEqual([]); // nothing yet — line incomplete
    out = out.concat(parser.push(`${line.slice(mid)}\n`));
    expect(out).toEqual([{ type: 'text-delta', text: 'hello world' }]);
  });
});

// ---------------------------------------------------------------------------
// Error events
// ---------------------------------------------------------------------------

describe('ClaudeStreamParser — error handling', () => {
  it('maps a result with is_error=true (subtype success) to an AuthError chunk', () => {
    const line = JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: true,
      result: 'Not logged in · Please run /login',
      stop_reason: 'stop_sequence',
    });
    const chunks = parseLines([line]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].type).toBe('error');
    const err = (chunks[0] as { type: 'error'; error: unknown }).error;
    expect(err).toBeInstanceOf(AuthError);
  });

  it('emits usage before the error chunk when the error result carries usage', () => {
    const line = JSON.stringify({
      type: 'result',
      subtype: 'error',
      is_error: true,
      result: 'Your credit balance is too low',
      usage: { input_tokens: 5, output_tokens: 0 },
    });
    const chunks = parseLines([line]);
    expect(chunks[0]).toEqual({ type: 'usage', usage: { inputTokens: 5, outputTokens: 0 } });
    expect(chunks[1].type).toBe('error');
    expect((chunks[1] as { error: unknown }).error).toBeInstanceOf(BillingError);
  });

  it('maps a top-level error event to a ProviderError chunk', () => {
    const line = JSON.stringify({ type: 'error', message: 'upstream exploded' });
    const chunks = parseLines([line]);
    expect(chunks).toHaveLength(1);
    expect((chunks[0] as { error: unknown }).error).toBeInstanceOf(ProviderError);
  });

  it('skips a non-JSON stdout line without throwing', () => {
    const chunks = parseLines(['this is not json', '{"type":"system","subtype":"init"}']);
    expect(chunks).toEqual([]);
  });

  it('reduceStream throws the embedded error for an error chunk', async () => {
    const chunks = parseLines([JSON.stringify({ type: 'error', message: 'boom' })]);
    await expect(reduceStream(fromArray(chunks))).rejects.toBeInstanceOf(ProviderError);
  });
});

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe('mapStopReason', () => {
  it.each([
    ['end_turn', 'stop'],
    ['stop_sequence', 'stop'],
    ['max_tokens', 'length'],
    ['tool_use', 'tool_use'],
    ['refusal', 'content_filter'],
    [null, 'stop'],
    [undefined, 'stop'],
    ['something_unknown', 'stop'],
  ] as const)('maps %s → %s', (input, expected) => {
    expect(mapStopReason(input)).toBe(expected);
  });
});

describe('mapUsage', () => {
  it('maps token fields and omits absent cache fields', () => {
    expect(mapUsage({ input_tokens: 10, output_tokens: 20 })).toEqual({
      inputTokens: 10,
      outputTokens: 20,
    });
  });

  it('returns undefined for absent usage', () => {
    expect(mapUsage(undefined)).toBeUndefined();
  });
});

describe('classifyClaudeError', () => {
  it('classifies auth, billing, and generic messages', () => {
    expect(classifyClaudeError('Not logged in')).toBeInstanceOf(AuthError);
    expect(classifyClaudeError('out of credits')).toBeInstanceOf(BillingError);
    expect(classifyClaudeError('weird failure')).toBeInstanceOf(ProviderError);
  });
});
