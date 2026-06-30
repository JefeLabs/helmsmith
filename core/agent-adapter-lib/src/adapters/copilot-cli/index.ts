/**
 * CopilotCliAdapter — `gh copilot` CLI subprocess adapter (PRD §8.5, Phase D′).
 *
 * Implements the NEW AgentAdapter interface from src/agent.ts.
 * NOT exported from index.ts until Phase F (coexistence rule).
 *
 * ⚠️ SHAPE DEVIATION (see flags.ts): the installed `gh copilot` v1.2.0 is the
 * agentic Copilot CLI launcher (no `suggest`/`--target`). This adapter wraps its
 * documented NON-INTERACTIVE PRINT MODE (`gh copilot -- -p "<prompt>"
 * --allow-all-tools …`) — single-shot, single-block output. Per the plan, the
 * surfaced contract stays "limited": no streaming, no host-injected tools.
 *
 * Behaviour:
 *   - stream(): spawns the launcher via shared/child-process.ts with cwd=workdir,
 *     buffers ALL stdout, then emits ONE synthetic text-delta + message-stop so
 *     the streaming contract holds without being incremental (PRD §8.5).
 *   - invoke(): reduceStream(stream(...)) — invoke/stream parity (PRD §10).
 *   - Sandbox (PRD §8.5): $HOME + $TMPDIR redirect to workdir so `gh`/`copilot`
 *     state (~/.config/gh, ~/.copilot) is isolated and the agentic tools' blast
 *     radius is bounded to the workdir.
 *   - Auth (PRD §8.5 / §12): `gh` honours GH_TOKEN; injected into the child env.
 *     ⚠️ BROKER GAP (FLAGGED, not blocking): the broker's 'github-copilot'
 *     provider now returns the EXCHANGED Copilot session token (Phase 0), NOT the
 *     raw GitHub OAuth token that `gh` needs. There is no broker provider that
 *     surfaces the raw GitHub token for the CLI today, so this adapter reads
 *     GH_TOKEN/GITHUB_TOKEN from env/spec.env (best-effort broker.getCredential
 *     ('github') is attempted for forward-compat). MissingCredentialError at
 *     construction when none resolves (fail-fast).
 *   - Tool use: NOT host-injectable. supportsToolUse:false — a custom `tools`
 *     array is rejected by the shared capability guard (mirrors claude-code-cli /
 *     opencode-cli; a later consolidated fix centralizes this).
 *   - AbortSignal → SIGTERM→SIGKILL (shared child-process) → finishReason:'aborted'.
 *   - Capabilities: CAPABILITY_MATRIX['copilot-cli'].
 */

import type {
  AgentAdapter,
  AgentInput,
  AgentInvocationResult,
  AgentSpecType,
  CopilotCliSpec,
  InvokeOptions,
  Logger,
} from '../../agent.ts';
import type { AdapterCapabilities } from '../../capabilities.ts';
import { CAPABILITY_MATRIX } from '../../capabilities.ts';
import type { CredentialBroker } from '../../credentials/broker.ts';
import {
  AdapterError,
  CapabilityMismatchError,
  MissingCredentialError,
  ProviderError,
} from '../../errors.ts';
import type { AdapterDeps } from '../../registry.ts';
import { registerAdapter } from '../../registry.ts';
import type { AgentChunk } from '../../stream.ts';
import { reduceStream } from '../../stream.ts';
import { resolveBinary, spawnAgentProcess } from '../shared/child-process.ts';
import { buildCopilotCliArgs, COPILOT_CLI_BINARY } from './flags.ts';

// ---------------------------------------------------------------------------
// CopilotCliAdapter
// ---------------------------------------------------------------------------

export class CopilotCliAdapter implements AgentAdapter {
  readonly type: AgentSpecType = 'copilot-cli';
  readonly capabilities: AdapterCapabilities;
  readonly workdir: string;

  private readonly spec: CopilotCliSpec;
  private readonly ghToken: string;
  private readonly binary: string;
  private readonly logger?: Logger;

