/**
 * OpenCodeCliAdapter — `opencode` CLI subprocess adapter (PRD §8.3, Phase D).
 *
 * Implements the NEW AgentAdapter interface from src/agent.ts.
 * NOT exported from index.ts until Phase F (coexistence rule); the OLD flat
 * src/opencode-cli-adapter.ts keeps serving current consumers until then.
 *
 * Behaviour (verified against the REAL `opencode` CLI v1.17.5):
 *   - stream(): spawns `opencode run --format json --pure --thinking
 *     --model <provider/model> <prompt>` via shared/child-process.ts with
 *     cwd = workdir; the prompt is a positional arg (opencode has no
 *     stdin/stream-json input). Stdout is newline-delimited JSON events
 *     (`step_start`/`text`/`reasoning`/`tool_use`/`step_finish`/`error`),
 *     parsed by OpencodeStreamParser → AgentChunk.
 *   - invoke(): reduceStream(stream(...)) — invoke/stream parity (PRD §10).
 *   - Sandbox (PRD §8.3): $HOME + $TMPDIR redirect to workdir so opencode's own
 *     ~/.local/share/opencode auth + config are isolated; XDG_CONFIG_HOME points
 *     at a temp config dir with an opencode.json that suppresses MCP and
 *     registers the requested model (opencode's catalogs are curated — an
 *     out-of-catalog model otherwise throws ProviderModelNotFoundError).
 *   - Auth (PRD §12): the provider credential is injected as the provider's env
 *     var (anthropic → ANTHROPIC_API_KEY, etc.) from broker.getCredential(...);
 *     validated at construction → MissingCredentialError (fail-fast).
 *   - PORTED from the old flat adapter: local-endpoint mode (endpoint /
 *     endpointProviderId / staticApiKey → custom opencode.json provider),
 *     XDG config-dir isolation + MCP suppression, --attach/serverUrl mode,
 *     provider env-var injection.
 *   - AbortSignal → SIGTERM→SIGKILL (shared child-process) → finishReason:'aborted'.
 *   - Capabilities: CAPABILITY_MATRIX['opencode-cli'].
 *
 * KNOWN MATRIX DISCREPANCY (flagged, not silently diverged — see report):
 *   The v1.17.5 `--format json` stream DOES report token usage (step_finish
 *   `tokens`) and DOES surface reasoning (`reasoning` events + `--thinking`).
 *   CAPABILITY_MATRIX['opencode-cli'] still has the conservative Phase-A TBDs
 *   reportsUsage:false / supportsExtendedThinking:false. Flipping them is a
 *   Phase-A capabilities.ts change (its capabilities.test.ts asserts the
 *   current false values) and is intentionally left to that follow-up so this
 *   coexistence phase does not edit Phase-A files / break Phase-A tests.
 */

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  AgentAdapter,
  AgentInput,
  AgentInvocationResult,
  AgentSpecType,
  ChatMessage,
  InvokeOptions,
  Logger,
  OpenCodeCliSpec,
} from '../../agent.ts';
import type { AdapterCapabilities } from '../../capabilities.ts';
import { CAPABILITY_MATRIX } from '../../capabilities.ts';
import type { CredentialBroker } from '../../credentials/broker.ts';
import { AdapterError, ConfigError, MissingCredentialError, ProviderError } from '../../errors.ts';
import type { AdapterDeps } from '../../registry.ts';
import { registerAdapter } from '../../registry.ts';
import type { AgentChunk } from '../../stream.ts';
import { reduceStream } from '../../stream.ts';
import { resolveBinary, spawnAgentProcess } from '../shared/child-process.ts';
import { rejectCustomTools } from '../shared/reject-custom-tools.ts';
import { buildOpencodeFlags, OPENCODE_BINARY } from './flags.ts';
import { OpencodeStreamParser } from './stream-parser.ts';

// ---------------------------------------------------------------------------
// Provider → env var (the names opencode reads for built-in cloud providers)
// ---------------------------------------------------------------------------

const PROVIDER_ENV_VAR: Record<string, string> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  google: 'GOOGLE_API_KEY',
};

// ---------------------------------------------------------------------------
// Target resolution — model / provider / mode (shared by factory + adapter)
// ---------------------------------------------------------------------------

export interface OpencodeTarget {
  /** Local OpenAI-compatible endpoint mode (no broker credential). */
  isLocal: boolean;
  /** Logical provider id (built-in cloud provider, or the local provider id). */
  provider: string;
  /** Env var the injected credential is written to (cloud mode only). */
  envVar?: string;
  /** Fully-resolved `provider/model` string passed to --model. */
  model: string;
  /** Model id (after the `/`) registered in opencode.json. */
  registerModelId: string;
}

