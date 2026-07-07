/**
 * CopilotCliAdapter — standalone `copilot` CLI subprocess adapter (PRD §8.5).
 *
 * Implements the NEW AgentAdapter interface from src/agent.ts.
 * NOT exported from index.ts until Phase F (coexistence rule).
 *
 * Targets the REAL standalone GitHub Copilot CLI v1.0.65 (`copilot`, NOT the old
 * `gh copilot` launcher) in its documented NON-INTERACTIVE PRINT MODE:
 *
 *   copilot -p "<prompt>" --allow-all-tools --add-dir <workdir> --no-color --silent
 *
 * The standalone `copilot` is an AUTONOMOUS agent (edits files, runs shell,
 * searches the codebase), so the adapter reports toolUseMode:'autonomous'
 * (supportsToolUse:true). See flags.ts for the verified flag set.
 *
 * Behaviour:
 *   - stream(): spawns `copilot` via shared/child-process.ts with cwd=workdir,
 *     buffers ALL stdout (text print mode), then emits ONE synthetic text-delta +
 *     message-stop. The adapter does NOT parse the JSONL (`--output-format json`)
 *     stream — text mode is the verified-robust path — so supportsStreaming:false.
 *   - invoke(): reduceStream(stream(...)) — invoke/stream parity (PRD §10).
 *   - Sandbox (PRD §8.5): $HOME + $TMPDIR redirect to workdir so `copilot` state
 *     (~/.copilot) is isolated and the agent's blast radius is bounded to the
 *     workdir (mirrors opencode's sandbox).
 *   - Auth (PRD §8.5 / §12): the standalone `copilot` reads its token from the
 *     env in precedence order COPILOT_GITHUB_TOKEN → GH_TOKEN → GITHUB_TOKEN
 *     (`copilot login --help`). The adapter injects the resolved token as all
 *     three so headless auth works despite the $HOME sandbox hiding `copilot
 *     login`'s stored credential store. Supported token types: fine-grained PATs
 *     with "Copilot Requests", Copilot CLI OAuth tokens, and `gh` OAuth tokens
 *     (classic ghp_ PATs are NOT supported). MissingCredentialError at
 *     construction when none resolves (fail-fast).
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
import { AdapterError, MissingCredentialError, ProviderError } from '../../errors.ts';
import type { AdapterDeps } from '../../registry.ts';
import { registerAdapter } from '../../registry.ts';
import type { AgentChunk } from '../../stream.ts';
import { reduceStream } from '../../stream.ts';
import { resolveBinary, spawnAgentProcess } from '../shared/child-process.ts';
import { rejectCustomTools } from '../shared/reject-custom-tools.ts';
import { buildCopilotCliArgs, COPILOT_CLI_BINARY } from './flags.ts';

// ---------------------------------------------------------------------------
// CopilotCliAdapter
// ---------------------------------------------------------------------------

export class CopilotCliAdapter implements AgentAdapter {
  readonly type: AgentSpecType = 'copilot-cli';
  readonly capabilities: AdapterCapabilities;
  readonly workdir: string;

  private readonly spec: CopilotCliSpec;
  private readonly token: string;
  private readonly binary: string;
  private readonly logger?: Logger;

  constructor(spec: CopilotCliSpec, deps: AdapterDeps, token: string) {
    this.spec = spec;
    this.workdir = deps.workdir;
    this.capabilities = CAPABILITY_MATRIX['copilot-cli'];
    this.token = token;
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
  // stream — spawn `copilot`, buffer stdout, emit ONE synthetic text-delta
  // -------------------------------------------------------------------------

  async *stream(input: AgentInput, opts?: InvokeOptions): AsyncIterable<AgentChunk> {
    this._checkToolCapability(input);

    const args = buildCopilotCliArgs(this.spec, input, this.workdir);
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

    // Text print mode → ONE synthetic text-delta + message-stop (PRD §8.5).
    const text = lines.join('\n').trim();
    if (text.length > 0) {
      yield { type: 'text-delta', text };
    }
    yield { type: 'message-stop', finishReason: 'stop' };
  }

  // -------------------------------------------------------------------------
  // Sandbox env (PRD §8.5): $HOME + $TMPDIR → workdir; inject the Copilot token
  // -------------------------------------------------------------------------

  private _buildSandboxEnv(): NodeJS.ProcessEnv {
    return {
      ...process.env,
      ...this.spec.env,
      // Sandbox + injected credential WIN over any spec.env / inherited values.
      HOME: this.workdir,
      TMPDIR: this.workdir,
      // The standalone `copilot` checks COPILOT_GITHUB_TOKEN → GH_TOKEN →
      // GITHUB_TOKEN (in precedence order); inject all three.
      COPILOT_GITHUB_TOKEN: this.token,
      GH_TOKEN: this.token,
      GITHUB_TOKEN: this.token,
    };
  }

  private _checkToolCapability(input: AgentInput): void {
    // Autonomous CLI: built-in tools only; reject host-injected custom tools.
    rejectCustomTools(this.type, input);
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
// Token resolution (async — broker may need network)
// ---------------------------------------------------------------------------

/** Read a Copilot/GitHub token from the standard env precedence + spec.env. */
function tokenFromEnv(spec: CopilotCliSpec): string | undefined {
  return (
    spec.env?.COPILOT_GITHUB_TOKEN ??
    spec.env?.GH_TOKEN ??
    spec.env?.GITHUB_TOKEN ??
    process.env.COPILOT_GITHUB_TOKEN ??
    process.env.GH_TOKEN ??
    process.env.GITHUB_TOKEN
  );
}

