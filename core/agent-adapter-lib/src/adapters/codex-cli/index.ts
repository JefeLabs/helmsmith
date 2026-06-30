/**
 * CodexCliAdapter — `codex exec` subprocess adapter (provider: openai, Phase D‴).
 *
 * Implements the NEW AgentAdapter interface from src/agent.ts.
 * NOT exported from index.ts until Phase F (coexistence rule).
 *
 * Behaviour (verified against the REAL `codex` CLI v0.133.0):
 *   - stream(): spawns `codex exec --json --sandbox workspace-write
 *     --skip-git-repo-check --ignore-user-config --color never --model <model>
 *     <prompt>` via shared/child-process.ts with cwd = workdir. The conversation
 *     is the trailing positional prompt (codex exec has no --system-prompt flag —
 *     system prompt is folded into the prompt). stdin is closed (EOF) — codex
 *     exec otherwise prints "Reading additional input from stdin..." and blocks.
 *     Stdout is JSONL thread events (thread.started/turn.started/item.completed/
 *     turn.completed/turn.failed/error), parsed by CodexStreamParser → AgentChunk.
 *   - invoke(): reduceStream(stream(...)) — invoke/stream parity (PRD §10).
 *   - Sandbox: $HOME + $TMPDIR redirect to workdir so codex's own ~/.codex
 *     auth.json (ChatGPT OAuth) + config.toml are isolated; --ignore-user-config
 *     suppresses any user MCP servers; OPENAI_API_KEY is injected from the
 *     resolved credential so codex authenticates via API key.
 *   - Auth (PRD §12): spec.apiKey → broker.getCredential('openai') →
 *     OPENAI_API_KEY env; validated at construction → MissingCredentialError
 *     (fail-fast, never mid-stream).
 *   - Built-in tools (exec/patch/mcp/web_search) run autonomously and are
 *     surfaced as tool-call-* / tool-result chunks for observability only (PRD §11).
 *   - Reasoning items are surfaced as thinking-delta chunks.
 *   - AbortSignal → SIGTERM→SIGKILL (shared child-process) → finishReason:'aborted'.
 *   - Capabilities: CAPABILITY_MATRIX['codex-cli'].
 */

