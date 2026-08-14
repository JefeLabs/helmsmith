/**
 * Host-plane capability introspection (PRD §8.7).
 *
 * These helpers answer "what can THIS HOST do" by reading the runtime registry.
 * That is the truthful answer once adapters are registered explicitly: a host
 * that registered two adapters can do two things, regardless of how many exist
 * in the source tree.
 *
 * For "what adapters exist at all" — the question a host asks BEFORE deciding
 * what to register — read ADAPTER_CATALOG from catalog.ts. It is static data and
 * needs no adapter module or provider SDK loaded.
 *
 * AdapterCapabilities is defined in agent.ts (shared core type); re-exported
 * from here for callers that only import from this module.
 */

import type { AdapterCapabilities, AgentSpecType } from './agent.ts';
import { getAdapterFactory, registeredAdapterTypes } from './registry.ts';

export type { AdapterCapabilities } from './agent.ts';

// ---------------------------------------------------------------------------
// getCapabilities
// ---------------------------------------------------------------------------

/**
 * Capabilities of an adapter THIS HOST registered, or undefined if it did not.
 *
 * Prefer this over reading ADAPTER_CATALOG when you want the descriptor that is
 * actually in force: adapters may refine their capabilities at construction
 * (copilot-sdk resolves supportsJsonMode from spec.model), and external adapters
 * are not in the catalog at all.
 */
export function getCapabilities(type: AgentSpecType): AdapterCapabilities | undefined {
  return getAdapterFactory(type)?.capabilities;
}

// ---------------------------------------------------------------------------
// listAdapterTypes
// ---------------------------------------------------------------------------

/**
 * Registered adapter types whose capabilities match every key in the filter.
 * An empty (or absent) filter returns every registered type.
 *
 * Example:
 *   listAdapterTypes({ toolUseMode: 'autonomous' })  // registered agentic adapters
 *   listAdapterTypes({ supportsStreaming: true })     // registered streaming adapters
 *   listAdapterTypes()                                // everything registered
 *
 * Returns [] on a host that has registered nothing — that is not a bug, it is
 * the answer. Use ADAPTER_CATALOG to browse what could be registered.
 */
export function listAdapterTypes(filter?: Partial<AdapterCapabilities>): AgentSpecType[] {
  const types = registeredAdapterTypes();
  if (!filter || Object.keys(filter).length === 0) return types;

  const keys = Object.keys(filter) as (keyof AdapterCapabilities)[];
  return types.filter((type) => {
    const caps = getAdapterFactory(type)?.capabilities;
    return caps !== undefined && keys.every((key) => caps[key] === filter[key]);
  });
}

// ---------------------------------------------------------------------------
// intersectCapabilities
// ---------------------------------------------------------------------------

/**
 * Compute the intersection of two capability sets: for each boolean flag,
 * the result is true only if BOTH inputs are true. Useful for determining
 * the effective capabilities when composing adapters.
 */
export function intersectCapabilities(
  a: AdapterCapabilities,
  b: AdapterCapabilities,
): AdapterCapabilities {
  const supportsToolUse = a.supportsToolUse && b.supportsToolUse;
  return {
    reportsUsage: a.reportsUsage && b.reportsUsage,
    supportsStreaming: a.supportsStreaming && b.supportsStreaming,
    supportsToolUse,
    // Tool use is only composable when both sides agree on the mode; differing
    // modes (autonomous vs host-loop) have no shared execution model → 'none'.
    toolUseMode: supportsToolUse && a.toolUseMode === b.toolUseMode ? a.toolUseMode : 'none',
    supportsExtendedThinking: a.supportsExtendedThinking && b.supportsExtendedThinking,
    supportsCancellation: a.supportsCancellation && b.supportsCancellation,
    supportsCapture: a.supportsCapture && b.supportsCapture,
    supportsJsonMode: a.supportsJsonMode && b.supportsJsonMode,
    supportsSessionResume: a.supportsSessionResume && b.supportsSessionResume,
  };
}
