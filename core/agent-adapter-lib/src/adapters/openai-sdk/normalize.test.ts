/**
 * openai-sdk normalize.ts unit tests — AgentInput ↔ OpenAI request shapes.
 */

import { describe, expect, it } from 'vitest';
import type { AgentInput } from '../../agent.ts';
import {
  buildRequestBody,
  mapFinishReason,
  normalizeMessages,
  normalizeTools,
} from './normalize.ts';

describe('normalizeMessages', () => {
  it('prepends a system message when systemPrompt is set', () => {
    const out = normalizeMessages([{ role: 'user', content: 'hi' }], 'be terse');
    expect(out).toEqual([
      { role: 'system', content: 'be terse' },
      { role: 'user', content: 'hi' },
    ]);
  });

  it('maps tool-use blocks to assistant tool_calls', () => {
    const out = normalizeMessages([
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'calling' },
          { type: 'tool-use', id: 'call_1', name: 'read', input: { path: 'a.ts' } },
        ],
      },
    ]);
    expect(out[0]).toEqual({
      role: 'assistant',
      content: 'calling',
      tool_calls: [
        {
          id: 'call_1',
          type: 'function',
          function: { name: 'read', arguments: '{"path":"a.ts"}' },
        },
      ],
    });
  });

  it('uses null content when an assistant message has only tool calls', () => {
    const out = normalizeMessages([
      { role: 'assistant', content: [{ type: 'tool-use', id: 'c', name: 'f', input: {} }] },
    ]);
    expect(out[0]?.content).toBeNull();
  });

  it('expands a tool-result turn into a role:tool message', () => {
    const out = normalizeMessages([
      { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'call_1', output: '42' }] },
    ]);
    expect(out).toEqual([{ role: 'tool', tool_call_id: 'call_1', content: '42' }]);
  });
});

describe('normalizeTools', () => {
  it('maps ToolDefinition to OpenAI function tools', () => {
    const out = normalizeTools([
      { name: 'get_weather', description: 'wx', inputSchema: { type: 'object', properties: {} } },
    ]);
    expect(out).toEqual([
      {
        type: 'function',
        function: {
          name: 'get_weather',
          description: 'wx',
          parameters: { type: 'object', properties: {} },
        },
      },
    ]);
  });

  it('defaults parameters to an empty object schema', () => {
    const out = normalizeTools([{ name: 'noargs' }]);
    expect(out[0]?.function.parameters).toEqual({ type: 'object', properties: {} });
  });
});

describe('buildRequestBody', () => {
  it('sets stream + include_usage and maps tools + tool_choice', () => {
    const input: AgentInput = {
      messages: [{ role: 'user', content: 'go' }],
      tools: [{ name: 'f' }],
      toolChoice: { name: 'f' },
    };
    const body = buildRequestBody(input, 'gpt-4o', 'sys', true);
    expect(body.model).toBe('gpt-4o');
    expect(body.stream).toBe(true);
    expect(body.stream_options).toEqual({ include_usage: true });
    expect(body.messages[0]).toEqual({ role: 'system', content: 'sys' });
    expect(body.tools?.[0]?.function.name).toBe('f');
    expect(body.tool_choice).toEqual({ type: 'function', function: { name: 'f' } });
  });

  it('omits stream_options when not streaming', () => {
    const body = buildRequestBody(
      { messages: [{ role: 'user', content: 'x' }] },
      'gpt-4o',
      undefined,
      false,
    );
    expect(body.stream).toBe(false);
    expect(body.stream_options).toBeUndefined();
  });
});

describe('mapFinishReason', () => {
  it('maps OpenAI finish reasons', () => {
    expect(mapFinishReason('stop')).toBe('stop');
    expect(mapFinishReason('length')).toBe('length');
    expect(mapFinishReason('tool_calls')).toBe('tool_use');
    expect(mapFinishReason('function_call')).toBe('tool_use');
    expect(mapFinishReason('content_filter')).toBe('content_filter');
    expect(mapFinishReason(null)).toBeUndefined();
  });

  it('maps an unknown/future finish reason to error (not a clean stop)', () => {
    expect(mapFinishReason('some_new_reason')).toBe('error');
  });
});
