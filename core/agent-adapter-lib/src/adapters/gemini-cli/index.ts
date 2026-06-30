/**
 * GeminiCliAdapter — `gemini` CLI subprocess adapter (provider: google, Phase D‴).
 *
 * Implements the NEW AgentAdapter interface from src/agent.ts.
 * NOT exported from index.ts until Phase F (coexistence rule).
 *
 * Behaviour (verified against the REAL `gemini` CLI v0.43.0):
 *   - stream(): spawns `gemini --output-format stream-json --approval-mode yolo
 *     --skip-trust --allowed-mcp-server-names "" --model <model> -p <prompt>`
 *     via shared/child-process.ts with cwd = workdir. The conversation is the
 *     `-p` value (gemini has no stdin stream-json input and no --system-prompt
 *     flag — system prompt is folded into the prompt). stdin is closed (EOF)
 *     so gemini does not block reading additional stdin. Stdout is
 *     newline-delimited JSON (init/message/tool_use/tool_result/error/result),
 *     parsed by GeminiStreamParser → AgentChunk.
 *   - invoke(): reduceStream(stream(...)) — invoke/stream parity (PRD §10).
 *   - Sandbox: $HOME + $TMPDIR redirect to workdir so gemini's own ~/.gemini
 *     OAuth + settings (incl. user MCP config) are isolated; GEMINI_API_KEY is
 *     injected from the resolved credential (the var gemini reads for USE_GEMINI
 *     API-key auth). --allowed-mcp-server-names "" + the $HOME sandbox suppress
 *     MCP (PRD no-MCP).
 *   - Auth (PRD §12): spec.apiKey → broker.getCredential('google') →
 *     GEMINI_API_KEY env; validated at construction → MissingCredentialError
 *     (fail-fast, never mid-stream).
 *   - Built-in tools run autonomously and are surfaced as tool-call-* /
 *     tool-result chunks for observability only (PRD §11).
 *   - AbortSignal → SIGTERM→SIGKILL (shared child-process) → finishReason:'aborted'.
 *   - Capabilities: CAPABILITY_MATRIX['gemini-cli'].
 */

