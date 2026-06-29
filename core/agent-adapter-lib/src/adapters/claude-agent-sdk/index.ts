/**
 * ClaudeAgentSdkAdapter — in-process Anthropic Agent SDK adapter (Phase B2).
 *
 * Implements the NEW AgentAdapter interface from src/agent.ts.
 * NOT exported from index.ts until Phase F (coexistence rule).
 *
 * The @anthropic-ai/claude-agent-sdk is the programmatic Claude Code runtime:
 * an autonomous agentic loop with built-in file/shell tools. It is declared
 * as a peer dependency (optional) so the lib can be used without it.
 *
 * Real API (verified from @anthropic-ai/claude-agent-sdk@0.3.195 sdk.d.ts):
 *
 *   query({ prompt, options? }): Query
 *   Query extends AsyncGenerator<SDKMessage, void>
 *
 *   options.cwd         — working directory (maps to workdir)
 *   options.model       — model identifier
 *   options.systemPrompt — string | string[] | preset
 *   options.env         — REPLACES process.env entirely; spread process.env
 *                         and inject ANTHROPIC_API_KEY into it
 *   options.abortController — AbortController for cancellation
 *   options.maxTurns    — max agentic turns
 *
 *   SDKMessage union: SDKAssistantMessage | SDKResultMessage | ...
 *   SDKAssistantMessage: { type: 'assistant', message: BetaMessage, ... }
 *   SDKResultMessage:    { type: 'result', subtype: 'success'|'error', ... }
 *   SDKResultSuccess:    { usage: NonNullableUsage, result: string, stop_reason, ... }
 *
 * Behaviour:
 *   - stream(): calls query() and maps SDKMessages → AgentChunk
 *     - SDKAssistantMessage.message.content blocks → text-delta / tool-call-*
 *     - SDKResultSuccess → usage + message-stop chunks
 *   - invoke(): reduceStream(stream(...)) — parity guarantee (PRD §10)
 *   - Tools: autonomous tool execution by the SDK runtime (B2 is autonomous;
 *     host cannot inject custom tools — surfaces tool-call-* for observability)
 *   - Auth: broker.getCredential('anthropic') → ANTHROPIC_API_KEY via env option
 *     MissingCredentialError at construction if not resolvable
 *   - AbortSignal → abortController.abort() → finishReason:'aborted'
 *   - Capabilities: CAPABILITY_MATRIX['claude-agent-sdk']
 */

import type {
  AgentAdapter,
  AgentInput,
  AgentInvocationResult,
  AgentSpecType,
  ClaudeAgentSdkSpec,
  InvokeOptions,
  TokenUsage,
} from '../../agent.ts';
import type { AdapterCapabilities } from '../../capabilities.ts';
import { CAPABILITY_MATRIX } from '../../capabilities.ts';
import type { CredentialBroker } from '../../credentials/broker.ts';
import {
  CapabilityMismatchError,
  classifyNetworkError,
  MissingCredentialError,
} from '../../errors.ts';
import type { AdapterDeps } from '../../registry.ts';
import { registerAdapter } from '../../registry.ts';
import type { AgentChunk } from '../../stream.ts';
import { reduceStream } from '../../stream.ts';

// ---------------------------------------------------------------------------
// SDK type shims
// We import the real SDK types when available (dev dependency), but we use
// structural typing so the lib compiles even without the package installed
// (it is a peerDependency optional).
// ---------------------------------------------------------------------------

/** Minimal BetaContentBlock shape we need at runtime */
interface BetaContentBlockText {
  type: 'text';
  text: string;
}

interface BetaContentBlockToolUse {
  type: 'tool_use';
  id: string;
  name: string;
  input: unknown;
}

// Extended thinking is surfaced as a 'thinking' type block in the BetaMessage.
// The BetaContentBlock type in SDK 0.30.1 only has text | tool_use, but at
// runtime newer models may return thinking blocks. We use a loose type here.
interface BetaContentBlockThinking {
  type: 'thinking';
  thinking: string;
}