import type {
  AgentAdapter,
  AgentInput,
  AgentInvocationResult,
  AgentSpecType,
  ChatMessage,
  CodexCliSpec,
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
import { buildCodexFlags, CODEX_BINARY } from './flags.ts';
import { CodexStreamParser } from './stream-parser.ts';

/** The provider whose credential this adapter injects, and the env var it reads. */
const CODEX_PROVIDER = 'openai';
const CODEX_API_KEY_ENV = 'OPENAI_API_KEY';

// ---------------------------------------------------------------------------
// CodexCliAdapter
// ---------------------------------------------------------------------------

export class CodexCliAdapter implements AgentAdapter {
  readonly type: AgentSpecType = 'codex-cli';
  readonly capabilities: AdapterCapabilities;
  readonly workdir: string;

  private readonly spec: CodexCliSpec;
  private readonly apiKey: string;
  private readonly binary: string;
  private readonly logger?: Logger;

  constructor(spec: CodexCliSpec, deps: AdapterDeps, apiKey: string) {
    this.spec = spec;
    this.workdir = deps.workdir;
    this.capabilities = CAPABILITY_MATRIX['codex-cli'];
    this.apiKey = apiKey;
    this.logger = deps.logger;
    this.binary = resolveBinary(CODEX_BINARY, spec.binaryPath);
  }

  async invoke(input: AgentInput, opts?: InvokeOptions): Promise<AgentInvocationResult> {
    this._checkToolCapability(input);
    return reduceStream(this.stream(input, opts));
  }

  async *stream(input: AgentInput, opts?: InvokeOptions): AsyncIterable<AgentChunk> {
    this._checkToolCapability(input);

    const args = [...buildCodexFlags(this.spec), serializePrompt(input, this.spec)];
    const env = this._buildSandboxEnv();

    const handle = spawnAgentProcess({
      binary: this.binary,
      args,
      cwd: this.workdir,
      env,
      // Close stdin (EOF) — codex exec reads stdin and would otherwise block.
      stdin: '',
      ...(opts?.signal !== undefined ? { signal: opts.signal } : {}),
      ...(opts?.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
    });

    const parser = new CodexStreamParser({ ...(this.logger ? { logger: this.logger } : {}) });
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
  // Sandbox env: $HOME + $TMPDIR → workdir; inject OPENAI_API_KEY.
  // -------------------------------------------------------------------------

  private _buildSandboxEnv(): NodeJS.ProcessEnv {
    return {
      ...process.env,
      ...this.spec.env,
      // Sandbox + injected credential WIN over any spec.env / inherited values.
      HOME: this.workdir,
      TMPDIR: this.workdir,
      [CODEX_API_KEY_ENV]: this.apiKey,
    };
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
 * codex exec takes the prompt as a single positional arg (no stdin stream-json,
 * no --system-prompt flag), so the conversation is flattened: optional system
 * prompt, then each message's text, joined with blank lines.
 */
export function serializePrompt(input: AgentInput, spec: CodexCliSpec): string {
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
  return new ProviderError(`codex-cli: ${message}`, { cause: err });
}

// ---------------------------------------------------------------------------
// API key resolution (async — broker may need network)
// ---------------------------------------------------------------------------

export async function resolveApiKey(
  spec: CodexCliSpec,
  broker?: CredentialBroker,
  logger?: Logger,
): Promise<string> {
  if (spec.apiKey) return spec.apiKey;
  if (broker) {
    try {
      const cred = await broker.getCredential(CODEX_PROVIDER);
      if (cred.apiKey) return cred.apiKey;
    } catch (err) {
      // Don't swallow silently — log and fall back to env.
      logger?.warn?.(
        `[codex-cli] credential broker failed for '${CODEX_PROVIDER}'; falling back to env: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
  const envKey = process.env[CODEX_API_KEY_ENV];
  if (envKey) return envKey;
  throw new MissingCredentialError(
    'No OpenAI API key found for codex-cli adapter. Provide one via spec.apiKey, ' +
      'CredentialBroker.getCredential("openai"), or the OPENAI_API_KEY environment variable. ' +
      "The adapter sandboxes $HOME, so codex's own ~/.codex auth is not reachable.",
  );
}

// ---------------------------------------------------------------------------
// Factory + self-registration
// ---------------------------------------------------------------------------

registerAdapter(
  'codex-cli',
  (spec, deps) => {
    const cliSpec = spec as CodexCliSpec;
    // Precedence must match resolveApiKey: spec → broker → env. Only an explicit
    // spec.apiKey short-circuits; when a broker is present we defer to lazy
    // resolution so the broker is PREFERRED over env (token rotation).
    if (cliSpec.apiKey) return new CodexCliAdapter(cliSpec, deps, cliSpec.apiKey);
    if (deps.credentialBroker) {
      return new LazyCodexCliAdapter(cliSpec, deps, deps.credentialBroker);
    }
    const envKey = process.env[CODEX_API_KEY_ENV];
    if (envKey) return new CodexCliAdapter(cliSpec, deps, envKey);
    throw new MissingCredentialError(
      'No OpenAI API key found for codex-cli adapter. Provide one via spec.apiKey, ' +
        'CredentialBroker.getCredential("openai"), or the OPENAI_API_KEY environment variable.',
    );
  },
  CAPABILITY_MATRIX['codex-cli'],
);

// ---------------------------------------------------------------------------
// LazyCodexCliAdapter — defers API key resolution to first invoke/stream
// ---------------------------------------------------------------------------

class LazyCodexCliAdapter implements AgentAdapter {
  readonly type: AgentSpecType = 'codex-cli';
  readonly capabilities: AdapterCapabilities;
  readonly workdir: string;

  private _inner: CodexCliAdapter | null = null;
  private _resolving: Promise<CodexCliAdapter> | null = null;

  constructor(
    private readonly spec: CodexCliSpec,
    private readonly deps: AdapterDeps,
    private readonly broker: CredentialBroker,
  ) {
    this.workdir = deps.workdir;
    this.capabilities = CAPABILITY_MATRIX['codex-cli'];
  }

  private async _resolve(): Promise<CodexCliAdapter> {
    if (this._inner) return this._inner;
    if (!this._resolving) {
      this._resolving = resolveApiKey(this.spec, this.broker, this.deps.logger).then((apiKey) => {
        this._inner = new CodexCliAdapter(this.spec, this.deps, apiKey);
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
