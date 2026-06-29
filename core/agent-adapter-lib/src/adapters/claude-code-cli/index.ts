/**
 * ClaudeCodeCliAdapter — `claude` CLI subprocess adapter (PRD §8.2, Phase C).
 *
 * Implements the NEW AgentAdapter interface from src/agent.ts.
 * NOT exported from index.ts until Phase F (coexistence rule).
 *
 * Behaviour:
 *   - stream(): spawns `claude --print --output-format stream-json
 *     --input-format stream-json ...` via shared/child-process.ts with
 *     cwd = workdir, pipes the conversation over stdin as stream-json, reads
 *     stdout stream-json → ClaudeStreamParser → AgentChunk.
 *   - invoke(): reduceStream(stream(...)) — invoke/stream parity (PRD §10).
 *   - Sandbox (PRD §8.2): $HOME + $TMPDIR are redirected to workdir so the
 *     CLI's own ~/.claude state is isolated; ANTHROPIC_API_KEY is injected
 *     from the resolved credential (the sandbox hides the CLI's own auth).
 *   - Auth (PRD §12, §13 D7): spec.apiKey → broker.getCredential('anthropic')
 *     → ANTHROPIC_API_KEY env; validated at construction → MissingCredentialError
 *     (fail-fast, never mid-stream).
 *   - Built-in tools run autonomously inside the subprocess and are surfaced as
 *     tool-call-* / tool-result chunks for observability only (PRD §11); the
 *     host cannot inject custom tool definitions.
 *   - AbortSignal → SIGTERM→SIGKILL (shared child-process) → finishReason:'aborted'.
 *   - Capabilities: CAPABILITY_MATRIX['claude-code-cli'].
 */