type BetaContentBlockAny =
  | BetaContentBlockText
  | BetaContentBlockToolUse
  | BetaContentBlockThinking
  | { type: string; [key: string]: unknown };

/** Minimal BetaMessage shape */
interface BetaMessageLike {
  content: BetaContentBlockAny[];
  usage?: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
}

/** SDKAssistantMessage shape */
interface SDKAssistantMessageLike {
  type: 'assistant';
  message: BetaMessageLike;
  error?: string;
}

/** SDKResultSuccess shape */
interface SDKResultSuccessLike {
  type: 'result';
  subtype: 'success';
  result: string;
  stop_reason: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  duration_ms?: number;
}

/** SDKResultError shape */
interface SDKResultErrorLike {
  type: 'result';
  subtype: 'error';
  result?: string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
}

type SDKResultMessageLike = SDKResultSuccessLike | SDKResultErrorLike;

type SDKMessageLike =
  | SDKAssistantMessageLike
  | SDKResultMessageLike
  | { type: string; [key: string]: unknown };

/** The query function shape */
type QueryFn = (params: {
  prompt: string;
  options?: {
    cwd?: string;
    model?: string;
    systemPrompt?: string;
    env?: Record<string, string | undefined>;
    abortController?: AbortController;
    maxTurns?: number;
    allowedTools?: string[];
  };
}) => AsyncIterable<SDKMessageLike>;

// ---------------------------------------------------------------------------
// Dynamic import helper
// ---------------------------------------------------------------------------

let _queryFn: QueryFn | null = null;

async function getQueryFn(): Promise<QueryFn> {
  if (_queryFn) return _queryFn;
  try {
    // Dynamic import so the lib does not hard-depend on the optional peer.
    const mod = await import('@anthropic-ai/claude-agent-sdk');
    _queryFn = mod.query as QueryFn;
    return _queryFn;
  } catch (err) {
    throw new MissingCredentialError(
      '@anthropic-ai/claude-agent-sdk is not installed. ' +
        'Install it as a dependency to use the claude-agent-sdk adapter: ' +
        'npm install @anthropic-ai/claude-agent-sdk',
      { cause: err },
    );
  }
}

// ---------------------------------------------------------------------------
// ClaudeAgentSdkAdapter
// ---------------------------------------------------------------------------

export class ClaudeAgentSdkAdapter implements AgentAdapter {
  readonly type: AgentSpecType = 'claude-agent-sdk';
  readonly capabilities: AdapterCapabilities;
  readonly workdir: string;

  private readonly spec: ClaudeAgentSdkSpec;
  private readonly apiKey: string;

  constructor(spec: ClaudeAgentSdkSpec, deps: AdapterDeps, apiKey: string) {
    this.spec = spec;
    this.workdir = deps.workdir;
    this.capabilities = CAPABILITY_MATRIX['claude-agent-sdk'];
    this.apiKey = apiKey;
  }

  // -------------------------------------------------------------------------
  // invoke — reduce stream (PRD §10 parity guarantee)
  // -------------------------------------------------------------------------

  async invoke(input: AgentInput, opts?: InvokeOptions): Promise<AgentInvocationResult> {
    this._checkToolCapability(input);
    return reduceStream(this.stream(input, opts));
  }

  // -------------------------------------------------------------------------
  // stream — query() message stream → AgentChunk async iterable
  // -------------------------------------------------------------------------