  constructor(spec: CopilotCliSpec, deps: AdapterDeps, ghToken: string) {
    this.spec = spec;
    this.workdir = deps.workdir;
    this.capabilities = CAPABILITY_MATRIX['copilot-cli'];
    this.ghToken = ghToken;
    this.logger = deps.logger;
    // Resolve the binary at construction (fail-fast BinaryNotFoundError, PRD §9).
    this.binary = resolveBinary(COPILOT_CLI_BINARY, spec.binaryPath);
  }

  // -------------------------------------------------------------------------
  // invoke — reduce the stream (PRD §10 parity guarantee)
  // -------------------------------------------------------------------------

  async invoke(input: AgentInput, opts?: InvokeOptions): Promise<AgentInvocationResult> {
    this._checkToolCapability(input);
    return reduceStream(this.stream(input, opts));
  }

  // -------------------------------------------------------------------------
  // stream — spawn `gh copilot`, buffer stdout, emit ONE synthetic text-delta
  // -------------------------------------------------------------------------

  async *stream(input: AgentInput, opts?: InvokeOptions): AsyncIterable<AgentChunk> {
    this._checkToolCapability(input);

    const args = buildCopilotCliArgs(this.spec, input);
    const env = this._buildSandboxEnv();

    this.logger?.debug?.('[copilot-cli] spawn', { binary: this.binary, args, cwd: this.workdir });

    const handle = spawnAgentProcess({
      binary: this.binary,
      args,
      cwd: this.workdir,
      env,
      ...(opts?.signal !== undefined ? { signal: opts.signal } : {}),
      ...(opts?.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
    });

    const lines: string[] = [];
    try {
      for await (const line of handle.stdout) {
        lines.push(line);
      }
      // Surface non-zero exit (rejects) / abort (resolves) from the subprocess.
      await handle.done;
    } catch (err) {
      if (opts?.signal?.aborted) {
        yield { type: 'message-stop', finishReason: 'aborted' };
        return;
      }
      yield { type: 'error', error: toAdapterError(err) };
      return;
    } finally {
      // Tear down the subprocess if the consumer broke out early.
      handle.abort();
    }

    if (opts?.signal?.aborted) {
      yield { type: 'message-stop', finishReason: 'aborted' };
      return;
    }

    // Single-block output → ONE synthetic text-delta + message-stop (PRD §8.5).
    const text = lines.join('\n').trim();
    if (text.length > 0) {
      yield { type: 'text-delta', text };
    }
    yield { type: 'message-stop', finishReason: 'stop' };
  }

  // -------------------------------------------------------------------------
  // Sandbox env (PRD §8.5): $HOME + $TMPDIR → workdir; inject GH_TOKEN
  // -------------------------------------------------------------------------

  private _buildSandboxEnv(): NodeJS.ProcessEnv {
    return {
      ...process.env,
      ...this.spec.env,
      // Sandbox + injected credential WIN over any spec.env / inherited values.
      HOME: this.workdir,
      TMPDIR: this.workdir,
      GH_TOKEN: this.ghToken,
      GITHUB_TOKEN: this.ghToken,
    };
  }

  private _checkToolCapability(input: AgentInput): void {
    if (input.tools?.length && !this.capabilities.supportsToolUse) {
      throw new CapabilityMismatchError(
        `Adapter type '${this.type}' does not support tool use (supportsToolUse: false). ` +
          `Remove the 'tools' array from AgentInput, or choose an adapter that supports it.`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Error normalization
// ---------------------------------------------------------------------------

function toAdapterError(err: unknown): AdapterError {
  if (err instanceof AdapterError) return err;
  const message = err instanceof Error ? err.message : String(err);
  return new ProviderError(`copilot-cli: ${message}`, { cause: err });
}

// ---------------------------------------------------------------------------
// GH token resolution (async — broker may need network)
// ---------------------------------------------------------------------------

/**
 * Resolve the GitHub token `gh` needs. Priority: spec.env.GH_TOKEN →
 * process.env.GH_TOKEN → process.env.GITHUB_TOKEN → broker.getCredential('github')
 * (best-effort forward-compat) → MissingCredentialError.
 *
 * See the class doc + report: the broker does not currently surface the raw
 * GitHub token for the CLI (its 'github-copilot' provider returns the exchanged
 * Copilot session token, which `gh` cannot use).
 */
export async function resolveGhToken(
  spec: CopilotCliSpec,
  broker?: CredentialBroker,
): Promise<string> {
  const fromEnv = spec.env?.GH_TOKEN ?? process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
  if (fromEnv) return fromEnv;
  if (broker) {
    try {
      const cred = await broker.getCredential('github');
      if (cred.apiKey) return cred.apiKey;
    } catch {
      // No 'github' provider — fall through.
    }
  }
  throw new MissingCredentialError(
    'No GitHub token found for copilot-cli adapter. `gh` needs the GitHub OAuth token (GH_TOKEN), ' +
      'NOT the exchanged Copilot session token. Provide it via spec.env.GH_TOKEN, the GH_TOKEN / ' +
      'GITHUB_TOKEN environment variable, or a broker that resolves the "github" provider. ' +
      "The adapter sandboxes $HOME, so `gh`'s own ~/.config/gh auth is not reachable.",
  );
}

// ---------------------------------------------------------------------------
// Factory + self-registration
// ---------------------------------------------------------------------------

registerAdapter(
  'copilot-cli',
  (spec, deps) => {
    const cliSpec = spec as CopilotCliSpec;
    const syncToken =
      cliSpec.env?.GH_TOKEN ?? process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? undefined;

    if (!syncToken && !deps.credentialBroker) {
      throw new MissingCredentialError(
        'No GitHub token found for copilot-cli adapter. `gh` needs GH_TOKEN (the GitHub OAuth ' +
          'token, NOT the exchanged Copilot session token). Provide it via spec.env.GH_TOKEN, ' +
          'the GH_TOKEN / GITHUB_TOKEN environment variable, or a broker resolving "github".',
      );
    }

    if (!syncToken && deps.credentialBroker) {
      return new LazyCopilotCliAdapter(cliSpec, deps, deps.credentialBroker);
    }

    return new CopilotCliAdapter(cliSpec, deps, syncToken as string);
  },
  CAPABILITY_MATRIX['copilot-cli'],
);

// ---------------------------------------------------------------------------
// LazyCopilotCliAdapter — defers token resolution to first invoke/stream
// ---------------------------------------------------------------------------

class LazyCopilotCliAdapter implements AgentAdapter {
  readonly type: AgentSpecType = 'copilot-cli';
  readonly capabilities: AdapterCapabilities;
  readonly workdir: string;

  private _inner: CopilotCliAdapter | null = null;
  private _resolving: Promise<CopilotCliAdapter> | null = null;

  constructor(
    private readonly spec: CopilotCliSpec,
    private readonly deps: AdapterDeps,
    private readonly broker: CredentialBroker,
  ) {
    this.workdir = deps.workdir;
    this.capabilities = CAPABILITY_MATRIX['copilot-cli'];
  }

  private async _resolve(): Promise<CopilotCliAdapter> {
    if (this._inner) return this._inner;
    if (!this._resolving) {
      this._resolving = resolveGhToken(this.spec, this.broker).then((token) => {
        this._inner = new CopilotCliAdapter(this.spec, this.deps, token);
        return this._inner;
      });
    }
    return this._resolving;
  }

  async invoke(input: AgentInput, opts?: InvokeOptions): Promise<AgentInvocationResult> {
    const adapter = await this._resolve();
    return adapter.invoke(input, opts);
  }

  async *stream(input: AgentInput, opts?: InvokeOptions): AsyncIterable<AgentChunk> {
    const adapter = await this._resolve();
    yield* adapter.stream(input, opts);
  }
}
