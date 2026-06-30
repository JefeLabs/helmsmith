/**
 * OpenAiSdkAdapter — in-process OpenAI SDK adapter (Phase D⁗, chat-mode).
 *
 * Implements the NEW AgentAdapter interface from src/agent.ts. NOT exported from
 * index.ts until Phase F (coexistence rule).
 *
 * Behaviour (mirrors claude-sdk / copilot-sdk):
 *   - stream(): drives client.chat.completions.create({ stream: true }) and maps
 *     each ChatCompletionChunk → AgentChunk (delta.content → text-delta,
 *     delta.tool_calls deltas → tool-call-*, usage → usage, finish_reason →
 *     message-stop).
 *   - invoke(): reduceStream(stream(...)) — invoke/stream parity (PRD §10).
 *   - Tools: API-level host-loop. tool_calls deltas surfaced as tool-call-*;
 *     host re-invokes with the tool-use blocks.
 *   - Auth: broker.getCredential('openai') → apiKey, fallback OPENAI_API_KEY,
 *     else MissingCredentialError at construction (fail-fast).
 *   - AbortSignal: forwarded via RequestOptions.signal → finishReason 'aborted'.
 *   - Capabilities: from CAPABILITY_MATRIX['openai-sdk'] (supportsJsonMode: true).
 */

import OpenAI from 'openai';
import type {
  AgentAdapter,
  AgentInput,
  AgentInvocationResult,
  AgentSpecType,
  InvokeOptions,
  Logger,
  OpenAiSdkSpec,
  TokenUsage,
} from '../../agent.ts';
import type { AdapterCapabilities } from '../../capabilities.ts';
import { CAPABILITY_MATRIX } from '../../capabilities.ts';
import type { CredentialBroker } from '../../credentials/broker.ts';
import {
  type AdapterError,
  CapabilityMismatchError,
  classifyHttpError,
  classifyNetworkError,
  MissingCredentialError,
} from '../../errors.ts';
import type { AdapterDeps } from '../../registry.ts';
import { registerAdapter } from '../../registry.ts';
import type { AgentChunk } from '../../stream.ts';
import { reduceStream } from '../../stream.ts';
import { buildRequestBody, mapFinishReason } from './normalize.ts';

const OPENAI_PROVIDER = 'openai';

// ---------------------------------------------------------------------------
// Minimal structural views of the OpenAI streaming chunk (the mock satisfies
// these structurally; the real ChatCompletionChunk is assignable to them).
// ---------------------------------------------------------------------------

interface DeltaToolCall {
  index: number;
  id?: string;
  function?: { name?: string; arguments?: string };
}

interface StreamChunk {
  choices?: Array<{
    delta?: { content?: string | null; tool_calls?: DeltaToolCall[] };
    finish_reason?: string | null;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
}

interface InProgressToolCall {
  toolCallId: string;
  toolName: string;
  argParts: string[];
}

// ---------------------------------------------------------------------------
// OpenAiSdkAdapter
// ---------------------------------------------------------------------------

export class OpenAiSdkAdapter implements AgentAdapter {
  readonly type: AgentSpecType = 'openai-sdk';
  readonly capabilities: AdapterCapabilities;
  readonly workdir: string;

  private readonly client: OpenAI;
  private readonly spec: OpenAiSdkSpec;
  private readonly logger?: Logger;

  constructor(spec: OpenAiSdkSpec, deps: AdapterDeps, apiKey: string) {
    this.spec = spec;
    this.workdir = deps.workdir;
    this.capabilities = CAPABILITY_MATRIX['openai-sdk'];
    this.client = new OpenAI({ apiKey });
    this.logger = deps.logger;
  }

  // -------------------------------------------------------------------------
  // invoke — reduce the stream (PRD §10 parity guarantee)
  // -------------------------------------------------------------------------

  async invoke(input: AgentInput, opts?: InvokeOptions): Promise<AgentInvocationResult> {
    this._checkToolCapability(input);
    return reduceStream(this.stream(input, opts));
  }

  // -------------------------------------------------------------------------
  // stream — SDK chunk stream → AgentChunk async iterable
  // -------------------------------------------------------------------------

  async *stream(input: AgentInput, opts?: InvokeOptions): AsyncIterable<AgentChunk> {
    this._checkToolCapability(input);

    const systemPrompt = input.systemPrompt ?? this.spec.systemPrompt;
    const body = buildRequestBody(input, this.spec.model, systemPrompt, true);

    this.logger?.debug?.('[openai-sdk] request', { model: this.spec.model, stream: true });

    // tool_calls keyed by their streaming `index`.
    const toolCalls = new Map<number, InProgressToolCall>();
    let usage: TokenUsage | undefined;
    let finishReason: AgentInvocationResult['finishReason'];

    try {
      const sdkStream = (await this.client.chat.completions.create(
        body as unknown as Parameters<OpenAI['chat']['completions']['create']>[0],
        opts?.signal !== undefined ? { signal: opts.signal } : undefined,
      )) as AsyncIterable<StreamChunk>;

      for await (const chunk of sdkStream) {
        const choice = chunk.choices?.[0];
        if (choice) {
          const delta = choice.delta;
          if (delta?.content) {
            yield { type: 'text-delta', text: delta.content };
          }
          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              yield* handleToolCallDelta(tc, toolCalls);
            }
          }
          if (choice.finish_reason) {
            finishReason = mapFinishReason(choice.finish_reason);
            // tool_calls are complete once a finish reason arrives — close them
            // before message-stop so consumers see ends in streaming order.
            yield* emitToolCallEnds(toolCalls);
          }
        }
        if (chunk.usage) {
          usage = {
            inputTokens: chunk.usage.prompt_tokens ?? 0,
            outputTokens: chunk.usage.completion_tokens ?? 0,
          };
        }
      }
    } catch (err) {
      if (isAbort(err, opts?.signal)) {
        yield { type: 'message-stop', finishReason: 'aborted' };
        return;
      }
      yield { type: 'error', error: classifyOpenAiError(err) };
      return;
    }