  async *stream(input: AgentInput, opts?: InvokeOptions): AsyncIterable<AgentChunk> {
    this._checkToolCapability(input);

    const queryFn = await getQueryFn();

    // Extract the prompt from the last user message in the conversation.
    // Prior messages provide context but cannot be injected directly into
    // the autonomous session; the host should encode prior context in the
    // system prompt or in the last user message itself.
    const prompt = extractPrompt(input);
    const systemPrompt = input.systemPrompt ?? this.spec.systemPrompt;

    // AbortController integration: signal → abort the query
    const abortController = new AbortController();
    let signalCleanup: (() => void) | null = null;

    if (opts?.signal) {
      const signal = opts.signal;
      if (signal.aborted) {
        yield { type: 'message-stop', finishReason: 'aborted' };
        return;
      }
      const onAbort = () => abortController.abort();
      signal.addEventListener('abort', onAbort, { once: true });
      signalCleanup = () => signal.removeEventListener('abort', onAbort);
    }

    try {
      const messages = queryFn({
        prompt,
        options: {
          cwd: this.workdir,
          model: this.spec.model,
          ...(systemPrompt !== undefined ? { systemPrompt } : {}),
          // env REPLACES process.env entirely per SDK docs; always spread.
          env: { ...process.env, ANTHROPIC_API_KEY: this.apiKey },
          abortController,
        },
      });

      for await (const msg of messages) {
        yield* this._mapMessage(msg);
      }
    } catch (err) {
      if (abortController.signal.aborted || opts?.signal?.aborted) {
        yield { type: 'message-stop', finishReason: 'aborted' };
        return;
      }
      // Check for AbortError by name (SDK may throw its own AbortError class)
      if (err instanceof Error && err.name === 'AbortError') {
        yield { type: 'message-stop', finishReason: 'aborted' };
        return;
      }
      yield { type: 'error', error: classifyNetworkError(err, 'claude-agent-sdk') };
    } finally {
      signalCleanup?.();
    }
  }

  // -------------------------------------------------------------------------
  // Message mapping
  // -------------------------------------------------------------------------

  private *_mapMessage(msg: SDKMessageLike): Iterable<AgentChunk> {
    if (msg.type === 'assistant') {
      const assistantMsg = msg as SDKAssistantMessageLike;
      // Map each content block in the BetaMessage to AgentChunks
      for (const block of assistantMsg.message.content) {
        yield* this._mapContentBlock(block);
      }
    } else if (msg.type === 'result') {
      const resultMsg = msg as SDKResultMessageLike;
      if (resultMsg.subtype === 'success') {
        const success = resultMsg as SDKResultSuccessLike;
        // Emit usage chunk
        if (success.usage) {
          const usage: TokenUsage = {
            inputTokens: success.usage.input_tokens,
            outputTokens: success.usage.output_tokens,
            ...(success.usage.cache_read_input_tokens !== undefined
              ? { cacheReadTokens: success.usage.cache_read_input_tokens }
              : {}),
            ...(success.usage.cache_creation_input_tokens !== undefined
              ? { cacheWriteTokens: success.usage.cache_creation_input_tokens }
              : {}),
          };
          yield { type: 'usage', usage };
        }
        // Map stop reason
        const finishReason = mapAgentStopReason(success.stop_reason);
        yield { type: 'message-stop', finishReason };
      } else {
        // Error result
        yield { type: 'message-stop', finishReason: 'error' };
      }
    }
    // All other message types (system, user, status, etc.) are silently skipped —
    // they carry observability/metadata but are not part of the output stream contract.
  }

  private *_mapContentBlock(block: BetaContentBlockAny): Iterable<AgentChunk> {
    if (block.type === 'text') {
      const textBlock = block as BetaContentBlockText;
      if (textBlock.text) {
        yield { type: 'text-delta', text: textBlock.text };
      }
    } else if (block.type === 'tool_use') {
      const toolBlock = block as BetaContentBlockToolUse;
      const toolCallId = toolBlock.id;
      yield { type: 'tool-call-start', toolCallId, toolName: toolBlock.name };
      // The full input is available immediately (not streaming) for autonomous tool calls
      const inputJson =
        typeof toolBlock.input === 'string' ? toolBlock.input : JSON.stringify(toolBlock.input);
      yield { type: 'tool-call-input', toolCallId, partialInput: inputJson };
      yield { type: 'tool-call-end', toolCallId, input: toolBlock.input };
    } else if (block.type === 'thinking') {
      const thinkingBlock = block as BetaContentBlockThinking;
      if (thinkingBlock.thinking) {
        yield { type: 'thinking-delta', text: thinkingBlock.thinking };
      }
    }
    // Unknown block types are silently skipped.
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

/**
 * Extract the prompt string from AgentInput.
 * Uses the last user message's text content as the autonomous session prompt.
 * Prior messages are not directly injectable into the claude-agent-sdk session.
 */
function extractPrompt(input: AgentInput): string {
  const lastUserMsg = [...input.messages].reverse().find((m) => m.role === 'user');
  if (!lastUserMsg) return '';
  if (typeof lastUserMsg.content === 'string') return lastUserMsg.content;
  // Extract text from content blocks
  return lastUserMsg.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { text: string }).text)
    .join('\n');
}

