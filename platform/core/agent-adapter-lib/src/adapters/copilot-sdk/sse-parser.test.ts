/**
 * copilot-sdk SSE parser tests — OpenAI-style `data: {...}` frames → AgentChunk
 * (PRD §8.4 streaming).
 */

import { describe, expect, it } from 'vitest';
import type { AgentChunk } from '../../stream.ts';
import { parseSse, SseParser } from './sse-parser.ts';

describe('copilot-sdk SseParser — text streaming', () => {
  it('maps content deltas to text-delta and closes with usage + message-stop', () => {
    const sse =
      'data: {"choices":[{"delta":{"content":"Hel"},"finish_reason":null}]}\n\n' +
      'data: {"choices":[{"delta":{"content":"lo"},"finish_reason":null}]}\n\n' +
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n' +
      'data: {"choices":[],"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5}}\n\n' +
      'data: [DONE]\n\n';
    const chunks = parseSse(sse);
    expect(chunks).toEqual<AgentChunk[]>([
      { type: 'text-delta', text: 'Hel' },
      { type: 'text-delta', text: 'lo' },
      { type: 'usage', usage: { inputTokens: 3, outputTokens: 2 } },
      { type: 'message-stop', finishReason: 'stop' },
    ]);
  });

  it('handles frames split across push() boundaries', () => {
    const parser = new SseParser();
    const out: AgentChunk[] = [];
    out.push(...parser.push('data: {"choices":[{"delta":{"content":"part'));
    out.push(...parser.push('ial"}}]}\n\ndata: [DONE]\n\n'));
    out.push(...parser.flush());
    expect(out).toEqual<AgentChunk[]>([
      { type: 'text-delta', text: 'partial' },
      { type: 'message-stop', finishReason: 'stop' },
    ]);
  });
});

describe('copilot-sdk SseParser — tool calls', () => {
  it('maps streamed tool_calls to tool-call-start / -input / -end', () => {
    const sse =
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"get_weather","arguments":"{\\"ci"}}]}}]}\n\n' +
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"ty\\":\\"SF\\"}"}}]}}]}\n\n' +
      'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n' +
      'data: [DONE]\n\n';
    const chunks = parseSse(sse);
    expect(chunks).toEqual<AgentChunk[]>([
      { type: 'tool-call-start', toolCallId: 'call_1', toolName: 'get_weather' },
      { type: 'tool-call-input', toolCallId: 'call_1', partialInput: '{"ci' },
      { type: 'tool-call-input', toolCallId: 'call_1', partialInput: 'ty":"SF"}' },
      { type: 'tool-call-end', toolCallId: 'call_1', input: { city: 'SF' } },
      { type: 'message-stop', finishReason: 'tool_use' },
    ]);
  });

  it('closes a dangling tool call at flush when no finish_reason arrives', () => {
    const sse =
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"f","arguments":"{}"}}]}}]}\n\n';
    const chunks = parseSse(sse);
    expect(chunks).toEqual<AgentChunk[]>([
      { type: 'tool-call-start', toolCallId: 'c1', toolName: 'f' },
      { type: 'tool-call-input', toolCallId: 'c1', partialInput: '{}' },
      { type: 'tool-call-end', toolCallId: 'c1', input: {} },
      { type: 'message-stop', finishReason: 'stop' },
    ]);
  });
});

describe('copilot-sdk SseParser — robustness', () => {
  it('ignores malformed JSON frames and comment/event lines', () => {
    const sse =
      ': keep-alive comment\n\n' +
      'event: ping\n\n' +
      'data: not-json\n\n' +
      'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\n' +
      'data: [DONE]\n\n';
    expect(parseSse(sse)).toEqual<AgentChunk[]>([
      { type: 'text-delta', text: 'ok' },
      { type: 'message-stop', finishReason: 'stop' },
    ]);
  });

  it('emits nothing for an empty stream', () => {
    expect(parseSse('')).toEqual([]);
  });
});
