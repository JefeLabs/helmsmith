/**
 * Public-surface smoke test.
 *
 * Importing the root barrel must (a) expose `createAgent` and (b) register all
 * 11 built-in adapters via the ./adapters side-effect import, so
 * `getAdapterFactory(type)` resolves for every AgentSpecType.
 */

import { describe, expect, it } from 'vitest';
import * as lib from './index.ts';

const ALL_TYPES: lib.AgentSpecType[] = [
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

describe('public surface', () => {
  it('exports createAgent + the registry API', () => {
    expect(typeof lib.createAgent).toBe('function');
    expect(typeof lib.getAdapterFactory).toBe('function');
    expect(typeof lib.registerAdapter).toBe('function');
  });

  it('registers all 11 built-in adapters on import (side-effect)', () => {
    for (const type of ALL_TYPES) {
      expect(lib.getAdapterFactory(type), `factory for '${type}'`).toBeDefined();
    }
    expect(new Set(lib.registeredAdapterTypes())).toEqual(new Set(ALL_TYPES));
  });

  it('re-exports the error taxonomy + capabilities helpers', () => {
    expect(lib.AdapterError).toBeDefined();
    expect(lib.AuthError).toBeDefined();
    expect(lib.WorkdirNotARepoError).toBeDefined();
    expect(lib.listAdapterTypes()).toHaveLength(11);
    expect(Object.keys(lib.CAPABILITY_MATRIX)).toHaveLength(11);
  });
});
