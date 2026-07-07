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
  'gemini-cli',
  'gemini-sdk',
  'openai-sdk',
  'codex-cli',
  'bedrock-sdk',
];

/** Adapter types that support JSON mode (structured output) in the static matrix. */
const JSON_MODE_TYPES: AgentSpecType[] = ['gemini-sdk', 'openai-sdk'];

/** Adapter types whose tool use is autonomous (the backend runs tools itself). */
const AUTONOMOUS_TYPES: AgentSpecType[] = [
  'claude-agent-sdk',
  'claude-code-cli',
  'opencode-cli',
  'copilot-cli',
  'gemini-cli',
  'codex-cli',
];

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

  it('every entry has a valid toolUseMode consistent with supportsToolUse', () => {
    for (const [type, caps] of Object.entries(CAPABILITY_MATRIX)) {
      expect(['autonomous', 'host-loop', 'none'], `${type} toolUseMode`).toContain(
        caps.toolUseMode,
      );
      // supportsToolUse is the derived convenience flag.
      expect(caps.supportsToolUse, `${type} supportsToolUse vs toolUseMode`).toBe(
        caps.toolUseMode !== 'none',
      );
    }
  });

  it('copilot-cli does NOT support streaming', () => {
    expect(CAPABILITY_MATRIX['copilot-cli'].supportsStreaming).toBe(false);
  });

  it('copilot-cli supports autonomous tool use (standalone copilot agent)', () => {
    expect(CAPABILITY_MATRIX['copilot-cli'].supportsToolUse).toBe(true);
    expect(CAPABILITY_MATRIX['copilot-cli'].toolUseMode).toBe('autonomous');
  });

  it('opencode-cli reports usage + extended thinking (verified real)', () => {
    expect(CAPABILITY_MATRIX['opencode-cli'].reportsUsage).toBe(true);
    expect(CAPABILITY_MATRIX['opencode-cli'].supportsExtendedThinking).toBe(true);
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

  it('filters by supportsToolUse:true — now includes every adapter (copilot-cli is autonomous)', () => {
    const result = listAdapterTypes({ supportsToolUse: true });
    // Every remaining adapter supports tool use after the consolidated fix.
    expect(result).toHaveLength(ALL_TYPES.length);
    expect(result).toContain('copilot-cli');
  });

  it('filters by supportsToolUse:false — returns nothing (all adapters support tool use)', () => {
    const result = listAdapterTypes({ supportsToolUse: false });
    expect(result).toEqual([]);
  });

  it('filters by toolUseMode:autonomous — returns exactly the agentic adapters', () => {
    const result = listAdapterTypes({ toolUseMode: 'autonomous' });
    expect(result.sort()).toEqual([...AUTONOMOUS_TYPES].sort());
  });

  it('filters by toolUseMode:host-loop — returns exactly the chat-mode SDK adapters', () => {
    const result = listAdapterTypes({ toolUseMode: 'host-loop' });
    expect(result.sort()).toEqual(
      ['claude-sdk', 'openai-sdk', 'gemini-sdk', 'copilot-sdk', 'bedrock-sdk'].sort(),
    );
  });

  it('filters by multiple keys — AND semantics', () => {
    // copilot-cli is the only non-streaming adapter, and it is autonomous.
    // streaming:false AND toolUseMode:'autonomous' → ['copilot-cli'].
    const result = listAdapterTypes({ supportsStreaming: false, toolUseMode: 'autonomous' });
    expect(result).toEqual(['copilot-cli']);
  });

  it('filters by supportsCapture:true — all adapters support capture', () => {
    const result = listAdapterTypes({ supportsCapture: true });
    expect(result).toHaveLength(ALL_TYPES.length);
  });

  it('filters by reportsUsage:true — excludes only copilot-cli (opencode now reports usage)', () => {
    const result = listAdapterTypes({ reportsUsage: true });
    expect(result).not.toContain('copilot-cli'); // text print mode → no token counts
    expect(result).toContain('opencode-cli'); // verified: opencode emits usage
    expect(result).toContain('claude-sdk');
    expect(result).toContain('claude-agent-sdk');
    expect(result).toContain('claude-code-cli');
    expect(result).toContain('copilot-sdk');
  });
});

describe('intersectCapabilities', () => {
  it('AND-s all boolean flags and resolves toolUseMode', () => {
    const a = CAPABILITY_MATRIX['claude-sdk']; // host-loop, streaming
    const b = CAPABILITY_MATRIX['copilot-cli']; // autonomous, non-streaming
    const result = intersectCapabilities(a, b);
    // copilot-cli streaming=false → intersection streaming=false
    expect(result.supportsStreaming).toBe(false);
    // Both support tool use → intersection toolUse=true...
    expect(result.supportsToolUse).toBe(true);
    // ...but the modes differ (host-loop vs autonomous) → no shared mode.
    expect(result.toolUseMode).toBe('none');
    // Both support cancellation
    expect(result.supportsCancellation).toBe(true);
    // Both support capture
    expect(result.supportsCapture).toBe(true);
  });

  it('keeps a shared toolUseMode when both sides agree', () => {
    const a = CAPABILITY_MATRIX['claude-sdk']; // host-loop
    const b = CAPABILITY_MATRIX['openai-sdk']; // host-loop
    expect(intersectCapabilities(a, b).toolUseMode).toBe('host-loop');
  });

  it('is commutative', () => {
    const a = CAPABILITY_MATRIX['claude-sdk'];
    const b = CAPABILITY_MATRIX['copilot-sdk'];
    const ab = intersectCapabilities(a, b);
    const ba = intersectCapabilities(b, a);
    expect(ab).toEqual(ba);
  });
});