    // Close any tool calls not terminated by a finish_reason.
    yield* emitToolCallEnds(toolCalls);
    if (usage !== undefined) yield { type: 'usage', usage };
    yield { type: 'message-stop', finishReason: finishReason ?? 'stop' };
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
// Tool-call delta accumulation (OpenAI streams tool args incrementally)
// ---------------------------------------------------------------------------

function* handleToolCallDelta(
  tc: DeltaToolCall,
  toolCalls: Map<number, InProgressToolCall>,
): Generator<AgentChunk> {
  let entry = toolCalls.get(tc.index);
  if (!entry) {
    entry = {
      toolCallId: tc.id ?? `tool_${tc.index}`,
      toolName: tc.function?.name ?? '',
      argParts: [],
    };
    toolCalls.set(tc.index, entry);
    yield { type: 'tool-call-start', toolCallId: entry.toolCallId, toolName: entry.toolName };
  }
  const args = tc.function?.arguments;
  if (args) {
    entry.argParts.push(args);
    yield { type: 'tool-call-input', toolCallId: entry.toolCallId, partialInput: args };
  }
}

function* emitToolCallEnds(toolCalls: Map<number, InProgressToolCall>): Generator<AgentChunk> {
  for (const entry of toolCalls.values()) {
    const joined = entry.argParts.join('');
    let input: unknown = {};
    if (joined.length > 0) {
      try {
        input = JSON.parse(joined);
      } catch {
        input = joined;
      }
    }
    yield { type: 'tool-call-end', toolCallId: entry.toolCallId, input };
  }
  toolCalls.clear();
}

// ---------------------------------------------------------------------------
// Error + abort classification
// ---------------------------------------------------------------------------

function isAbort(err: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  if (err instanceof OpenAI.APIUserAbortError) return true;
  return err instanceof Error && err.name === 'AbortError';
}

function classifyOpenAiError(err: unknown): AdapterError {
  if (err instanceof OpenAI.APIError) {
    const retryAfter =
      err.headers && typeof (err.headers as Headers).get === 'function'
        ? (err.headers as Headers).get('retry-after')
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
      context: OPENAI_PROVIDER,
    });
  }
  return classifyNetworkError(err, OPENAI_PROVIDER);
}

// ---------------------------------------------------------------------------
// API-key resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the OpenAI API key at construction time.
 *
 * Priority: spec.apiKey → broker.getCredential('openai') → OPENAI_API_KEY env →
 * MissingCredentialError (fail fast, never mid-stream).
 */
export async function resolveApiKey(
  spec: OpenAiSdkSpec,
  broker?: CredentialBroker,
): Promise<string> {
  if (spec.apiKey) return spec.apiKey;
  if (broker) {
    try {
      const cred = await broker.getCredential(OPENAI_PROVIDER);
      if (cred.apiKey) return cred.apiKey;
    } catch {
      // fall through to env var
    }
  }
  const envKey = process.env.OPENAI_API_KEY;
  if (envKey) return envKey;
  throw new MissingCredentialError(
    'No OpenAI API key found for openai-sdk adapter. Provide one via spec.apiKey, ' +
      'CredentialBroker.getCredential("openai"), or the OPENAI_API_KEY environment variable.',
  );
}

// ---------------------------------------------------------------------------
// Factory + self-registration
// ---------------------------------------------------------------------------

registerAdapter(
  'openai-sdk',
  (spec, deps) => {
    const sdkSpec = spec as OpenAiSdkSpec;
    const syncKey = sdkSpec.apiKey ?? process.env.OPENAI_API_KEY;

    if (!syncKey && !deps.credentialBroker) {
      throw new MissingCredentialError(
        'No OpenAI API key found for openai-sdk adapter. Provide one via spec.apiKey, ' +
          'CredentialBroker.getCredential("openai"), or the OPENAI_API_KEY env var.',
      );
    }

    if (!syncKey && deps.credentialBroker) {
      return new LazyOpenAiSdkAdapter(sdkSpec, deps, deps.credentialBroker);
    }

    return new OpenAiSdkAdapter(sdkSpec, deps, syncKey as string);
  },
  CAPABILITY_MATRIX['openai-sdk'],
);

// ---------------------------------------------------------------------------
// LazyOpenAiSdkAdapter — defers API-key resolution to first invoke/stream
// ---------------------------------------------------------------------------

class LazyOpenAiSdkAdapter implements AgentAdapter {
  readonly type: AgentSpecType = 'openai-sdk';
  readonly capabilities: AdapterCapabilities;
  readonly workdir: string;

  private _inner: OpenAiSdkAdapter | null = null;
  private _resolving: Promise<OpenAiSdkAdapter> | null = null;

  constructor(
    private readonly spec: OpenAiSdkSpec,
    private readonly deps: AdapterDeps,
    private readonly broker: CredentialBroker,
  ) {
    this.workdir = deps.workdir;
    this.capabilities = CAPABILITY_MATRIX['openai-sdk'];
  }

  private async _resolve(): Promise<OpenAiSdkAdapter> {
    if (this._inner) return this._inner;
    if (!this._resolving) {
      this._resolving = resolveApiKey(this.spec, this.broker).then((apiKey) => {
        this._inner = new OpenAiSdkAdapter(this.spec, this.deps, apiKey);
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
