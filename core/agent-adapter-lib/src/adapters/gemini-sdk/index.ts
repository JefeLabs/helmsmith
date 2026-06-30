/**
 * GeminiSdkAdapter — in-process Google Gemini SDK adapter (Phase D⁗, chat-mode).
 *
 * Implements the NEW AgentAdapter interface from src/agent.ts. NOT exported from
 * index.ts until Phase F (coexistence rule).
 *
 * Behaviour (mirrors claude-sdk / copilot-sdk):
 *   - stream(): drives ai.models.generateContentStream() and maps each
 *     GenerateContentResponse chunk → AgentChunk (text → text-delta, functionCall
 *     → tool-call-*, usageMetadata → usage, candidate.finishReason → message-stop).
 *   - invoke(): reduceStream(stream(...)) — invoke/stream parity (PRD §10).
 *   - Tools: API-level host-loop. functionCall parts surfaced as tool-call-*;
 *     host re-invokes with the tool-use blocks. Gemini does not stream function
 *     arguments incrementally, so each call emits start → input → end in order.
 *   - Auth: broker.getCredential('google') → apiKey, fallback GEMINI_API_KEY /
 *     GOOGLE_API_KEY, else MissingCredentialError at construction (fail-fast).
 *   - AbortSignal: forwarded via config.abortSignal → finishReason 'aborted'.
 *   - Capabilities: from CAPABILITY_MATRIX['gemini-sdk'] (supportsJsonMode: true).
 */

