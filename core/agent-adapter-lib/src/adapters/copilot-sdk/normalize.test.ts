/**
 * copilot-sdk normalize tests — AgentInput → OpenAI request body + finish-reason
 * mapping (PRD §8.4).
 */

import { describe, expect, it } from 'vitest';
import type { AgentInput } from '../../agent.ts';
import { buildRequestBody, mapFinishReason, normalizeMessages } from './normalize.ts';

describe('copilot-sdk normalize — messages', () => {
  it('prepends the system prompt as a system message', () => {
    const msgs = normalizeMessages([{ role: 'user', content: 'hi' }], 'You are terse.');
    expect(msgs).toEqual([
      { role: 'system', content: 'You are terse.' },
      { role: 'user', content: 'hi' },
    ]);
  });

  it('maps tool-use content blocks to OpenAI tool_calls', () => {
    const msgs = normalizeMessages([
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'calling' },
          { type: 'tool-use', id: 'call_1', name: 'get_weather', input: { city: 'SF' } },
          { type: 'thinking', thinking: 'secret' }, // dropped
        ],
      },
    ]);
    expect(msgs).toEqual([
      {
        role: 'assistant',
        content: 'calling',
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'get_weather', arguments: JSON.stringify({ city: 'SF' }) },
          },
        ],
      },
    ]);
  });
});

describe('copilot-sdk normalize — request body', () => {
  it('builds a streaming body with include_usage and forwards tools + tool_choice', () => {
    const input: AgentInput = {
      messages: [{ role: 'user', content: 'weather?' }],
      tools: [
        {
          name: 'get_weather',
          description: 'Get weather',
          inputSchema: { type: 'object', properties: { city: { type: 'string' } } },
        },
      ],
      toolChoice: { name: 'get_weather' },
    };
    const body = buildRequestBody(input, 'gpt-4o', 'sys', true);
    expect(body.model).toBe('gpt-4o');
    expect(body.stream).toBe(true);
    expect(body.stream_options).toEqual({ include_usage: true });
    expect(body.messages[0]).toEqual({ role: 'system', content: 'sys' });
    expect(body.tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'get_weather',
          description: 'Get weather',
          parameters: { type: 'object', properties: { city: { type: 'string' } } },
        },
      },
    ]);
    expect(body.tool_choice).toEqual({ type: 'function', function: { name: 'get_weather' } });
  });

  it('omits stream_options + tools when not streaming and no tools given', () => {
    const body = buildRequestBody(
      { messages: [{ role: 'user', content: 'x' }] },
      'm',
      undefined,
      false,
    );
    expect(body.stream).toBe(false);
    expect(body.stream_options).toBeUndefined();
    expect(body.tools).toBeUndefined();
    expect(body.tool_choice).toBeUndefined();
  });

  it("maps the 'auto' / 'none' tool choice strings through verbatim", () => {
    expect(
      buildRequestBody({ messages: [], toolChoice: 'auto' }, 'm', undefined, true).tool_choice,
    ).toBe('auto');
    expect(
      buildRequestBody({ messages: [], toolChoice: 'none' }, 'm', undefined, true).tool_choice,
    ).toBe('none');
  });
});

describe('copilot-sdk normalize — finish reason', () => {
  it('maps OpenAI finish reasons to the lib taxonomy', () => {
    expect(mapFinishReason('stop')).toBe('stop');
    expect(mapFinishReason('length')).toBe('length');
    expect(mapFinishReason('tool_calls')).toBe('tool_use');
    expect(mapFinishReason('function_call')).toBe('tool_use');
    expect(mapFinishReason('content_filter')).toBe('content_filter');
    expect(mapFinishReason(null)).toBeUndefined();
    expect(mapFinishReason(undefined)).toBeUndefined();
    expect(mapFinishReason('weird')).toBe('stop');
  });
});
