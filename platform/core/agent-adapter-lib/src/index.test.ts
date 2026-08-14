/**
 * Public-surface smoke test.
 *
 * Importing the root entry must expose createAgent and the registry API, and
 * must register NOTHING. The host decides which adapters exist by importing
 * their subpath entries (@helmsmith/agent-adapter/adapters/<spec.type>) and
 * calling the registrar.
 *
 * This inverts the pre-externalization contract, where importing the root
 * pulled all 11 adapter modules — three of which statically import an optional
 * provider SDK, so a host without those peers installed crashed at module load.
 */

import { describe, expect, it } from 'vitest';
import * as lib from './index.ts';

describe('public surface', () => {
  it('exports createAgent + the registry API', () => {
    expect(typeof lib.createAgent).toBe('function');
    expect(typeof lib.getAdapterFactory).toBe('function');
    expect(typeof lib.registerAdapter).toBe('function');
    expect(typeof lib.registeredAdapterTypes).toBe('function');
  });

  it('registers no adapters on import', () => {
    expect(lib.registeredAdapterTypes()).toEqual([]);
    expect(lib.listAdapterTypes()).toEqual([]);
    expect(lib.getCapabilities('claude-sdk')).toBeUndefined();
  });

  it('still describes all 11 adapters in the static catalog', () => {
    // The catalog plane survives a side-effect-free root: a host can browse what
    // exists before deciding what to register, without loading a single SDK.
    expect(Object.keys(lib.ADAPTER_CATALOG)).toHaveLength(11);
    expect(lib.ADAPTER_CATALOG['bedrock-sdk'].capabilities.toolUseMode).toBe('host-loop');
  });

  it('re-exports the error taxonomy + capability helpers', () => {
    expect(lib.AdapterError).toBeDefined();
    expect(lib.AuthError).toBeDefined();
    expect(lib.WorkdirNotARepoError).toBeDefined();
    expect(typeof lib.intersectCapabilities).toBe('function');
    expect(typeof lib.reduceStream).toBe('function');
  });
});
