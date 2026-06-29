import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdapterCapabilities, AgentAdapter, AgentSpec, AgentSpecType } from './agent.ts';
import {
  _clearRegistry,
  getAdapterFactory,
  registerAdapter,
  registeredAdapterTypes,
} from './registry.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCaps(overrides: Partial<AdapterCapabilities> = {}): AdapterCapabilities {
  return {
    reportsUsage: false,
    supportsStreaming: false,
    supportsToolUse: false,
    supportsExtendedThinking: false,
    supportsCancellation: false,
    supportsCapture: false,
    supportsJsonMode: false,
    supportsSessionResume: false,
    ...overrides,
  };
}

function makeAdapter(type: AgentSpecType, workdir = '/tmp/test'): AgentAdapter {
  return {
    type,
    workdir,
    capabilities: makeCaps(),
    invoke: vi.fn(),
    stream: vi.fn(),
  };
}

const fakeSpec = (type: AgentSpecType): AgentSpec => ({ type, model: 'test-model' }) as AgentSpec;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('registry', () => {
  beforeEach(() => {
    _clearRegistry();
  });

  afterEach(() => {
    _clearRegistry();
  });

  describe('registerAdapter / getAdapterFactory', () => {
    it('returns undefined for an unregistered type', () => {
      expect(getAdapterFactory('claude-sdk')).toBeUndefined();
    });

    it('returns the registered factory after registration', () => {
      const factory = vi.fn(() => makeAdapter('claude-sdk'));
      const caps = makeCaps({ reportsUsage: true });

      registerAdapter('claude-sdk', factory, caps);

      const entry = getAdapterFactory('claude-sdk');
      expect(entry).toBeDefined();
      expect(entry!.factory).toBe(factory);
      expect(entry!.capabilities).toEqual(caps);
    });

    it('factory can be invoked to produce an adapter', () => {
      const adapter = makeAdapter('claude-code-cli');
      const factory = vi.fn(() => adapter);
      registerAdapter('claude-code-cli', factory, makeCaps());

      const entry = getAdapterFactory('claude-code-cli')!;
      const spec = fakeSpec('claude-code-cli');
      const deps = {
        workdir: '/repo',
        repoRoot: '/repo',
        commit: 'abc123',
        branch: 'main',
      };
      const result = entry.factory(spec, deps);
      expect(result).toBe(adapter);
      expect(factory).toHaveBeenCalledWith(spec, deps);
    });

    it('returns undefined for a type that was never registered', () => {
      registerAdapter('claude-sdk', vi.fn(), makeCaps());
      expect(getAdapterFactory('opencode-cli')).toBeUndefined();
    });
  });

  describe('registeredAdapterTypes', () => {
    it('returns empty array when registry is clear', () => {
      expect(registeredAdapterTypes()).toEqual([]);
    });

    it('lists all registered types', () => {
      registerAdapter('claude-sdk', vi.fn(), makeCaps());
      registerAdapter('claude-code-cli', vi.fn(), makeCaps());

      const types = registeredAdapterTypes();
      expect(types).toContain('claude-sdk');
      expect(types).toContain('claude-code-cli');
      expect(types).toHaveLength(2);
    });
  });

  describe('duplicate registration', () => {
    it('overwrites the existing factory with a warning', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const factory1 = vi.fn(() => makeAdapter('claude-sdk'));
        const factory2 = vi.fn(() => makeAdapter('claude-sdk'));

        registerAdapter('claude-sdk', factory1, makeCaps());
        registerAdapter('claude-sdk', factory2, makeCaps());

        // Warning was emitted on the second registration
        expect(warnSpy).toHaveBeenCalledOnce();
        expect(warnSpy.mock.calls[0][0]).toContain('claude-sdk');

        // Factory2 is now active
        const entry = getAdapterFactory('claude-sdk')!;
        entry.factory(fakeSpec('claude-sdk'), {
          workdir: '/x',
          repoRoot: '/x',
          commit: 'sha',
          branch: 'main',
        });
        expect(factory2).toHaveBeenCalledOnce();
        expect(factory1).not.toHaveBeenCalled();
      } finally {
        warnSpy.mockRestore();
      }
    });
  });

  describe('_clearRegistry', () => {
    it('removes all registered factories', () => {
      registerAdapter('claude-sdk', vi.fn(), makeCaps());
      registerAdapter('opencode-cli', vi.fn(), makeCaps());
      _clearRegistry();
      expect(registeredAdapterTypes()).toEqual([]);
    });
  });
});