/** Resolve the model/provider/mode from the spec (pure; no I/O). */
export function resolveOpencodeTarget(spec: OpenCodeCliSpec): OpencodeTarget {
  const slashIdx = spec.model.indexOf('/');
  const registerModelId = slashIdx > 0 ? spec.model.slice(slashIdx + 1) : spec.model;

  if (spec.endpoint) {
    const provider = spec.endpointProviderId ?? 'local';
    // Ensure the model carries the local provider prefix opencode expects.
    const model = slashIdx > 0 ? spec.model : `${provider}/${spec.model}`;
    return { isLocal: true, provider, model, registerModelId };
  }

  const provider = spec.provider ?? (slashIdx > 0 ? spec.model.slice(0, slashIdx) : 'anthropic');
  const model = slashIdx > 0 ? spec.model : `${provider}/${spec.model}`;
  return { isLocal: false, provider, envVar: PROVIDER_ENV_VAR[provider], model, registerModelId };
}

// ---------------------------------------------------------------------------
// OpenCodeCliAdapter
// ---------------------------------------------------------------------------

export class OpenCodeCliAdapter implements AgentAdapter {
  readonly type: AgentSpecType = 'opencode-cli';
  readonly capabilities: AdapterCapabilities;
  readonly workdir: string;

  private readonly spec: OpenCodeCliSpec;
  private readonly apiKey: string;
  private readonly binary: string;
  private readonly logger?: Logger;
  private readonly target: OpencodeTarget;
  /** Temp XDG_CONFIG_HOME dir with the generated opencode.json (built once). */
  private readonly configDir: string;

  constructor(spec: OpenCodeCliSpec, deps: AdapterDeps, apiKey: string) {
    this.spec = spec;
    this.workdir = deps.workdir;
    this.capabilities = CAPABILITY_MATRIX['opencode-cli'];
    this.apiKey = apiKey;
    this.logger = deps.logger;
    this.target = resolveOpencodeTarget(spec);

    if (!this.target.isLocal && !this.target.envVar) {
      // e.g. github-copilot: opencode routes it via OAuth, which the $HOME
      // sandbox hides — there is no env-var path. Fail fast (PRD §13 D3).
      throw new ConfigError(
        `opencode-cli adapter does not support provider '${this.target.provider}' in the ` +
          'sandboxed cloud mode (no API-key env var). Use anthropic, openai, google, or set ' +
          '{ endpoint } for a self-hosted OpenAI-compatible server.',
      );
    }

    // Resolve the binary at construction (fail-fast BinaryNotFoundError, PRD §9).
    this.binary = resolveBinary(OPENCODE_BINARY, spec.binaryPath);
    // Build the isolated opencode.json once (model registration + MCP suppression).
    this.configDir = this._writeConfigDir();
  }

  // -------------------------------------------------------------------------
  // invoke — reduce the stream (PRD §10 parity guarantee)
  // -------------------------------------------------------------------------

  async invoke(input: AgentInput, opts?: InvokeOptions): Promise<AgentInvocationResult> {
    this._checkToolCapability(input);
    return reduceStream(this.stream(input, opts));
  }

  // -------------------------------------------------------------------------
  // stream — spawn opencode, parse stdout NDJSON → AgentChunk
  // -------------------------------------------------------------------------

