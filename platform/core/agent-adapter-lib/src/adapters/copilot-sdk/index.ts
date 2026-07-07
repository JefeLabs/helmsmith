/**
 * CopilotSdkAdapter — GitHub Copilot Chat HTTP adapter (PRD §8.4, Phase D′).
 *
 * Implements the NEW AgentAdapter interface from src/agent.ts.
 * NOT exported from index.ts until Phase F (coexistence rule); the OLD flat
 * src/copilot-chat-adapter.ts keeps serving current consumers until then.
 *
 * Behaviour:
 *   - stream(): single POST to https://api.githubcopilot.com/chat/completions
 *     with `stream: true`; the SSE body is consumed by SseParser → AgentChunk
 *     (text-delta, tool-call-*, usage, message-stop). The endpoint is
 *     OpenAI-compatible (normalize.ts maps AgentInput → OpenAI request body).
 *   - invoke(): reduceStream(stream(...)) — invoke/stream parity (PRD §10).
 *     ("Single POST" per §8.4 is honoured: one POST per call, streamed + reduced.)
 *   - Auth (PRD §12, Phase 0): broker.getCredential('github-copilot') returns the
 *     ALREADY-EXCHANGED short-lived Copilot session token (the GitHub→Copilot
 *     exchange now lives in the broker, not here); sent as `Authorization:
 *     Bearer <token>`. Fallback COPILOT_TOKEN env (discouraged — no rotation).
 *     MissingCredentialError at construction when none resolves (fail-fast).
 *   - Headers (PRD §8.4): the five hardcoded Copilot contract headers
 *     (headers.ts), logged at DEBUG on every call.
 *   - Tool use: custom OpenAI-style function calling — `tools` forwarded;
 *     `tool_calls` deltas surfaced as tool-call-* (host-loop, PRD §11).
 *   - fetchFn injection for tests; AbortSignal aborts the fetch → 'aborted'.
 *   - Capabilities: CAPABILITY_MATRIX['copilot-sdk'].
 */

import type {
  AgentAdapter,
  AgentInput,
  AgentInvocationResult,
  AgentSpecType,
  CopilotSdkSpec,
  InvokeOptions,
  Logger,
} from '../../agent.ts';
import type { AdapterCapabilities } from '../../capabilities.ts';
import { CAPABILITY_MATRIX } from '../../capabilities.ts';
import type { CredentialBroker } from '../../credentials/broker.ts';
import { classifyHttpError, classifyNetworkError, MissingCredentialError } from '../../errors.ts';
import type { AdapterDeps } from '../../registry.ts';
import { registerAdapter } from '../../registry.ts';
import type { AgentChunk } from '../../stream.ts';
import { reduceStream } from '../../stream.ts';
import { buildCopilotHeaders, COPILOT_CHAT_URL, COPILOT_CONTRACT_HEADERS } from './headers.ts';
import { buildRequestBody } from './normalize.ts';
import { SseParser } from './sse-parser.ts';

const COPILOT_PROVIDER = 'github-copilot';

// ---------------------------------------------------------------------------
// CopilotSdkAdapter
// ---------------------------------------------------------------------------

export class CopilotSdkAdapter implements AgentAdapter {
  readonly type: AgentSpecType = 'copilot-sdk';
  readonly capabilities: AdapterCapabilities;
  readonly workdir: string;

  private readonly spec: CopilotSdkSpec;
  private readonly token: string;
  private readonly fetchFn: typeof fetch;
  private readonly logger?: Logger;

  constructor(spec: CopilotSdkSpec, deps: AdapterDeps, token: string, fetchFn?: typeof fetch) {
    this.spec = spec;
    this.workdir = deps.workdir;
    this.capabilities = CAPABILITY_MATRIX['copilot-sdk'];
    this.token = token;
    this.fetchFn = fetchFn ?? fetch;
    this.logger = deps.logger;
  }

  // -------------------------------------------------------------------------
  // invoke — reduce the stream (PRD §10 parity guarantee)
  // -------------------------------------------------------------------------

  async invoke(input: AgentInput, opts?: InvokeOptions): Promise<AgentInvocationResult> {
    return reduceStream(this.stream(input, opts));
  }

  // -------------------------------------------------------------------------
  // stream — POST stream:true, parse SSE → AgentChunk
  // -------------------------------------------------------------------------

  async *stream(input: AgentInput, opts?: InvokeOptions): AsyncIterable<AgentChunk> {
    const systemPrompt = input.systemPrompt ?? this.spec.systemPrompt;
    const body = buildRequestBody(input, this.spec.model, systemPrompt, true);
    const headers = buildCopilotHeaders(this.token);

    // Audit the contract headers (PRD §8.4 — misconfiguration → silent 403).
    this.logger?.debug?.('[copilot-sdk] request', {
      url: COPILOT_CHAT_URL,
      model: this.spec.model,
      contractHeaders: COPILOT_CONTRACT_HEADERS,
    });

    let res: Response;
    try {
      res = await this.fetchFn(COPILOT_CHAT_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        ...(opts?.signal !== undefined ? { signal: opts.signal } : {}),
      });
    } catch (err) {
      if (isAbort(err, opts?.signal)) {
        yield { type: 'message-stop', finishReason: 'aborted' };
        return;
      }
      yield { type: 'error', error: classifyNetworkError(err, COPILOT_PROVIDER) };
      return;
    }

    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      yield {
        type: 'error',
        error: classifyHttpError({
          status: res.status,
          body: errBody,
          retryAfter: res.headers.get('retry-after'),
          context: COPILOT_PROVIDER,
        }),
      };
      return;
    }

    const parser = new SseParser();
    try {
      for await (const text of readResponseStream(res)) {
        for (const chunk of parser.push(text)) yield chunk;
      }
      for (const chunk of parser.flush()) yield chunk;
    } catch (err) {
      if (isAbort(err, opts?.signal)) {
        yield { type: 'message-stop', finishReason: 'aborted' };
        return;
      }
      yield { type: 'error', error: classifyNetworkError(err, COPILOT_PROVIDER) };
    }
  }
}

