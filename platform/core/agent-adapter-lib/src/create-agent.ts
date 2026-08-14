/**
 * createAgent — the main entry point for the new agent-adapter surface (PRD §6).
 *
 * Responsibilities (in order):
 *   1. Validate workdir is a git working tree → WorkdirNotARepoError.
 *   2. Resolve repo metadata (repoRoot, commit, branch) — best-effort.
 *   3. Look up factory for spec.type → throws for unregistered types.
 *   4. Invoke the factory + return the adapter.
 *
 * Git check is synchronous (spawnSync) so createAgent() itself is synchronous.
 * Credential resolution happens inside invoke()/stream() — not here.
 */

import { spawnSync } from 'node:child_process';
import type { AgentAdapter, CreateAgentArgs } from './agent.ts';
import { WorkdirNotARepoError } from './errors.ts';
import { getAdapterFactory, registeredAdapterTypes } from './registry.ts';

// ---------------------------------------------------------------------------
// Registrar naming
// ---------------------------------------------------------------------------

/**
 * Registrar names that a naive word-by-word capitalization gets wrong, because
 * the type string spells a compound word as one token.
 */
const REGISTRAR_OVERRIDES: Record<string, string> = {
  'opencode-cli': 'OpenCodeCli',
  'openai-sdk': 'OpenAiSdk',
};

/** 'claude-agent-sdk' → 'ClaudeAgentSdk'. Mirrors the exported registrar names. */
function registrarSuffix(type: string): string {
  const override = REGISTRAR_OVERRIDES[type];
  if (override) return override;

  const ACRONYMS: Record<string, string> = { sdk: 'Sdk', cli: 'Cli' };
  return type
    .split('-')
    .map((part) => ACRONYMS[part] ?? part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

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
// createAgent
// ---------------------------------------------------------------------------

/**
 * Construct an AgentAdapter bound to the given workdir and spec.
 *
 * Throws:
 *   - WorkdirNotARepoError if workdir is not a git working tree.
 *   - Error                if spec.type has no registered factory.
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
    const registered = registeredAdapterTypes();
    const registrar = `register${registrarSuffix(spec.type)}`;
    throw new Error(
      `No adapter factory registered for spec.type '${spec.type}'.\n` +
        `Register it at your entry point:\n` +
        `  import { ${registrar} } from '@helmsmith/agent-adapter/adapters/${spec.type}';\n` +
        `  ${registrar}();\n` +
        `Currently registered: ${registered.length > 0 ? registered.join(', ') : '(none)'}`,
    );
  }

  // Step 4 — construct + return.
  //
  // `entry.capabilities` is the authoritative descriptor: built-ins pass their
  // ADAPTER_CATALOG row at registration, and external adapters supply their own.
  // There is no separate static matrix to reconcile against.
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
