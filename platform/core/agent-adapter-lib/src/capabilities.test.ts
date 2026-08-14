/**
 * capabilities.ts is the "what can THIS HOST do" plane — it reads the runtime
 * registry, not the source tree. Static-data assertions live in catalog.test.ts.
 *
 * The filter tests below register all 11 built-ins from the catalog first, so a
 * fully-loaded host still sees the same filter semantics as before the split.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentSpecType } from './agent.ts';
import { getCapabilities, intersectCapabilities, listAdapterTypes } from './capabilities.ts';
import { ADAPTER_CATALOG } from './catalog.ts';
import { _clearRegistry, registerAdapter } from './registry.ts';

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

/** Adapter types whose tool use is autonomous (the backend runs tools itself). */
const AUTONOMOUS_TYPES: AgentSpecType[] = [
  'claude-agent-sdk',
  'claude-code-cli',
  'opencode-cli',
  'copilot-cli',
  'gemini-cli',
  'codex-cli',
];

/** Register every built-in with a throwaway factory — simulates a fully-loaded host. */
function registerAll(): void {
  for (const type of ALL_TYPES) {
    registerAdapter(type, vi.fn(), ADAPTER_CATALOG[type].capabilities);
  }
}

describe('registry-backed introspection', () => {
  beforeEach(() => _clearRegistry());
  afterEach(() => _clearRegistry());

  it('returns nothing when the host has registered nothing', () => {
    expect(listAdapterTypes()).toEqual([]);
    expect(getCapabilities('claude-sdk')).toBeUndefined();
  });

  it('reports only what this host registered', () => {
    registerAdapter('claude-sdk', vi.fn(), ADAPTER_CATALOG['claude-sdk'].capabilities);
    registerAdapter('codex-cli', vi.fn(), ADAPTER_CATALOG['codex-cli'].capabilities);

    expect(new Set(listAdapterTypes())).toEqual(new Set(['claude-sdk', 'codex-cli']));
    expect(getCapabilities('claude-sdk')?.toolUseMode).toBe('host-loop');
    expect(getCapabilities('openai-sdk')).toBeUndefined();
  });

  it('filters within the registered set only', () => {
    registerAdapter('claude-sdk', vi.fn(), ADAPTER_CATALOG['claude-sdk'].capabilities);
    registerAdapter('codex-cli', vi.fn(), ADAPTER_CATALOG['codex-cli'].capabilities);

    // gemini-cli is also autonomous but was never registered, so it must not appear.
    expect(listAdapterTypes({ toolUseMode: 'autonomous' })).toEqual(['codex-cli']);
  });
});

describe('listAdapterTypes (fully-loaded host)', () => {
  beforeEach(() => {
    _clearRegistry();
    registerAll();
  });
  afterEach(() => _clearRegistry());

  it('returns all types when called with no filter', () => {
    const result = listAdapterTypes();
    expect(result).toHaveLength(ALL_TYPES.length);
    for (const type of ALL_TYPES) {
      expect(result).toContain(type);
    }
  });

  it('returns all types when called with an empty filter', () => {
    expect(listAdapterTypes({})).toHaveLength(ALL_TYPES.length);
  });

  it('filters by supportsStreaming:true — excludes copilot-cli', () => {
    const result = listAdapterTypes({ supportsStreaming: true });
    expect(result).not.toContain('copilot-cli');
    expect(result).toContain('claude-sdk');
    expect(result).toContain('claude-code-cli');
    expect(result).toContain('opencode-cli');
    expect(result).toContain('copilot-sdk');
  });

  it('filters by supportsStreaming:false — returns only copilot-cli', () => {
    expect(listAdapterTypes({ supportsStreaming: false })).toEqual(['copilot-cli']);
  });

  it('filters by supportsToolUse:true — includes every adapter (copilot-cli is autonomous)', () => {
    const result = listAdapterTypes({ supportsToolUse: true });
    expect(result).toHaveLength(ALL_TYPES.length);
    expect(result).toContain('copilot-cli');
  });

  it('filters by supportsToolUse:false — returns nothing (all adapters support tool use)', () => {
    expect(listAdapterTypes({ supportsToolUse: false })).toEqual([]);
  });

  it('filters by toolUseMode:autonomous — returns exactly the agentic adapters', () => {
    expect(listAdapterTypes({ toolUseMode: 'autonomous' }).sort()).toEqual(
      [...AUTONOMOUS_TYPES].sort(),
    );
  });

  it('filters by toolUseMode:host-loop — returns exactly the chat-mode SDK adapters', () => {
    expect(listAdapterTypes({ toolUseMode: 'host-loop' }).sort()).toEqual(
      ['claude-sdk', 'openai-sdk', 'gemini-sdk', 'copilot-sdk', 'bedrock-sdk'].sort(),
    );
  });

  it('filters by multiple keys — AND semantics', () => {
    // copilot-cli is the only non-streaming adapter, and it is autonomous.
    expect(listAdapterTypes({ supportsStreaming: false, toolUseMode: 'autonomous' })).toEqual([
      'copilot-cli',
    ]);
  });

  it('filters by supportsCapture:true — all adapters support capture', () => {
    expect(listAdapterTypes({ supportsCapture: true })).toHaveLength(ALL_TYPES.length);
  });

  it('filters by reportsUsage:true — excludes only copilot-cli', () => {
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
    const a = ADAPTER_CATALOG['claude-sdk'].capabilities; // host-loop, streaming
    const b = ADAPTER_CATALOG['copilot-cli'].capabilities; // autonomous, non-streaming
    const result = intersectCapabilities(a, b);
    // copilot-cli streaming=false → intersection streaming=false
    expect(result.supportsStreaming).toBe(false);
    // Both support tool use → intersection toolUse=true...
    expect(result.supportsToolUse).toBe(true);
    // ...but the modes differ (host-loop vs autonomous) → no shared mode.
    expect(result.toolUseMode).toBe('none');
    expect(result.supportsCancellation).toBe(true);
    expect(result.supportsCapture).toBe(true);
  });

  it('keeps a shared toolUseMode when both sides agree', () => {
    const a = ADAPTER_CATALOG['claude-sdk'].capabilities; // host-loop
    const b = ADAPTER_CATALOG['openai-sdk'].capabilities; // host-loop
    expect(intersectCapabilities(a, b).toolUseMode).toBe('host-loop');
  });

  it('is commutative', () => {
    const a = ADAPTER_CATALOG['claude-sdk'].capabilities;
    const b = ADAPTER_CATALOG['copilot-sdk'].capabilities;
    expect(intersectCapabilities(a, b)).toEqual(intersectCapabilities(b, a));
  });
});
