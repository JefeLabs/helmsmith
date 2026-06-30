/**
 * createAgent — the main entry point for the new agent-adapter surface (PRD §6).
 *
 * Responsibilities (in order):
 *   1. Validate workdir is a git working tree → WorkdirNotARepoError.
 *   2. Resolve repo metadata (repoRoot, commit, branch) — best-effort.
 *   3. Look up factory for spec.type → throws for unregistered types.
 *   4. CapabilityMismatchError if spec implies a capability the type lacks.
 *   5. Invoke the factory + return the adapter.
 *
 * Git check is synchronous (spawnSync) so createAgent() itself is synchronous.
 * Credential resolution happens inside invoke()/stream() — not here.
 *
 * NOT exported from index.ts in Phase A (coexistence rule).
 */

import { spawnSync } from 'node:child_process';
import type { AgentAdapter, AgentSpec, CreateAgentArgs } from './agent.ts';
import { CAPABILITY_MATRIX } from './capabilities.ts';
import { WorkdirNotARepoError } from './errors.ts';
// CapabilityMismatchError is used in Phase B+ when adapters land; import added then.
import { getAdapterFactory } from './registry.ts';

// ---------------------------------------------------------------------------
// Git helpers (synchronous — spawnSync is safe here; this is a CLI factory)
// ---------------------------------------------------------------------------

function validateGitWorkdir(workdir: string): void {
  const result = spawnSync('git', ['-C', workdir, 'rev-parse', '--is-inside-work-tree'], {
    encoding: 'utf8',
    timeout: 5000,
  });
  if (result.error || result.status !== 0 || result.stdout.trim() !== 'true') {
    throw new WorkdirNotARepoError(
      `'${workdir}' is not inside a git working tree. ` +
        `Run 'git init' to initialize a repo, or pass a valid git working-tree path as workdir.`,
    );
  }
}

function resolveRepoMetadata(workdir: string): {
  repoRoot: string;
  commit: string;
  branch: string;
} {
  const run = (args: string[]): string =>
    spawnSync('git', ['-C', workdir, ...args], {
      encoding: 'utf8',
      timeout: 5000,
    }).stdout.trim();

  return {
    repoRoot: run(['rev-parse', '--show-toplevel']) || workdir,
    commit: run(['rev-parse', 'HEAD']) || 'unknown',
    branch: run(['rev-parse', '--abbrev-ref', 'HEAD']) || 'unknown',
  };
}

// ---------------------------------------------------------------------------
// Capability mismatch check
// ---------------------------------------------------------------------------

/**
 * Check that the spec type's static capabilities are consistent with any
 * capability requirements implied by spec fields.
 *
 * Phase A: only a structural hook. Actual per-field checks are added as
 * adapters land in Phases B–D′ (e.g. tool definitions in AgentInput).
 */
function checkCapabilityMismatch(spec: AgentSpec): void {
  const caps = CAPABILITY_MATRIX[spec.type];
  if (!caps) return; // unregistered type — handled below

  // Future: if spec carries explicit tool definitions at spec level, check
  // caps.supportsToolUse. For now the only spec-level capability signal is
  // the type itself, so no mismatch is possible in Phase A.
  // Kept as a placeholder with a clear throw path for Phase B+.
  void caps; // satisfy linter
}

// ---------------------------------------------------------------------------
// createAgent
// ---------------------------------------------------------------------------

/**
 * Construct an AgentAdapter bound to the given workdir and spec.
 *
 * Throws:
 *   - WorkdirNotARepoError   if workdir is not a git working tree.
 *   - CapabilityMismatchError if the spec requires a capability the type lacks.
 *   - Error                  if spec.type has no registered factory.
 */
export function createAgent(args: CreateAgentArgs): AgentAdapter {
  const { spec, workdir, credentialBroker, logger, signal } = args;

  // Step 1 — git working-tree validation
  validateGitWorkdir(workdir);

  // Step 2 — repo metadata (best-effort; never throws)
  const { repoRoot, commit, branch } = resolveRepoMetadata(workdir);

  // Step 3 — look up factory
  const entry = getAdapterFactory(spec.type);
  if (!entry) {
    throw new Error(
      `No adapter factory registered for spec.type '${spec.type}'. ` +
        `Adapters are self-registered in Phases B–D′. ` +
        `Ensure the adapter module has been imported before calling createAgent().`,
    );
  }

  // Step 4 — capability mismatch check
  checkCapabilityMismatch(spec);

  // Additional: verify static matrix agrees with registered capabilities.
  // If the registered capabilities differ from the static matrix, prefer
  // the registered entry (allows adapters to override statics).
  const staticCaps = CAPABILITY_MATRIX[spec.type];
  if (staticCaps) {
    // Phase A: no mismatch checks against user input (tools are in AgentInput,
    // not in CreateAgentArgs). CapabilityMismatchError reserved for Phase B+.
    void staticCaps;
  }

  // Step 5 — construct + return
  return entry.factory(spec, {
    workdir,
    repoRoot,
    commit,
    branch,
    credentialBroker,
    logger,
    signal,
  });
}
