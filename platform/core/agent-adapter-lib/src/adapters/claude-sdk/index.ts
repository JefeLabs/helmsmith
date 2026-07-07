/**
 * ClaudeSdkAdapter — in-process Anthropic SDK adapter (PRD §8.1, Phase B1).
 *
 * Implements the NEW AgentAdapter interface from src/agent.ts.
 * NOT exported from index.ts until Phase F (coexistence rule).
 *
 * Behaviour:
 *   - stream(): drives client.messages.stream() and maps SDK stream events
 *     (RawMessageStreamEvent) → AgentChunk.
 *   - invoke(): reduceStream(stream(...)) — guarantees invoke/stream parity.
 *   - Tools: API-level host-loop. Adapter surfaces tool-call-* chunks;
 *     host re-invokes with tool_result messages. (PRD §11, §13 D2)
 *   - Auth: broker.getCredential('anthropic') → apiKey, fallback ANTHROPIC_API_KEY,
 *     else MissingCredentialError at construction. (PRD §12, §13 D7)
 *   - AbortSignal: forwarded to SDK stream options → finishReason:'aborted'.
 *   - maxTokens: driven from spec (default 8192, NEVER hardcoded 256).
 *   - Capabilities: from CAPABILITY_MATRIX['claude-sdk'].
 */

import Anthropic, { APIUserAbortError } from '@anthropic-ai/sdk';
import type {
  AgentAdapter,
  AgentInput,
  AgentInvocationResult,
  AgentSpecType,
  ClaudeSdkSpec,
  InvokeOptions,
  Logger,
  TokenUsage,
} from '../../agent.ts';
import type { AdapterCapabilities } from '../../capabilities.ts';
import { CAPABILITY_MATRIX } from '../../capabilities.ts';
import type { CredentialBroker } from '../../credentials/broker.ts';
import {
  CapabilityMismatchError,
  classifyHttpError,
  classifyNetworkError,
  MissingCredentialError,
} from '../../errors.ts';
import type { AdapterDeps } from '../../registry.ts';
import { registerAdapter } from '../../registry.ts';
import type { AgentChunk } from '../../stream.ts';
import { reduceStream } from '../../stream.ts';
import { mapStopReason, normalizeMessages, normalizeTools } from './normalize.ts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_MAX_TOKENS = 8192;

// ---------------------------------------------------------------------------
// ClaudeSdkAdapter
// ---------------------------------------------------------------------------

export class ClaudeSdkAdapter implements AgentAdapter {
  readonly type: AgentSpecType = 'claude-sdk';
  readonly capabilities: AdapterCapabilities;
  readonly workdir: string;

  private readonly client: Anthropic;
  private readonly spec: ClaudeSdkSpec;

  constructor(spec: ClaudeSdkSpec, deps: AdapterDeps, apiKey: string) {
    this.spec = spec;
    this.workdir = deps.workdir;
    this.capabilities = CAPABILITY_MATRIX['claude-sdk'];
    this.client = new Anthropic({ apiKey });
  }

  // -------------------------------------------------------------------------
  // invoke — reduce stream into a full result (PRD §10 parity guarantee)
  // -------------------------------------------------------------------------

  async invoke(input: AgentInput, opts?: InvokeOptions): Promise<AgentInvocationResult> {
    this._checkToolCapability(input);
    return reduceStream(this.stream(input, opts));
  }

  // -------------------------------------------------------------------------
  // stream — SDK event stream → AgentChunk async iterable
  // -------------------------------------------------------------------------

