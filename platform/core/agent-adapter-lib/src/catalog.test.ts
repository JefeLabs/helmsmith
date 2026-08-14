/**
 * The catalog is the "what exists" plane: static data, readable with zero
 * adapters registered and zero provider SDKs loaded.
 *
 * The static-data assertions here moved from capabilities.test.ts when
 * CAPABILITY_MATRIX became ADAPTER_CATALOG — they describe the source tree, not
 * any particular host, so they belong with the catalog.
 */

import { describe, expect, it } from 'vitest';
import { ADAPTER_CATALOG } from './catalog.ts';

const ALL_TYPES = [
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

/** Adapter types that support JSON mode (structured output) in the static catalog. */
const JSON_MODE_TYPES = ['gemini-sdk', 'openai-sdk'];

describe('ADAPTER_CATALOG', () => {
  it('describes all 11 built-in adapters', () => {
    expect(Object.keys(ADAPTER_CATALOG).sort()).toEqual([...ALL_TYPES].sort());
  });

  it('keys each entry by its own type', () => {
    for (const [key, entry] of Object.entries(ADAPTER_CATALOG)) {
      expect(entry.type, `entry under '${key}'`).toBe(key);
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
    for (const [type, entry] of Object.entries(ADAPTER_CATALOG)) {
      for (const key of requiredKeys) {
        expect(entry.capabilities, `${type} should have key '${key}'`).toHaveProperty(key);
        expect(
          typeof (entry.capabilities as unknown as Record<string, unknown>)[key],
          `${type}.${key} should be boolean`,
        ).toBe('boolean');
      }
    }
  });

  it('every entry has a valid toolUseMode consistent with supportsToolUse', () => {
    for (const [type, entry] of Object.entries(ADAPTER_CATALOG)) {
      expect(['autonomous', 'host-loop', 'none'], `${type} toolUseMode`).toContain(
        entry.capabilities.toolUseMode,
      );
      // supportsToolUse is the derived convenience flag.
      expect(entry.capabilities.supportsToolUse, `${type} supportsToolUse vs toolUseMode`).toBe(
        entry.capabilities.toolUseMode !== 'none',
      );
    }
  });

  it('copilot-cli does NOT support streaming', () => {
    expect(ADAPTER_CATALOG['copilot-cli'].capabilities.supportsStreaming).toBe(false);
  });

  it('copilot-cli supports autonomous tool use (standalone copilot agent)', () => {
    expect(ADAPTER_CATALOG['copilot-cli'].capabilities.supportsToolUse).toBe(true);
    expect(ADAPTER_CATALOG['copilot-cli'].capabilities.toolUseMode).toBe('autonomous');
  });

  it('opencode-cli reports usage + extended thinking (verified real)', () => {
    expect(ADAPTER_CATALOG['opencode-cli'].capabilities.reportsUsage).toBe(true);
    expect(ADAPTER_CATALOG['opencode-cli'].capabilities.supportsExtendedThinking).toBe(true);
  });

  it('claude-sdk supports tool use (host-loop) and reports usage', () => {
    expect(ADAPTER_CATALOG['claude-sdk'].capabilities.supportsToolUse).toBe(true);
    expect(ADAPTER_CATALOG['claude-sdk'].capabilities.reportsUsage).toBe(true);
  });

  it('only the gemini-sdk + openai-sdk adapters support JSON mode in the catalog', () => {
    // Anthropic-backed adapters use tool-use for structured output (false).
    // copilot-sdk MIGHT support it at construction time (model-dependent) but the
    // static catalog defaults it to false. The native OpenAI/Gemini SDK adapters
    // expose response_format / responseJsonSchema, so they report true.
    for (const type of ALL_TYPES) {
      const expected = JSON_MODE_TYPES.includes(type);
      expect(ADAPTER_CATALOG[type].capabilities.supportsJsonMode, `${type} supportsJsonMode`).toBe(
        expected,
      );
    }
  });

  it('no adapter supports session resume in v1', () => {
    for (const type of ALL_TYPES) {
      expect(
        ADAPTER_CATALOG[type].capabilities.supportsSessionResume,
        `${type} supportsSessionResume`,
      ).toBe(false);
    }
  });

  it('is readable without registering anything — the point of the catalog plane', async () => {
    const { registeredAdapterTypes } = await import('./registry.ts');
    expect(registeredAdapterTypes()).toEqual([]);
    expect(Object.keys(ADAPTER_CATALOG)).toHaveLength(11);
  });
});