/**
 * Map the claude-agent-sdk's stop_reason string to our normalized finishReason.
 */
function mapAgentStopReason(
  stopReason: string | null | undefined,
): AgentInvocationResult['finishReason'] {
  if (!stopReason) return 'stop';
  switch (stopReason) {
    case 'end_turn':
    case 'completed':
      return 'stop';
    case 'max_tokens':
    case 'max_output_tokens':
      return 'length';
    case 'tool_use':
      return 'tool_use';
    case 'max_turns':
      return 'length';
    case 'aborted_streaming':
    case 'aborted_tools':
      return 'aborted';
    default:
      return 'stop';
  }
}

// ---------------------------------------------------------------------------
// API key resolution (async — broker may need network)
// ---------------------------------------------------------------------------

async function resolveApiKey(spec: ClaudeAgentSdkSpec, broker?: CredentialBroker): Promise<string> {
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
    'No Anthropic API key found for claude-agent-sdk adapter. Provide one via spec.apiKey, ' +
      'CredentialBroker.getCredential("anthropic"), or the ANTHROPIC_API_KEY environment variable.',
  );
}

// ---------------------------------------------------------------------------
// Factory + self-registration
// ---------------------------------------------------------------------------

registerAdapter(
  'claude-agent-sdk',
  (spec, deps) => {
    const agentSpec = spec as ClaudeAgentSdkSpec;
    const syncKey = agentSpec.apiKey ?? process.env.ANTHROPIC_API_KEY;

    if (!syncKey && !deps.credentialBroker) {
      throw new MissingCredentialError(
        'No Anthropic API key found for claude-agent-sdk adapter. Provide one via spec.apiKey, ' +
          'CredentialBroker.getCredential("anthropic"), or the ANTHROPIC_API_KEY environment variable.',
      );
    }

    if (!syncKey && deps.credentialBroker) {
      return new LazyClaudeAgentSdkAdapter(agentSpec, deps, deps.credentialBroker);
    }

    return new ClaudeAgentSdkAdapter(agentSpec, deps, syncKey!);
  },
  CAPABILITY_MATRIX['claude-agent-sdk'],
);

// ---------------------------------------------------------------------------
// LazyClaudeAgentSdkAdapter — defers API key resolution to first invoke/stream
// ---------------------------------------------------------------------------

class LazyClaudeAgentSdkAdapter implements AgentAdapter {
  readonly type: AgentSpecType = 'claude-agent-sdk';
  readonly capabilities: AdapterCapabilities;
  readonly workdir: string;

  private _inner: ClaudeAgentSdkAdapter | null = null;
  private _resolving: Promise<ClaudeAgentSdkAdapter> | null = null;

  constructor(
    private readonly spec: ClaudeAgentSdkSpec,
    private readonly deps: AdapterDeps,
    private readonly broker: CredentialBroker,
  ) {
    this.workdir = deps.workdir;
    this.capabilities = CAPABILITY_MATRIX['claude-agent-sdk'];
  }

  private async _resolve(): Promise<ClaudeAgentSdkAdapter> {
    if (this._inner) return this._inner;
    if (!this._resolving) {
      this._resolving = resolveApiKey(this.spec, this.broker).then((apiKey) => {
        this._inner = new ClaudeAgentSdkAdapter(this.spec, this.deps, apiKey);
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
