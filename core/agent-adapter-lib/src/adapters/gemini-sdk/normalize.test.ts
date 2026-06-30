/**
 * gemini-sdk normalize.ts unit tests — AgentInput ↔ Gemini request shapes.
 */

import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '../../agent.ts';
import { mapFinishReason, normalizeContents, normalizeTools } from './normalize.ts';

describe('normalizeContents', () => {
  it('maps a string user message to a single text part with role "user"', () => {
    const msgs: ChatMessage[] = [{ role: 'user', content: 'hello' }];
    expect(normalizeContents(msgs)).toEqual([{ role: 'user', parts: [{ text: 'hello' }] }]);
  });

  it('maps assistant role to "model"', () => {
    const msgs: ChatMessage[] = [{ role: 'assistant', content: 'hi there' }];
    expect(normalizeContents(msgs)).toEqual([{ role: 'model', parts: [{ text: 'hi there' }] }]);
  });

  it('maps a tool-use block to a functionCall part', () => {
    const msgs: ChatMessage[] = [
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'calling' },
          { type: 'tool-use', id: 'call_1', name: 'read', input: { path: 'a.ts' } },
        ],
      },
    ];
    expect(normalizeContents(msgs)).toEqual([
      {
        role: 'model',
        parts: [
          { text: 'calling' },
          { functionCall: { id: 'call_1', name: 'read', args: { path: 'a.ts' } } },
        ],
      },
    ]);
  });

  it('skips thinking blocks and falls back to an empty text part when empty', () => {
    const msgs: ChatMessage[] = [
      { role: 'assistant', content: [{ type: 'thinking', thinking: 'hmm' }] },
    ];
    expect(normalizeContents(msgs)).toEqual([{ role: 'model', parts: [{ text: '' }] }]);
  });

  it('maps a tool-result turn to a user functionResponse part, recovering the name from the preceding tool-use', () => {
    const msgs: ChatMessage[] = [
      {
        role: 'assistant',
        content: [{ type: 'tool-use', id: 'call_1', name: 'read', input: { path: 'a.ts' } }],
      },
      { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'call_1', output: '42' }] },
    ];
    expect(normalizeContents(msgs)).toEqual([
      {
        role: 'model',
        parts: [{ functionCall: { id: 'call_1', name: 'read', args: { path: 'a.ts' } } }],
      },
      {
        role: 'user',
        // Gemini correlates by name — must be the originating function's name, not empty.
        parts: [{ functionResponse: { id: 'call_1', name: 'read', response: { output: '42' } } }],
      },
    ]);
  });

  it('prefers an explicit toolName on the tool-result block over correlation', () => {
    const msgs: ChatMessage[] = [
      {
        role: 'tool',
        content: [
          { type: 'tool-result', toolCallId: 'call_1', toolName: 'get_weather', output: 'sunny' },
        ],
      },
    ];
    expect(normalizeContents(msgs)).toEqual([
      {
        role: 'user',
        parts: [
          {
            functionResponse: { id: 'call_1', name: 'get_weather', response: { output: 'sunny' } },
          },
        ],
      },
    ]);
  });

  it('falls back to the toolCallId when no tool name can be sourced', () => {
    const msgs: ChatMessage[] = [
      { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'call_1', output: '42' }] },
    ];
    expect(normalizeContents(msgs)).toEqual([
      {
        role: 'user',
        parts: [{ functionResponse: { id: 'call_1', name: 'call_1', response: { output: '42' } } }],
      },
    ]);
  });
});

describe('normalizeTools', () => {
  it('wraps function declarations in a single tools entry with parametersJsonSchema', () => {
    const result = normalizeTools([
      {
        name: 'get_weather',
        description: 'Get the weather',
        inputSchema: { type: 'object', properties: { city: { type: 'string' } } },
      },
    ]);
    expect(result).toEqual([
      {
        functionDeclarations: [
          {
            name: 'get_weather',
            description: 'Get the weather',
            parametersJsonSchema: { type: 'object', properties: { city: { type: 'string' } } },
          },
        ],
      },
    ]);
  });

  it('defaults parametersJsonSchema to an empty object schema', () => {
    const result = normalizeTools([{ name: 'noargs' }]);
    expect(result[0]?.functionDeclarations[0]).toEqual({
      name: 'noargs',
      parametersJsonSchema: { type: 'object', properties: {} },
    });
  });
});

describe('mapFinishReason', () => {
  it('maps the core Gemini finish reasons', () => {
    expect(mapFinishReason('STOP')).toBe('stop');
    expect(mapFinishReason('MAX_TOKENS')).toBe('length');
    expect(mapFinishReason('SAFETY')).toBe('content_filter');
    expect(mapFinishReason('RECITATION')).toBe('content_filter');
    expect(mapFinishReason('MALFORMED_FUNCTION_CALL')).toBe('error');
    expect(mapFinishReason('OTHER')).toBe('error');
    expect(mapFinishReason(undefined)).toBeUndefined();
    expect(mapFinishReason(null)).toBeUndefined();
  });

  it('maps an unknown/future finish reason to error (not a clean stop)', () => {
    expect(mapFinishReason('SOME_NEW_REASON')).toBe('error');
  });
});
