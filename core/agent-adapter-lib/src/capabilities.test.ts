import { describe, expect, it } from 'vitest';
import type { AgentSpecType } from './agent.ts';
import { CAPABILITY_MATRIX, intersectCapabilities, listAdapterTypes } from './capabilities.ts';

const ALL_TYPES: AgentSpecType[] = [
  'claude-sdk',
  'claude-agent-sdk',
  'claude-code-cli',
  'opencode-cli',
  'copilot-sdk',
  'copilot-cli',
  'copilot-agent-cli',
  'gemini-cli',
  'gemini-sdk',
  'openai-sdk',
  'codex-cli',
  'bedrock-sdk',
];

/** Adapter types that support JSON mode (structured output) in the static matrix. */
const JSON_MODE_TYPES: AgentSpecType[] = ['gemini-sdk', 'openai-sdk'];

describe('CAPABILITY_MATRIX', () => {
  it('has an entry for every AgentSpecType', () => {
    for (const type of ALL_TYPES) {
      expect(CAPABILITY_MATRIX[type]).toBeDefined();
    }
  });

  it('all entries have exactly the required capability keys', () => {
    const requiredKeys = [
      'reportsUsage',
      'supportsStreaming',
      'supportsToolUse',
      'supportsExtendedThinking',
      'supportsCancellation',
      'supportsCapture',
      'supportsJsonMode',
      'supportsSessionResume',
    ];
    for (const [type, caps] of Object.entries(CAPABILITY_MATRIX)) {
      for (const key of requiredKeys) {
        expect(caps, `${type} should have key '${key}'`).toHaveProperty(key);
        expect(
          typeof (caps as unknown as Record<string, unknown>)[key],
          `${type}.${key} should be boolean`,
        ).toBe('boolean');
      }
    }
  });

  it('copilot-cli does NOT support streaming', () => {
    expect(CAPABILITY_MATRIX['copilot-cli'].supportsStreaming).toBe(false);
  });

  it('copilot-cli does NOT support tool use', () => {
    expect(CAPABILITY_MATRIX['copilot-cli'].supportsToolUse).toBe(false);
  });

  it('claude-sdk supports tool use (host-loop)', () => {
    expect(CAPABILITY_MATRIX['claude-sdk'].supportsToolUse).toBe(true);
  });

  it('claude-sdk reports usage', () => {
    expect(CAPABILITY_MATRIX['claude-sdk'].reportsUsage).toBe(true);
  });

  it('only the gemini-sdk + openai-sdk adapters support JSON mode on the static matrix', () => {
    // Anthropic-backed adapters use tool-use for structured output (false).
    // copilot-sdk MIGHT support it at construction time (model-dependent) but the
    // static matrix defaults it to false. The native OpenAI/Gemini SDK adapters
    // expose response_format / responseJsonSchema, so they report true.
    for (const type of ALL_TYPES) {
      const expected = JSON_MODE_TYPES.includes(type);
      expect(CAPABILITY_MATRIX[type].supportsJsonMode, `${type} supportsJsonMode`).toBe(expected);
    }
  });

  it('no adapter supports session resume in v1', () => {
    for (const type of ALL_TYPES) {
      expect(CAPABILITY_MATRIX[type].supportsSessionResume, `${type} supportsSessionResume`).toBe(
        false,
      );
    }
  });
});

describe('listAdapterTypes', () => {
  it('returns all types when called with no filter', () => {
    const result = listAdapterTypes();
    expect(result).toHaveLength(ALL_TYPES.length);
    for (const type of ALL_TYPES) {
      expect(result).toContain(type);
    }
  });

  it('returns all types when called with an empty filter', () => {
    const result = listAdapterTypes({});
    expect(result).toHaveLength(ALL_TYPES.length);
  });

  it('filters by supportsStreaming:true — excludes copilot-cli', () => {
    const result = listAdapterTypes({ supportsStreaming: true });
    expect(result).not.toContain('copilot-cli');
    // All others stream
    expect(result).toContain('claude-sdk');
    expect(result).toContain('claude-code-cli');
    expect(result).toContain('opencode-cli');
    expect(result).toContain('copilot-sdk');
  });

  it('filters by supportsStreaming:false — returns only copilot-cli', () => {
    const result = listAdapterTypes({ supportsStreaming: false });
    expect(result).toEqual(['copilot-cli']);
  });

  it('filters by supportsToolUse:true — excludes copilot-cli', () => {
    const result = listAdapterTypes({ supportsToolUse: true });
    expect(result).not.toContain('copilot-cli');
    expect(result).toContain('claude-sdk');
    expect(result).toContain('claude-agent-sdk');
    expect(result).toContain('claude-code-cli');
    expect(result).toContain('opencode-cli');
    expect(result).toContain('copilot-sdk');
    expect(result).toContain('copilot-agent-cli');
  });

  it('filters by supportsToolUse:false — returns only copilot-cli', () => {
    const result = listAdapterTypes({ supportsToolUse: false });
    expect(result).toEqual(['copilot-cli']);
  });

  it('filters by multiple keys — AND semantics', () => {
    // streaming:true AND toolUse:false → empty (no adapter is non-streaming + has toolUse:false
    //   except copilot-cli which is also non-streaming)
    // Actually copilot-cli: streaming:false, toolUse:false
    // streaming:false AND toolUse:false → ['copilot-cli']
    const result = listAdapterTypes({ supportsStreaming: false, supportsToolUse: false });
    expect(result).toEqual(['copilot-cli']);
  });

  it('filters by supportsCapture:true — all adapters support capture', () => {
    const result = listAdapterTypes({ supportsCapture: true });
    expect(result).toHaveLength(ALL_TYPES.length);
  });

  it('filters by reportsUsage:true — excludes copilot-cli and opencode-cli', () => {
    const result = listAdapterTypes({ reportsUsage: true });
    expect(result).not.toContain('copilot-cli');
    expect(result).not.toContain('opencode-cli'); // TBD → false
    expect(result).not.toContain('copilot-agent-cli');
    expect(result).toContain('claude-sdk');
    expect(result).toContain('claude-agent-sdk');
    expect(result).toContain('claude-code-cli');
    expect(result).toContain('copilot-sdk');
  });
});

describe('intersectCapabilities', () => {
  it('AND-s all boolean flags', () => {
    const a = CAPABILITY_MATRIX['claude-sdk'];
    const b = CAPABILITY_MATRIX['copilot-cli'];
    const result = intersectCapabilities(a, b);
    // copilot-cli streaming=false → intersection streaming=false
    expect(result.supportsStreaming).toBe(false);
    // copilot-cli toolUse=false → intersection toolUse=false
    expect(result.supportsToolUse).toBe(false);
    // Both support cancellation
    expect(result.supportsCancellation).toBe(true);
    // Both support capture
    expect(result.supportsCapture).toBe(true);
  });

  it('is commutative', () => {
    const a = CAPABILITY_MATRIX['claude-sdk'];
    const b = CAPABILITY_MATRIX['copilot-sdk'];
    const ab = intersectCapabilities(a, b);
    const ba = intersectCapabilities(b, a);
    expect(ab).toEqual(ba);
  });
});