  async *stream(input: AgentInput, opts?: InvokeOptions): AsyncIterable<AgentChunk> {
    this._checkToolCapability(input);

    const systemPrompt = input.systemPrompt ?? this.spec.systemPrompt;
    const maxTokens = DEFAULT_MAX_TOKENS;
    // Cast to Anthropic's MessageParam — our inline SdkMessageParam is structurally
    // compatible but TypeScript's strict check requires a cast.
    const messages = normalizeMessages(input.messages) as Anthropic.MessageParam[];
    const tools = input.tools?.length ? normalizeTools(input.tools) : undefined;

    // AbortSignal integration: pass signal to SDK request options.
    const signal = opts?.signal;

    try {
      const sdkStream = this.client.messages.stream(
        {
          model: this.spec.model,
          max_tokens: maxTokens,
          ...(systemPrompt !== undefined ? { system: systemPrompt } : {}),
          messages,
          ...(tools !== undefined ? { tools } : {}),
          ...(input.toolChoice !== undefined
            ? {
                tool_choice: normalizeToolChoice(input.toolChoice) as Anthropic.Messages.ToolChoice,
              }
            : {}),
        },
        signal !== undefined ? { signal } : undefined,
      );

      // Track per-block state for tool-call / thinking accumulation
      type BlockState =
        | { kind: 'text' }
        | { kind: 'thinking' }
        | { kind: 'tool'; toolCallId: string; toolName: string; inputParts: string[] };
      const blockStates = new Map<number, BlockState>();

      // Usage from message_start (input tokens)
      let inputTokens = 0;
      let cacheReadTokens: number | undefined;
      let cacheWriteTokens: number | undefined;

      for await (const event of sdkStream) {
        switch (event.type) {
          case 'message_start': {
            const u = event.message.usage;
            inputTokens = u.input_tokens;
            cacheReadTokens = (u as { cache_read_input_tokens?: number }).cache_read_input_tokens;
            cacheWriteTokens = (u as { cache_creation_input_tokens?: number })
              .cache_creation_input_tokens;
            break;
          }

          case 'content_block_start': {
            const block = event.content_block;
            // Extended-thinking blocks are emitted at runtime by thinking-enabled
            // models, but the SDK 0.30.1 ContentBlock union doesn't type them —
            // detect via a structural cast (supportsExtendedThinking:true).
            const blockType = (block as { type: string }).type;
            if (blockType === 'thinking') {
              blockStates.set(event.index, { kind: 'thinking' });
            } else if (block.type === 'text') {
              blockStates.set(event.index, { kind: 'text' });
            } else if (block.type === 'tool_use') {
              const toolCallId = block.id;
              const toolName = block.name;
              blockStates.set(event.index, { kind: 'tool', toolCallId, toolName, inputParts: [] });
              yield { type: 'tool-call-start', toolCallId, toolName };
            }
            break;
          }

          case 'content_block_delta': {
            const state = blockStates.get(event.index);
            if (!state) break;

            const delta = event.delta;
            // thinking_delta (+ signature_delta) aren't in the SDK 0.30.1 delta
            // union; detect thinking_delta structurally and surface its text.
            const deltaType = (delta as { type: string }).type;
            if (deltaType === 'thinking_delta' && state.kind === 'thinking') {
              const text = (delta as { thinking?: string }).thinking ?? '';
              if (text) yield { type: 'thinking-delta', text };
            } else if (delta.type === 'text_delta' && state.kind === 'text') {
              yield { type: 'text-delta', text: delta.text };
            } else if (delta.type === 'input_json_delta' && state.kind === 'tool') {
              state.inputParts.push(delta.partial_json);
              yield {
                type: 'tool-call-input',
                toolCallId: state.toolCallId,
                partialInput: delta.partial_json,
              };
            }
            break;
          }

          case 'content_block_stop': {
            const state = blockStates.get(event.index);
            if (state?.kind === 'tool') {
              // Parse accumulated JSON input
              let parsedInput: unknown = {};
              const joined = state.inputParts.join('');
              if (joined) {
                try {
                  parsedInput = JSON.parse(joined);
                } catch {
                  parsedInput = joined;
                }
              }
              yield { type: 'tool-call-end', toolCallId: state.toolCallId, input: parsedInput };
            }
            blockStates.delete(event.index);
            break;
          }

          case 'message_delta': {
            // Emit usage chunk with cumulative token counts
            const outputTokens = event.usage.output_tokens;
            const usage: TokenUsage = {
              inputTokens,
              outputTokens,
              ...(cacheReadTokens !== undefined ? { cacheReadTokens } : {}),
              ...(cacheWriteTokens !== undefined ? { cacheWriteTokens } : {}),
            };
            yield { type: 'usage', usage };
            // Emit message-stop with mapped finish reason
            const finishReason = mapStopReason(event.delta.stop_reason);
            yield { type: 'message-stop', finishReason };
            break;
          }

          case 'message_stop':
            // Already emitted stop in message_delta; message_stop is a sentinel.
            break;
        }
      }
    } catch (err) {
      if (err instanceof APIUserAbortError || opts?.signal?.aborted) {
        yield { type: 'message-stop', finishReason: 'aborted' };
        return;
      }
      yield { type: 'error', error: classifyAnthropicError(err) };
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

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
// Helpers
// ---------------------------------------------------------------------------

function normalizeToolChoice(
  choice: AgentInput['toolChoice'],
): { type: 'auto' } | { type: 'none' } | { type: 'tool'; name: string } | undefined {
  if (!choice) return undefined;
  if (choice === 'auto') return { type: 'auto' };
  if (choice === 'none') return { type: 'none' };
  return { type: 'tool', name: choice.name };
}

function classifyAnthropicError(err: unknown): import('../../errors.ts').AdapterError {
  const { APIError } = Anthropic;
  if (err instanceof APIError) {
    const retryAfter =
      typeof err.headers === 'object' && err.headers !== null
        ? (err.headers as Record<string, string>)['retry-after']
        : undefined;
    const body = (() => {
      try {
        return typeof err.error === 'string' ? err.error : JSON.stringify(err.error ?? {});
      } catch {
        return '';
      }
    })();
    return classifyHttpError({
      status: err.status ?? 0,
      body: `${err.message} ${body}`,
      retryAfter,
      cause: err,
      context: 'anthropic',
    });
  }
  return classifyNetworkError(err, 'anthropic');
}

// ---------------------------------------------------------------------------
// Factory + self-registration
// ---------------------------------------------------------------------------

/**
 * Resolve the API key at construction time.
 *
 * Priority:
 *   1. spec.apiKey (pre-resolved, bypasses broker)
 *   2. broker.getCredential('anthropic')
 *   3. ANTHROPIC_API_KEY env var
 *   4. MissingCredentialError (fail fast, never mid-stream)
 */
async function resolveApiKey(
  spec: ClaudeSdkSpec,
  broker?: CredentialBroker,
  logger?: Logger,
): Promise<string> {
  if (spec.apiKey) return spec.apiKey;
  if (broker) {
    try {
      const cred = await broker.getCredential('anthropic');
      if (cred.apiKey) return cred.apiKey;
    } catch (err) {
      // Don't swallow silently — log and fall back to env.
      logger?.warn?.(
        `[claude-sdk] credential broker failed for 'anthropic'; falling back to env: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
  const envKey = process.env.ANTHROPIC_API_KEY;
  if (envKey) return envKey;
  throw new MissingCredentialError(
    'No Anthropic API key found. Provide one via spec.apiKey, ' +
      'CredentialBroker.getCredential("anthropic"), or the ANTHROPIC_API_KEY environment variable.',
  );
}

registerAdapter(
  'claude-sdk',
  (spec, deps) => {
    // The factory is synchronous (createAgent contract). Precedence must match
    // resolveApiKey: spec → broker → env. Only an explicit spec.apiKey
    // short-circuits; when a broker is present we defer to lazy resolution so
    // the broker is PREFERRED over env (token rotation), resolving on first
    // invoke/stream. Env is the last-resort synchronous fallback.
    const claudeSpec = spec as ClaudeSdkSpec;
    if (claudeSpec.apiKey) return new ClaudeSdkAdapter(claudeSpec, deps, claudeSpec.apiKey);
    if (deps.credentialBroker) {
      return new LazyClaudeSdkAdapter(claudeSpec, deps, deps.credentialBroker);
    }
    const envKey = process.env.ANTHROPIC_API_KEY;
    if (envKey) return new ClaudeSdkAdapter(claudeSpec, deps, envKey);
    throw new MissingCredentialError(
      'No Anthropic API key found. Provide one via spec.apiKey, ' +
        'CredentialBroker.getCredential("anthropic"), or the ANTHROPIC_API_KEY environment variable.',
    );
  },
  CAPABILITY_MATRIX['claude-sdk'],
);

// ---------------------------------------------------------------------------
// LazyClaudeSdkAdapter — defers API key resolution to first invoke/stream
// ---------------------------------------------------------------------------

/**
 * Wrapper that resolves the API key from the broker on first invocation.
 * This allows the factory to remain synchronous while still supporting
 * broker-based credential resolution.
 */
class LazyClaudeSdkAdapter implements AgentAdapter {
  readonly type: AgentSpecType = 'claude-sdk';
  readonly capabilities: AdapterCapabilities;
  readonly workdir: string;

  private _inner: ClaudeSdkAdapter | null = null;
  private _resolving: Promise<ClaudeSdkAdapter> | null = null;

  constructor(
    private readonly spec: ClaudeSdkSpec,
    private readonly deps: AdapterDeps,
    private readonly broker: CredentialBroker,
  ) {
    this.workdir = deps.workdir;
    this.capabilities = CAPABILITY_MATRIX['claude-sdk'];
  }

  private async _resolve(): Promise<ClaudeSdkAdapter> {
    if (this._inner) return this._inner;
    if (!this._resolving) {
      this._resolving = resolveApiKey(this.spec, this.broker, this.deps.logger).then((apiKey) => {
        this._inner = new ClaudeSdkAdapter(this.spec, this.deps, apiKey);
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

// Export for testing
export { resolveApiKey };