// ---------------------------------------------------------------------------
// Response-body streaming — decode the SSE byte stream into text fragments
// ---------------------------------------------------------------------------

async function* readResponseStream(res: Response): AsyncGenerator<string> {
  const body = res.body;
  if (!body) {
    // No streaming body (e.g. a buffered stub) — fall back to the full text.
    const text = await res.text();
    if (text) yield text;
    return;
  }
  const reader = body.getReader();
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) yield decoder.decode(value, { stream: true });
    }
    const tail = decoder.decode();
    if (tail) yield tail;
  } finally {
    reader.releaseLock();
  }
}

function isAbort(err: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  return err instanceof Error && err.name === 'AbortError';
}

// ---------------------------------------------------------------------------
// Token resolution (async — broker may need network/refresh)
// ---------------------------------------------------------------------------

/**
 * Resolve the Copilot session token (the broker returns the ALREADY-EXCHANGED
 * token — Phase 0). Priority: spec.apiKey → broker.getCredential('github-copilot')
 * → COPILOT_TOKEN env → MissingCredentialError.
 */
export async function resolveCopilotToken(
  spec: CopilotSdkSpec,
  broker?: CredentialBroker,
  logger?: Logger,
): Promise<string> {
  if (spec.apiKey) return spec.apiKey;
  if (broker) {
    try {
      const cred = await broker.getCredential(COPILOT_PROVIDER);
      if (cred.apiKey) return cred.apiKey;
    } catch (err) {
      // Don't swallow silently — log and fall back to env.
      logger?.warn?.(
        `[copilot-sdk] credential broker failed for '${COPILOT_PROVIDER}'; falling back to env: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
  const envToken = process.env.COPILOT_TOKEN;
  if (envToken) return envToken;
  throw new MissingCredentialError(
    'No Copilot session token found for copilot-sdk adapter. Provide one via spec.apiKey, ' +
      `CredentialBroker.getCredential("${COPILOT_PROVIDER}") (which returns the exchanged Copilot ` +
      'session token), or the COPILOT_TOKEN environment variable (discouraged — no auto-refresh).',
  );
}

// ---------------------------------------------------------------------------
// Factory + self-registration
// ---------------------------------------------------------------------------

registerAdapter(
  'copilot-sdk',
  (spec, deps) => {
    const sdkSpec = spec as CopilotSdkSpec;
    // Precedence must match resolveCopilotToken: spec → broker → env. Only an
    // explicit spec.apiKey short-circuits; when a broker is present we defer to
    // lazy resolution so the broker is PREFERRED over env (token rotation —
    // Copilot session tokens are short-lived and the broker refreshes them).
    if (sdkSpec.apiKey) return new CopilotSdkAdapter(sdkSpec, deps, sdkSpec.apiKey);
    if (deps.credentialBroker) {
      return new LazyCopilotSdkAdapter(sdkSpec, deps, deps.credentialBroker);
    }
    const envToken = process.env.COPILOT_TOKEN;
    if (envToken) return new CopilotSdkAdapter(sdkSpec, deps, envToken);
    throw new MissingCredentialError(
      'No Copilot session token found for copilot-sdk adapter. Provide one via spec.apiKey, ' +
        `CredentialBroker.getCredential("${COPILOT_PROVIDER}"), or the COPILOT_TOKEN env var.`,
    );
  },
  CAPABILITY_MATRIX['copilot-sdk'],
);

// ---------------------------------------------------------------------------
// LazyCopilotSdkAdapter — defers token resolution to first invoke/stream
// ---------------------------------------------------------------------------

class LazyCopilotSdkAdapter implements AgentAdapter {
  readonly type: AgentSpecType = 'copilot-sdk';
  readonly capabilities: AdapterCapabilities;
  readonly workdir: string;

  private _inner: CopilotSdkAdapter | null = null;
  private _resolving: Promise<CopilotSdkAdapter> | null = null;

  constructor(
    private readonly spec: CopilotSdkSpec,
    private readonly deps: AdapterDeps,
    private readonly broker: CredentialBroker,
  ) {
    this.workdir = deps.workdir;
    this.capabilities = CAPABILITY_MATRIX['copilot-sdk'];
  }

  private async _resolve(): Promise<CopilotSdkAdapter> {
    if (this._inner) return this._inner;
    if (!this._resolving) {
      this._resolving = resolveCopilotToken(this.spec, this.broker, this.deps.logger).then(
        (token) => {
          this._inner = new CopilotSdkAdapter(this.spec, this.deps, token);
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
