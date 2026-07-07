/**
 * claude-sdk normalize.ts unit tests — AgentInput ↔ Anthropic SDK request shapes.
 */

import { describe, expect, it } from 'vitest';
import { mapStopReason, normalizeMessages, normalizeTools } from './normalize.ts';

describe('normalizeMessages', () => {
  it('passes string content through with its role', () => {
    expect(normalizeMessages([{ role: 'user', content: 'hi' }])).toEqual([
      { role: 'user', content: 'hi' },
    ]);
  });

  it('maps tool-use blocks to Anthropic tool_use blocks', () => {
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
        { type: 'text', text: 'calling' },
        { type: 'tool_use', id: 'call_1', name: 'read', input: { path: 'a.ts' } },
      ],
    });
  });

  it('serializes a tool-result turn to a user tool_result block', () => {
    const out = normalizeMessages([
      { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'call_1', output: '42' }] },
    ]);
    expect(out).toEqual([
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_1', content: '42' }] },
    ]);
  });
});

describe('normalizeTools', () => {
  it('wraps inputSchema into an object input_schema', () => {
    const out = normalizeTools([{ name: 'f', description: 'd', inputSchema: { properties: {} } }]);
    expect(out[0]).toEqual({
      name: 'f',
      description: 'd',
      input_schema: { type: 'object', properties: {} },
    });
  });
});

describe('mapStopReason', () => {
  it('maps Anthropic stop reasons to the lib finishReason', () => {
    expect(mapStopReason('end_turn')).toBe('stop');
    expect(mapStopReason('max_tokens')).toBe('length');
    expect(mapStopReason('tool_use')).toBe('tool_use');
    expect(mapStopReason('stop_sequence')).toBe('stop');
    expect(mapStopReason('weird')).toBe('error');
    expect(mapStopReason(null)).toBeUndefined();
  });
});