import type {
  AgentAdapter,
  AgentInput,
  AgentInvocationResult,
  AgentSpecType,
  ChatMessage,
  GeminiCliSpec,
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
import { buildGeminiFlags, GEMINI_BINARY } from './flags.ts';
import { GeminiStreamParser } from './stream-parser.ts';

/** The provider whose credential this adapter injects, and the env var it reads. */
const GEMINI_PROVIDER = 'google';
const GEMINI_API_KEY_ENV = 'GEMINI_API_KEY';

// ---------------------------------------------------------------------------
// GeminiCliAdapter
// ---------------------------------------------------------------------------

export class GeminiCliAdapter implements AgentAdapter {
  readonly type: AgentSpecType = 'gemini-cli';
  readonly capabilities: AdapterCapabilities;
  readonly workdir: string;

  private readonly spec: GeminiCliSpec;
  private readonly apiKey: string;
  private readonly binary: string;
  private readonly logger?: Logger;

  constructor(spec: GeminiCliSpec, deps: AdapterDeps, apiKey: string) {
    this.spec = spec;
    this.workdir = deps.workdir;
    this.capabilities = CAPABILITY_MATRIX['gemini-cli'];
    this.apiKey = apiKey;
    this.logger = deps.logger;
    this.binary = resolveBinary(GEMINI_BINARY, spec.binaryPath);
  }

  async invoke(input: AgentInput, opts?: InvokeOptions): Promise<AgentInvocationResult> {
    this._checkToolCapability(input);
    return reduceStream(this.stream(input, opts));
  }

  async *stream(input: AgentInput, opts?: InvokeOptions): AsyncIterable<AgentChunk> {
    this._checkToolCapability(input);

    const args = [...buildGeminiFlags(this.spec), '--prompt', serializePrompt(input, this.spec)];
    const env = this._buildSandboxEnv();

    const handle = spawnAgentProcess({
      binary: this.binary,
      args,
      cwd: this.workdir,
      env,
      // Close stdin (EOF) — gemini appends stdin to -p and would otherwise block.
      stdin: '',
      ...(opts?.signal !== undefined ? { signal: opts.signal } : {}),
      ...(opts?.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
    });

    const parser = new GeminiStreamParser({ ...(this.logger ? { logger: this.logger } : {}) });
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
      await handle.done;
    } catch (err) {
      if (opts?.signal?.aborted) {
        if (!emittedTerminal) yield { type: 'message-stop', finishReason: 'aborted' };
        return;
      }
      if (!emittedTerminal) yield { type: 'error', error: toAdapterError(err) };
      return;
    } finally {
      handle.abort();
    }

    if (opts?.signal?.aborted && !emittedTerminal) {
      yield { type: 'message-stop', finishReason: 'aborted' };
    } else if (!emittedTerminal) {
      yield { type: 'message-stop', finishReason: 'stop' };
    }
  }

  // -------------------------------------------------------------------------
  // Sandbox env: $HOME + $TMPDIR → workdir; inject GEMINI_API_KEY.
  // -------------------------------------------------------------------------

  private _buildSandboxEnv(): NodeJS.ProcessEnv {
    return {
      ...process.env,
      ...this.spec.env,
      // Sandbox + injected credential WIN over any spec.env / inherited values.
      HOME: this.workdir,
      TMPDIR: this.workdir,
      [GEMINI_API_KEY_ENV]: this.apiKey,
    };
  }

  private _checkToolCapability(input: AgentInput): void {
    // Autonomous CLI: built-in tools only; reject host-injected custom tools.
    rejectCustomTools(this.type, input);
  }
}

// ---------------------------------------------------------------------------
// Prompt serialization — AgentInput.messages → one `-p` prompt string
// ---------------------------------------------------------------------------

/**
 * gemini `-p` takes the prompt as a single string (no stdin stream-json, no
 * --system-prompt flag), so the conversation is flattened: optional system
 * prompt, then each message's text, joined with blank lines.
 */
export function serializePrompt(input: AgentInput, spec: GeminiCliSpec): string {
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
  return new ProviderError(`gemini-cli: ${message}`, { cause: err });
}

// ---------------------------------------------------------------------------
// API key resolution (async — broker may need network)
// ---------------------------------------------------------------------------

export async function resolveApiKey(
  spec: GeminiCliSpec,
  broker?: CredentialBroker,
  logger?: Logger,
): Promise<string> {
  if (spec.apiKey) return spec.apiKey;
  if (broker) {
    try {
      const cred = await broker.getCredential(GEMINI_PROVIDER);
      if (cred.apiKey) return cred.apiKey;
    } catch (err) {
      // Don't swallow silently — log and fall back to env.
      logger?.warn?.(
        `[gemini-cli] credential broker failed for '${GEMINI_PROVIDER}'; falling back to env: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
  const envKey = process.env[GEMINI_API_KEY_ENV];
  if (envKey) return envKey;
  throw new MissingCredentialError(
    'No Google/Gemini API key found for gemini-cli adapter. Provide one via spec.apiKey, ' +
      'CredentialBroker.getCredential("google"), or the GEMINI_API_KEY environment variable. ' +
      "The adapter sandboxes $HOME, so the CLI's own ~/.gemini OAuth is not reachable.",
  );
}

// ---------------------------------------------------------------------------
// Factory + self-registration
// ---------------------------------------------------------------------------

registerAdapter(
  'gemini-cli',
  (spec, deps) => {
    const cliSpec = spec as GeminiCliSpec;
    // Precedence must match resolveApiKey: spec → broker → env. Only an explicit
    // spec.apiKey short-circuits; when a broker is present we defer to lazy
    // resolution so the broker is PREFERRED over env (token rotation).
    if (cliSpec.apiKey) return new GeminiCliAdapter(cliSpec, deps, cliSpec.apiKey);
    if (deps.credentialBroker) {
      return new LazyGeminiCliAdapter(cliSpec, deps, deps.credentialBroker);
    }
    const envKey = process.env[GEMINI_API_KEY_ENV];
    if (envKey) return new GeminiCliAdapter(cliSpec, deps, envKey);
    throw new MissingCredentialError(
      'No Google/Gemini API key found for gemini-cli adapter. Provide one via spec.apiKey, ' +
        'CredentialBroker.getCredential("google"), or the GEMINI_API_KEY environment variable.',
    );
  },
  CAPABILITY_MATRIX['gemini-cli'],
);

// ---------------------------------------------------------------------------
// LazyGeminiCliAdapter — defers API key resolution to first invoke/stream
// ---------------------------------------------------------------------------

class LazyGeminiCliAdapter implements AgentAdapter {
  readonly type: AgentSpecType = 'gemini-cli';
  readonly capabilities: AdapterCapabilities;
  readonly workdir: string;

  private _inner: GeminiCliAdapter | null = null;
  private _resolving: Promise<GeminiCliAdapter> | null = null;

  constructor(
    private readonly spec: GeminiCliSpec,
    private readonly deps: AdapterDeps,
    private readonly broker: CredentialBroker,
  ) {
    this.workdir = deps.workdir;
    this.capabilities = CAPABILITY_MATRIX['gemini-cli'];
  }

  private async _resolve(): Promise<GeminiCliAdapter> {
    if (this._inner) return this._inner;
    if (!this._resolving) {
      this._resolving = resolveApiKey(this.spec, this.broker, this.deps.logger).then((apiKey) => {
        this._inner = new GeminiCliAdapter(this.spec, this.deps, apiKey);
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
