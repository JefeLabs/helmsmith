/**
 * Adapter registry — registerAdapter / getAdapterFactory (PRD §6).
 *
 * Phase A: the built-in registry is empty. Adapters self-register in Phases
 * B–D′. The registry is the dispatch table for createAgent().
 *
 * AdapterFactory receives the resolved spec + deps (workdir, repoRoot, commit,
 * branch, optional credentialBroker + logger) and returns a ready AgentAdapter.
 */

import type {
  AdapterCapabilities,
  AgentAdapter,
  AgentSpec,
  AgentSpecType,
  Logger,
} from './agent.ts';
import type { CredentialBroker } from './credentials/broker.ts';

// ---------------------------------------------------------------------------
// AdapterDeps — construction-time context passed from createAgent to factory
// ---------------------------------------------------------------------------

export interface AdapterDeps {
  workdir: string;
  repoRoot: string;
  commit: string;
  branch: string;
  credentialBroker?: CredentialBroker;
  logger?: Logger;
  signal?: AbortSignal;
}

// ---------------------------------------------------------------------------
// AdapterFactory
// ---------------------------------------------------------------------------

/** A factory function that constructs an AgentAdapter from a spec + deps. */
export type AdapterFactory = (spec: AgentSpec, deps: AdapterDeps) => AgentAdapter;

// ---------------------------------------------------------------------------
// Registry internals
// ---------------------------------------------------------------------------

interface RegistryEntry {
  factory: AdapterFactory;
  capabilities: AdapterCapabilities;
}

const _registry = new Map<AgentSpecType, RegistryEntry>();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Register an adapter factory for the given type.
 *
 * Registering a type that already has a factory emits a warning and
 * overwrites the previous entry. This allows test code to override
 * built-in adapters and lets late-loading plugins replace stubs.
 */
export function registerAdapter(
  type: AgentSpecType,
  factory: AdapterFactory,
  capabilities: AdapterCapabilities,
): void {
  if (_registry.has(type)) {
    console.warn(`[agent-adapter/registry] overwriting existing factory for type '${type}'`);
  }
  _registry.set(type, { factory, capabilities });
}

/**
 * Retrieve the registered factory entry for the given type.
 * Returns undefined when no factory has been registered for that type.
 */
export function getAdapterFactory(type: AgentSpecType): RegistryEntry | undefined {
  return _registry.get(type);
}

/**
 * Return a snapshot of all currently registered adapter types.
 */
export function registeredAdapterTypes(): AgentSpecType[] {
  return [..._registry.keys()];
}

/**
 * FOR TESTING ONLY — clear all registered adapters.
 * Prefixed with _ to signal internal/test use.
 */
export function _clearRegistry(): void {
  _registry.clear();
}