import type {
  AgentAdapter,
  AgentInput,
  AgentInvocationResult,
  AgentSpecType,
  ChatMessage,
  ClaudeCodeCliSpec,
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
import { buildClaudeFlags, CLAUDE_BINARY } from './flags.ts';
import { ClaudeStreamParser } from './stream-parser.ts';

// ---------------------------------------------------------------------------
// ClaudeCodeCliAdapter
// ---------------------------------------------------------------------------

export class ClaudeCodeCliAdapter implements AgentAdapter {
  readonly type: AgentSpecType = 'claude-code-cli';
  readonly capabilities: AdapterCapabilities;
  readonly workdir: string;

  private readonly spec: ClaudeCodeCliSpec;
  private readonly apiKey: string;
  private readonly binary: string;
  private readonly logger?: Logger;

  constructor(spec: ClaudeCodeCliSpec, deps: AdapterDeps, apiKey: string) {
    this.spec = spec;
    this.workdir = deps.workdir;
    this.capabilities = CAPABILITY_MATRIX['claude-code-cli'];
    this.apiKey = apiKey;
    this.logger = deps.logger;
    // Resolve the binary at construction (fail-fast BinaryNotFoundError, PRD §9).
    this.binary = resolveBinary(CLAUDE_BINARY, spec.binaryPath);
  }

  // -------------------------------------------------------------------------
  // invoke — reduce the stream (PRD §10 parity guarantee)
  // -------------------------------------------------------------------------

  async invoke(input: AgentInput, opts?: InvokeOptions): Promise<AgentInvocationResult> {
    this._checkToolCapability(input);
    return reduceStream(this.stream(input, opts));
  }

  // -------------------------------------------------------------------------
  // stream — spawn claude, pipe stdin, parse stdout stream-json → AgentChunk
  // -------------------------------------------------------------------------

  async *stream(input: AgentInput, opts?: InvokeOptions): AsyncIterable<AgentChunk> {
    this._checkToolCapability(input);

    const args = buildClaudeFlags(this.spec, input);
    const env = this._buildSandboxEnv();
    const stdin = serializeStdin(input);

    const handle = spawnAgentProcess({
      binary: this.binary,
      args,
      cwd: this.workdir,
      env,
      stdin,
      ...(opts?.signal !== undefined ? { signal: opts.signal } : {}),
      ...(opts?.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
    });

    const parser = new ClaudeStreamParser({ ...(this.logger ? { logger: this.logger } : {}) });
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
      // If the consumer broke out early (generator return), make sure the
      // subprocess is torn down. No-op if it already exited.
      handle.abort();
    }

    // Normal close without an explicit terminal chunk.
    if (opts?.signal?.aborted && !emittedTerminal) {
      yield { type: 'message-stop', finishReason: 'aborted' };
    } else if (!emittedTerminal) {
      yield { type: 'message-stop', finishReason: 'stop' };
    }
  }

  // -------------------------------------------------------------------------
  // Sandbox env (PRD §8.2): $HOME + $TMPDIR → workdir; inject ANTHROPIC_API_KEY
  // -------------------------------------------------------------------------

  private _buildSandboxEnv(): NodeJS.ProcessEnv {
    return {
      ...process.env,
      ...this.spec.env,
      // Sandbox + injected credential WIN over any spec.env / inherited values.
      HOME: this.workdir,
      TMPDIR: this.workdir,
      ANTHROPIC_API_KEY: this.apiKey,
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
// stdin serialization — AgentInput.messages → stream-json input lines
// ---------------------------------------------------------------------------

/**
 * Serialize the conversation into `claude --input-format stream-json` lines.
 * Each message becomes one newline-terminated JSON object:
 *   {"type":"user"|"assistant","message":{"role","content"}}
 * `content` passes through verbatim when it is a string; ContentBlock[] is
 * mapped to the Anthropic block shape the CLI expects.
 */
export function serializeStdin(input: AgentInput): string {
  return `${input.messages.map((m) => JSON.stringify(toStreamJsonMessage(m))).join('\n')}\n`;
}

function toStreamJsonMessage(message: ChatMessage): {
  type: 'user' | 'assistant';
  message: { role: 'user' | 'assistant'; content: unknown };
} {
  const content =
    typeof message.content === 'string' ? message.content : message.content.map(toAnthropicBlock);
  return { type: message.role, message: { role: message.role, content } };
}

function toAnthropicBlock(block: Exclude<ChatMessage['content'], string>[number]): unknown {
  switch (block.type) {
    case 'text':
      return { type: 'text', text: block.text };
    case 'tool-use':
      return { type: 'tool_use', id: block.id, name: block.name, input: block.input };
    case 'thinking':
      return { type: 'thinking', thinking: block.thinking };
    default:
      return block;
  }
}

// ---------------------------------------------------------------------------
// Error normalization
// ---------------------------------------------------------------------------

function toAdapterError(err: unknown): AdapterError {
  // Already-classified subclasses (ProviderError from spawnAgentProcess's
  // exit-code mapping, BinaryNotFoundError, etc.) pass through unchanged.
  if (err instanceof AdapterError) return err;
  const message = err instanceof Error ? err.message : String(err);
  return new ProviderError(`claude-code-cli: ${message}`, { cause: err });
}

// ---------------------------------------------------------------------------
// API key resolution (async — broker may need network)
// ---------------------------------------------------------------------------

export async function resolveApiKey(
  spec: ClaudeCodeCliSpec,
  broker?: CredentialBroker,
): Promise<string> {
  if (spec.apiKey) return spec.apiKey;
  if (broker) {
    try {
      const cred = await broker.getCredential('anthropic');
      if (cred.apiKey) return cred.apiKey;
    } catch {
      // fall through to env var
    }
  }
  const envKey = process.env.ANTHROPIC_API_KEY;
  if (envKey) return envKey;
  throw new MissingCredentialError(
    'No Anthropic API key found for claude-code-cli adapter. Provide one via spec.apiKey, ' +
      'CredentialBroker.getCredential("anthropic"), or the ANTHROPIC_API_KEY environment variable. ' +
      "The adapter sandboxes $HOME, so the CLI's own ~/.claude auth is not reachable.",
  );
}

// ---------------------------------------------------------------------------
// Factory + self-registration
// ---------------------------------------------------------------------------

registerAdapter(
  'claude-code-cli',
  (spec, deps) => {
    const cliSpec = spec as ClaudeCodeCliSpec;
    const syncKey = cliSpec.apiKey ?? process.env.ANTHROPIC_API_KEY;

    if (!syncKey && !deps.credentialBroker) {
      throw new MissingCredentialError(
        'No Anthropic API key found for claude-code-cli adapter. Provide one via spec.apiKey, ' +
          'CredentialBroker.getCredential("anthropic"), or the ANTHROPIC_API_KEY environment variable.',
      );
    }

    if (!syncKey && deps.credentialBroker) {
      return new LazyClaudeCodeCliAdapter(cliSpec, deps, deps.credentialBroker);
    }

    return new ClaudeCodeCliAdapter(cliSpec, deps, syncKey as string);
  },
  CAPABILITY_MATRIX['claude-code-cli'],
);

// ---------------------------------------------------------------------------
// LazyClaudeCodeCliAdapter — defers API key resolution to first invoke/stream
// ---------------------------------------------------------------------------

class LazyClaudeCodeCliAdapter implements AgentAdapter {
  readonly type: AgentSpecType = 'claude-code-cli';
  readonly capabilities: AdapterCapabilities;
  readonly workdir: string;

  private _inner: ClaudeCodeCliAdapter | null = null;
  private _resolving: Promise<ClaudeCodeCliAdapter> | null = null;

  constructor(
    private readonly spec: ClaudeCodeCliSpec,
    private readonly deps: AdapterDeps,
    private readonly broker: CredentialBroker,
  ) {
    this.workdir = deps.workdir;
    this.capabilities = CAPABILITY_MATRIX['claude-code-cli'];
  }

  private async _resolve(): Promise<ClaudeCodeCliAdapter> {
    if (this._inner) return this._inner;
    if (!this._resolving) {
      this._resolving = resolveApiKey(this.spec, this.broker).then((apiKey) => {
        this._inner = new ClaudeCodeCliAdapter(this.spec, this.deps, apiKey);
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