import { GoogleGenAI } from '@google/genai';
import type {
  AgentAdapter,
  AgentInput,
  AgentInvocationResult,
  AgentSpecType,
  GeminiSdkSpec,
  InvokeOptions,
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
import {
  type GeminiContent,
  type GeminiTool,
  mapFinishReason,
  normalizeContents,
  normalizeTools,
} from './normalize.ts';

const GEMINI_PROVIDER = 'google';
const DEFAULT_MAX_TOKENS = 8192;

// ---------------------------------------------------------------------------
// Minimal structural views of the @google/genai stream chunk (no SDK types
// leak into the public surface; the mock satisfies these structurally).
// ---------------------------------------------------------------------------

interface GeminiResponsePart {
  text?: string;
  thought?: boolean;
  functionCall?: { id?: string; name?: string; args?: Record<string, unknown> };
}

interface GeminiResponseChunk {
  candidates?: Array<{
    content?: { parts?: GeminiResponsePart[] };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    cachedContentTokenCount?: number;
  };
}

interface GeminiGenerateConfig {
  abortSignal?: AbortSignal;
  systemInstruction?: string;
  maxOutputTokens?: number;
  tools?: GeminiTool[];
}

// ---------------------------------------------------------------------------
// GeminiSdkAdapter
// ---------------------------------------------------------------------------

export class GeminiSdkAdapter implements AgentAdapter {
  readonly type: AgentSpecType = 'gemini-sdk';
  readonly capabilities: AdapterCapabilities;
  readonly workdir: string;

  private readonly client: GoogleGenAI;
  private readonly spec: GeminiSdkSpec;

  constructor(spec: GeminiSdkSpec, deps: AdapterDeps, apiKey: string) {
    this.spec = spec;
    this.workdir = deps.workdir;
    this.capabilities = CAPABILITY_MATRIX['gemini-sdk'];
    this.client = new GoogleGenAI({ apiKey });
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
    const contents: GeminiContent[] = normalizeContents(input.messages);

    const config: GeminiGenerateConfig = { maxOutputTokens: DEFAULT_MAX_TOKENS };
    if (systemPrompt !== undefined) config.systemInstruction = systemPrompt;
    if (input.tools?.length) config.tools = normalizeTools(input.tools);
    if (opts?.signal !== undefined) config.abortSignal = opts.signal;

    // Track usage + finish across chunks (Gemini emits them on the final chunk).
    let usage: TokenUsage | undefined;
    let finishReason: AgentInvocationResult['finishReason'];
    let sawFunctionCall = false;
    let fcCounter = 0;

    try {
      const sdkStream = (await this.client.models.generateContentStream({
        model: this.spec.model,
        // The lib's inline GeminiContent is structurally compatible with the SDK's
        // ContentListUnion; a cast keeps the SDK types out of the public surface.
        contents: contents as unknown as Parameters<
          GoogleGenAI['models']['generateContentStream']
        >[0]['contents'],
        config: config as Parameters<GoogleGenAI['models']['generateContentStream']>[0]['config'],
      })) as AsyncIterable<GeminiResponseChunk>;

      for await (const chunk of sdkStream) {
        const candidate = chunk.candidates?.[0];
        for (const part of candidate?.content?.parts ?? []) {
          if (part.functionCall) {
            sawFunctionCall = true;
            const fc = part.functionCall;
            const toolCallId = fc.id ?? `gemini-fc-${fcCounter++}-${fc.name ?? 'unknown'}`;
            const toolName = fc.name ?? 'unknown';
            const args = fc.args ?? {};
            yield { type: 'tool-call-start', toolCallId, toolName };
            yield { type: 'tool-call-input', toolCallId, partialInput: JSON.stringify(args) };
            yield { type: 'tool-call-end', toolCallId, input: args };
          } else if (part.text && !part.thought) {
            yield { type: 'text-delta', text: part.text };
          }
        }
        if (candidate?.finishReason) {
          finishReason = mapFinishReason(candidate.finishReason);
        }
        if (chunk.usageMetadata) {
          const u = chunk.usageMetadata;
          usage = {
            inputTokens: u.promptTokenCount ?? 0,
            outputTokens: u.candidatesTokenCount ?? 0,
            ...(u.cachedContentTokenCount !== undefined
              ? { cacheReadTokens: u.cachedContentTokenCount }
              : {}),
          };
        }
      }
    } catch (err) {
      if (isAbort(err, opts?.signal)) {
        yield { type: 'message-stop', finishReason: 'aborted' };
        return;
      }
      yield { type: 'error', error: classifyGeminiError(err) };
      return;
    }

    if (usage !== undefined) yield { type: 'usage', usage };
    // A function call without an explicit finish reason still means tool_use.
    const effectiveFinish = sawFunctionCall ? 'tool_use' : (finishReason ?? 'stop');
    yield { type: 'message-stop', finishReason: effectiveFinish };
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

function isAbort(err: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  return err instanceof Error && (err.name === 'AbortError' || /abort/i.test(err.message));
}

function classifyGeminiError(err: unknown): AdapterError {
  const status = (err as { status?: number } | null)?.status;
  if (typeof status === 'number' && status > 0) {
    const message = err instanceof Error ? err.message : String(err);
    return classifyHttpError({ status, body: message, cause: err, context: GEMINI_PROVIDER });
  }
  return classifyNetworkError(err, GEMINI_PROVIDER);
}

// ---------------------------------------------------------------------------
// API-key resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the Gemini API key at construction time.
 *
 * Priority: spec.apiKey → broker.getCredential('google') → GEMINI_API_KEY /
 * GOOGLE_API_KEY env → MissingCredentialError (fail fast, never mid-stream).
 */
export async function resolveApiKey(
  spec: GeminiSdkSpec,
  broker?: CredentialBroker,
): Promise<string> {
  if (spec.apiKey) return spec.apiKey;
  if (broker) {
    try {
      const cred = await broker.getCredential(GEMINI_PROVIDER);
      if (cred.apiKey) return cred.apiKey;
    } catch {
      // fall through to env var
    }
  }
  const envKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (envKey) return envKey;
  throw new MissingCredentialError(
    'No Google/Gemini API key found for gemini-sdk adapter. Provide one via spec.apiKey, ' +
      'CredentialBroker.getCredential("google"), or the GEMINI_API_KEY / GOOGLE_API_KEY environment variable.',
  );
}

// ---------------------------------------------------------------------------
// Factory + self-registration
// ---------------------------------------------------------------------------

registerAdapter(
  'gemini-sdk',
  (spec, deps) => {
    const sdkSpec = spec as GeminiSdkSpec;
    const syncKey = sdkSpec.apiKey ?? process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;

    if (!syncKey && !deps.credentialBroker) {
      throw new MissingCredentialError(
        'No Google/Gemini API key found for gemini-sdk adapter. Provide one via spec.apiKey, ' +
          'CredentialBroker.getCredential("google"), or the GEMINI_API_KEY / GOOGLE_API_KEY env var.',
      );
    }

    if (!syncKey && deps.credentialBroker) {
      return new LazyGeminiSdkAdapter(sdkSpec, deps, deps.credentialBroker);
    }

    return new GeminiSdkAdapter(sdkSpec, deps, syncKey as string);
  },
  CAPABILITY_MATRIX['gemini-sdk'],
);

// ---------------------------------------------------------------------------
// LazyGeminiSdkAdapter — defers API-key resolution to first invoke/stream
// ---------------------------------------------------------------------------

class LazyGeminiSdkAdapter implements AgentAdapter {
  readonly type: AgentSpecType = 'gemini-sdk';
  readonly capabilities: AdapterCapabilities;
  readonly workdir: string;

  private _inner: GeminiSdkAdapter | null = null;
  private _resolving: Promise<GeminiSdkAdapter> | null = null;

  constructor(
    private readonly spec: GeminiSdkSpec,
    private readonly deps: AdapterDeps,
    private readonly broker: CredentialBroker,
  ) {
    this.workdir = deps.workdir;
    this.capabilities = CAPABILITY_MATRIX['gemini-sdk'];
  }

  private async _resolve(): Promise<GeminiSdkAdapter> {
    if (this._inner) return this._inner;
    if (!this._resolving) {
      this._resolving = resolveApiKey(this.spec, this.broker).then((apiKey) => {
        this._inner = new GeminiSdkAdapter(this.spec, this.deps, apiKey);
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