  async *stream(input: AgentInput, opts?: InvokeOptions): AsyncIterable<AgentChunk> {
    this._checkToolCapability(input);

    const flags = buildOpencodeFlags({
      model: this.target.model,
      ...(this.spec.serverUrl ? { serverUrl: this.spec.serverUrl } : {}),
      workdir: this.workdir,
      ...(this.spec.dangerouslySkipPermissions ? { dangerouslySkipPermissions: true } : {}),
    });
    const args = [...flags, serializePrompt(input, this.spec)];
    const env = this._buildSandboxEnv();

    const handle = spawnAgentProcess({
      binary: this.binary,
      args,
      cwd: this.workdir,
      env,
      ...(opts?.signal !== undefined ? { signal: opts.signal } : {}),
      ...(opts?.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
    });

    const parser = new OpencodeStreamParser({ ...(this.logger ? { logger: this.logger } : {}) });
    let emittedTerminal = false;

    const track = (chunk: AgentChunk): AgentChunk => {
      if (chunk.type === 'message-stop' || chunk.type === 'error') emittedTerminal = true;
      return chunk;
    };

    try {
      for await (const line of handle.stdout) {
        for (const chunk of parser.pushLine(line)) {
          yield track(chunk);
        }
      }
      for (const chunk of parser.flush()) {
        yield track(chunk);
      }
      // Surface non-zero exit (rejects) / abort (resolves) from the subprocess.
      await handle.done;
    } catch (err) {
      if (opts?.signal?.aborted) {
        if (!emittedTerminal) yield { type: 'message-stop', finishReason: 'aborted' };
        return;
      }
      if (!emittedTerminal) yield { type: 'error', error: toAdapterError(err) };
      return;
    } finally {
      // Tear down the subprocess if the consumer broke out early.
      handle.abort();
    }

    if (opts?.signal?.aborted && !emittedTerminal) {
      yield { type: 'message-stop', finishReason: 'aborted' };
    } else if (!emittedTerminal) {
      yield { type: 'message-stop', finishReason: 'stop' };
    }
  }

  // -------------------------------------------------------------------------
  // Sandbox env (PRD §8.3): $HOME + $TMPDIR → workdir; XDG_CONFIG_HOME → temp
  // config dir; OPENCODE_DISABLE_MCP; inject provider credential (cloud mode).
  // -------------------------------------------------------------------------

  private _buildSandboxEnv(): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...this.spec.env,
      // Sandbox + isolation WIN over any spec.env / inherited values.
      HOME: this.workdir,
      TMPDIR: this.workdir,
      XDG_CONFIG_HOME: this.configDir,
      OPENCODE_DISABLE_MCP: '1',
    };
    // Cloud mode: inject the resolved credential as the provider's env var so
    // opencode authenticates with it (the $HOME sandbox hides its own auth).
    if (!this.target.isLocal && this.target.envVar) {
      env[this.target.envVar] = this.apiKey;
    }
    return env;
  }

  /**
   * Write a temp `<dir>/opencode/opencode.json` and return <dir> for
   * XDG_CONFIG_HOME. Suppresses MCP (defense-in-depth with --pure +
   * OPENCODE_DISABLE_MCP) and registers the requested model so opencode's
   * curated catalogs don't reject it with ProviderModelNotFoundError. Ported
   * from the old flat adapter's makeOpencodeConfigDir.
   */
  private _writeConfigDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'opencode-cfg-'));
    const config: Record<string, unknown> = { mcp: {} };

    if (this.target.isLocal && this.spec.endpoint) {
      // Custom OpenAI-compatible provider (self-hosted endpoint).
      const providerEntry: Record<string, unknown> = {
        options: {
          baseURL: this.spec.endpoint,
          apiKey: this.spec.staticApiKey ?? 'no-auth-required',
        },
        models: { [this.target.registerModelId]: {} },
      };
      config.provider = { [this.target.provider]: providerEntry };
    } else {
      // Extend a built-in cloud provider's catalog with the requested model.
      config.provider = {
        [this.target.provider]: { models: { [this.target.registerModelId]: {} } },
      };
    }

    const opencodeConfigDir = join(dir, 'opencode');
    mkdirSync(opencodeConfigDir, { recursive: true, mode: 0o700 });
    writeFileSync(join(opencodeConfigDir, 'opencode.json'), JSON.stringify(config, null, 2), {
      mode: 0o600,
    });
    return dir;
  }

  private _checkToolCapability(input: AgentInput): void {
    // Autonomous CLI: built-in tools only; reject host-injected custom tools.
    rejectCustomTools(this.type, input);
  }
}

// ---------------------------------------------------------------------------
// Prompt serialization — AgentInput.messages → one positional prompt string
// ---------------------------------------------------------------------------

/**
 * opencode `run` takes the prompt as a positional arg (no stdin stream-json),
 * so the conversation is flattened: optional system prompt, then each message's
 * text, joined with blank lines. Single-shot — multi-turn resume is a v1.1
 * concern (opencode's --continue/--session).
 */
export function serializePrompt(input: AgentInput, spec: OpenCodeCliSpec): string {
  const system = input.systemPrompt ?? spec.systemPrompt;
  const parts: string[] = [];
  if (system && system.length > 0) parts.push(system);
  for (const m of input.messages) parts.push(textOf(m.content));
  return parts.filter((p) => p.length > 0).join('\n\n');
}

function textOf(content: ChatMessage['content']): string {
  if (typeof content === 'string') return content;
  return content
    .map((block) => {
      switch (block.type) {
        case 'text':
          return block.text;
        case 'thinking':
          return block.thinking;
        case 'tool-use':
          return `[tool-use ${block.name}: ${JSON.stringify(block.input)}]`;
        default:
          return '';
      }
    })
    .filter(Boolean)
    .join('\n');
}

