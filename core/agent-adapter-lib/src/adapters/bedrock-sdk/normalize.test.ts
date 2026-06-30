/**
 * bedrock-sdk normalize.ts unit tests — AgentInput ↔ Bedrock Converse shapes.
 */

import { describe, expect, it } from 'vitest';
import type { AgentInput } from '../../agent.ts';
import {
  buildRequest,
  buildToolConfig,
  DEFAULT_MAX_TOKENS,
  mapStopReason,
  normalizeMessages,
  normalizeSystem,
  normalizeTools,
} from './normalize.ts';

describe('normalizeMessages', () => {
  it('maps string content to a single text block', () => {
    expect(normalizeMessages([{ role: 'user', content: 'hi' }])).toEqual([
      { role: 'user', content: [{ text: 'hi' }] },
    ]);
  });

  it("maps 'assistant' role to 'assistant' (system stays a separate field)", () => {
    const out = normalizeMessages([{ role: 'assistant', content: 'ok' }]);
    expect(out[0]?.role).toBe('assistant');
  });

  it('maps tool-use blocks to Converse toolUse content blocks', () => {
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
      content: [
        { text: 'calling' },
        { toolUse: { toolUseId: 'call_1', name: 'read', input: { path: 'a.ts' } } },
      ],
    });
  });

  it('skips thinking blocks and keeps the message valid with an empty text block', () => {
    const out = normalizeMessages([
      { role: 'assistant', content: [{ type: 'thinking', thinking: 'hmm' }] },
    ]);
    expect(out[0]).toEqual({ role: 'assistant', content: [{ text: '' }] });
  });
});

describe('normalizeSystem', () => {
  it('returns undefined for an absent or empty system prompt', () => {
    expect(normalizeSystem(undefined)).toBeUndefined();
    expect(normalizeSystem('')).toBeUndefined();
  });

  it('wraps a system prompt in a single text block', () => {
    expect(normalizeSystem('be terse')).toEqual([{ text: 'be terse' }]);
  });
});

describe('normalizeTools', () => {
  it('maps ToolDefinition to Converse toolSpec with a JSON input schema', () => {
    const out = normalizeTools([
      { name: 'get_weather', description: 'wx', inputSchema: { type: 'object', properties: {} } },
    ]);
    expect(out).toEqual([
      {
        toolSpec: {
          name: 'get_weather',
          description: 'wx',
          inputSchema: { json: { type: 'object', properties: {} } },
        },
      },
    ]);
  });

  it('defaults inputSchema.json to an empty object schema', () => {
    const out = normalizeTools([{ name: 'noargs' }]);
    expect(out[0]?.toolSpec.inputSchema).toEqual({ json: { type: 'object', properties: {} } });
  });
});

describe('buildToolConfig', () => {
  it('returns undefined when the input carries no tools', () => {
    expect(buildToolConfig({ messages: [] })).toBeUndefined();
  });

  it("maps toolChoice 'auto' → { auto: {} }", () => {
    const config = buildToolConfig({ messages: [], tools: [{ name: 'f' }], toolChoice: 'auto' });
    expect(config?.toolChoice).toEqual({ auto: {} });
  });

  it('maps a named toolChoice → { tool: { name } }', () => {
    const config = buildToolConfig({
      messages: [],
      tools: [{ name: 'f' }],
      toolChoice: { name: 'f' },
    });
    expect(config?.toolChoice).toEqual({ tool: { name: 'f' } });
  });

  it("omits toolChoice for 'none' (Converse has no none directive)", () => {
    const config = buildToolConfig({ messages: [], tools: [{ name: 'f' }], toolChoice: 'none' });
    expect(config?.tools).toHaveLength(1);
    expect(config?.toolChoice).toBeUndefined();
  });
});

describe('buildRequest', () => {
  it('assembles modelId, messages, system, toolConfig and a default maxTokens', () => {
    const input: AgentInput = {
      messages: [{ role: 'user', content: 'go' }],
      tools: [{ name: 'f' }],
    };
    const request = buildRequest(input, 'anthropic.claude-3-5-sonnet', 'sys');
    expect(request.modelId).toBe('anthropic.claude-3-5-sonnet');
    expect(request.messages).toEqual([{ role: 'user', content: [{ text: 'go' }] }]);
    expect(request.system).toEqual([{ text: 'sys' }]);
    expect(request.toolConfig?.tools[0]?.toolSpec.name).toBe('f');
    expect(request.inferenceConfig).toEqual({ maxTokens: DEFAULT_MAX_TOKENS });
  });

  it('omits system + toolConfig when not provided', () => {
    const request = buildRequest(
      { messages: [{ role: 'user', content: 'x' }] },
      'model',
      undefined,
    );
    expect(request.system).toBeUndefined();
    expect(request.toolConfig).toBeUndefined();
  });
});

describe('mapStopReason', () => {
  it('maps Converse stop reasons to the lib finishReason', () => {
    expect(mapStopReason('end_turn')).toBe('stop');
    expect(mapStopReason('stop_sequence')).toBe('stop');
    expect(mapStopReason('max_tokens')).toBe('length');
    expect(mapStopReason('tool_use')).toBe('tool_use');
    expect(mapStopReason('content_filtered')).toBe('content_filter');
    expect(mapStopReason('guardrail_intervened')).toBe('content_filter');
    expect(mapStopReason('malformed_tool_use')).toBe('error');
    expect(mapStopReason(null)).toBeUndefined();
  });
});