/**
 * Resolve the token the standalone `copilot` needs. Priority: spec.env /
 * process.env (COPILOT_GITHUB_TOKEN → GH_TOKEN → GITHUB_TOKEN) →
 * broker.getCredential('github') (best-effort forward-compat) →
 * MissingCredentialError.
 */
export async function resolveCopilotToken(
  spec: CopilotCliSpec,
  broker?: CredentialBroker,
  logger?: Logger,
): Promise<string> {
  const fromEnv = tokenFromEnv(spec);
  if (fromEnv) return fromEnv;
  if (broker) {
    try {
      const cred = await broker.getCredential('github');
      if (cred.apiKey) return cred.apiKey;
    } catch (err) {
      // No 'github' provider — log and fall through (don't swallow silently).
      logger?.warn?.(
        `[copilot-cli] credential broker failed for 'github': ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
  throw new MissingCredentialError(
    'No GitHub token found for copilot-cli adapter. The standalone `copilot` needs a token via ' +
      'COPILOT_GITHUB_TOKEN / GH_TOKEN / GITHUB_TOKEN (a fine-grained PAT with "Copilot Requests", ' +
      'a Copilot CLI OAuth token, or a `gh` OAuth token — classic ghp_ PATs are not supported). ' +
      'Provide it via spec.env, the environment, or a broker resolving the "github" provider. ' +
      "The adapter sandboxes $HOME, so `copilot login`'s stored credential is not reachable.",
  );
}

// ---------------------------------------------------------------------------
// Factory + self-registration
// ---------------------------------------------------------------------------

registerAdapter(
  'copilot-cli',
  (spec, deps) => {
    const cliSpec = spec as CopilotCliSpec;
    const syncToken = tokenFromEnv(cliSpec);

    if (!syncToken && !deps.credentialBroker) {
      throw new MissingCredentialError(
        'No GitHub token found for copilot-cli adapter. The standalone `copilot` needs a token via ' +
          'COPILOT_GITHUB_TOKEN / GH_TOKEN / GITHUB_TOKEN (a fine-grained PAT with "Copilot ' +
          'Requests", a Copilot CLI OAuth token, or a `gh` OAuth token). Provide it via spec.env, ' +
          'the environment, or a broker resolving the "github" provider.',
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
      this._resolving = resolveCopilotToken(this.spec, this.broker, this.deps.logger).then(
        (token) => {
          this._inner = new CopilotCliAdapter(this.spec, this.deps, token);
          return this._inner;
        },
      );
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