// ---------------------------------------------------------------------------
// Error normalization
// ---------------------------------------------------------------------------

function toAdapterError(err: unknown): AdapterError {
  if (err instanceof AdapterError) return err;
  const message = err instanceof Error ? err.message : String(err);
  return new ProviderError(`opencode-cli: ${message}`, { cause: err });
}

// ---------------------------------------------------------------------------
// API key resolution (async — broker may need network). Cloud mode only.
// ---------------------------------------------------------------------------

export async function resolveApiKey(
  spec: OpenCodeCliSpec,
  broker?: CredentialBroker,
  logger?: Logger,
): Promise<string> {
  const target = resolveOpencodeTarget(spec);
  // Local-endpoint mode authenticates via opencode.json staticApiKey, not env.
  if (target.isLocal) return spec.staticApiKey ?? 'no-auth-required';

  if (spec.apiKey) return spec.apiKey;
  if (broker) {
    try {
      const cred = await broker.getCredential(target.provider);
      if (cred.apiKey) return cred.apiKey;
    } catch (err) {
      // Don't swallow silently — log and fall back to env.
      logger?.warn?.(
        `[opencode-cli] credential broker failed for '${target.provider}'; falling back to env: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
  const envVar = target.envVar;
  const envKey = envVar ? process.env[envVar] : undefined;
  if (envKey) return envKey;
  throw new MissingCredentialError(
    `No API key found for opencode-cli adapter (provider '${target.provider}'). Provide one via ` +
      `spec.apiKey, CredentialBroker.getCredential("${target.provider}"), or the ${envVar ?? 'provider'} ` +
      "environment variable. The adapter sandboxes $HOME, so opencode's own auth is not reachable.",
  );
}

// ---------------------------------------------------------------------------
// Factory + self-registration
// ---------------------------------------------------------------------------

registerAdapter(
  'opencode-cli',
  (spec, deps) => {
    const cliSpec = spec as OpenCodeCliSpec;
    const target = resolveOpencodeTarget(cliSpec);

    // Local-endpoint mode needs no broker credential.
    if (target.isLocal) {
      return new OpenCodeCliAdapter(cliSpec, deps, cliSpec.staticApiKey ?? 'no-auth-required');
    }

    // Precedence must match resolveApiKey: spec → broker → env. Only an explicit
    // spec.apiKey short-circuits; when a broker is present we defer to lazy
    // resolution so the broker is PREFERRED over env (token rotation).
    if (cliSpec.apiKey) return new OpenCodeCliAdapter(cliSpec, deps, cliSpec.apiKey);
    if (deps.credentialBroker) {
      return new LazyOpenCodeCliAdapter(cliSpec, deps, deps.credentialBroker);
    }
    const envKey = target.envVar ? process.env[target.envVar] : undefined;
    if (envKey) return new OpenCodeCliAdapter(cliSpec, deps, envKey);
    throw new MissingCredentialError(
      `No API key found for opencode-cli adapter (provider '${target.provider}'). Provide one via ` +
        `spec.apiKey, CredentialBroker.getCredential("${target.provider}"), or the ` +
        `${target.envVar ?? 'provider'} environment variable.`,
    );
  },
  CAPABILITY_MATRIX['opencode-cli'],
);

// ---------------------------------------------------------------------------
// LazyOpenCodeCliAdapter — defers API key resolution to first invoke/stream
// ---------------------------------------------------------------------------

class LazyOpenCodeCliAdapter implements AgentAdapter {
  readonly type: AgentSpecType = 'opencode-cli';
  readonly capabilities: AdapterCapabilities;
  readonly workdir: string;

  private _inner: OpenCodeCliAdapter | null = null;
  private _resolving: Promise<OpenCodeCliAdapter> | null = null;

  constructor(
    private readonly spec: OpenCodeCliSpec,
    private readonly deps: AdapterDeps,
    private readonly broker: CredentialBroker,
  ) {
    this.workdir = deps.workdir;
    this.capabilities = CAPABILITY_MATRIX['opencode-cli'];
  }

  private async _resolve(): Promise<OpenCodeCliAdapter> {
    if (this._inner) return this._inner;
    if (!this._resolving) {
      this._resolving = resolveApiKey(this.spec, this.broker, this.deps.logger).then((apiKey) => {
        this._inner = new OpenCodeCliAdapter(this.spec, this.deps, apiKey);
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
