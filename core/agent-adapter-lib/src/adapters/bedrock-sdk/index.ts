/**
 * BedrockSdkAdapter — in-process AWS Bedrock Converse adapter (Phase D⁗b,
 * chat-mode). Adapter 11/11.
 *
 * Implements the NEW AgentAdapter interface from src/agent.ts. NOT exported from
 * index.ts until Phase F (coexistence rule).
 *
 * Behaviour (mirrors claude-sdk / openai-sdk / gemini-sdk):
 *   - stream(): drives BedrockRuntimeClient.send(ConverseStreamCommand) and maps
 *     each ConverseStreamOutput event → AgentChunk:
 *       contentBlockDelta.delta.text             → text-delta
 *       contentBlockStart.start.toolUse / delta.toolUse.input → tool-call-*
 *       contentBlockDelta.delta.reasoningContent.text → thinking-delta
 *       metadata.usage                            → usage
 *       messageStop.stopReason                    → message-stop (mapped finishReason)
 *   - invoke(): reduceStream(stream(...)) — invoke/stream parity (PRD §10).
 *   - Tools: API-level host-loop. toolUse blocks surfaced as tool-call-*; the
 *     host re-invokes with the resulting tool-use blocks. Bedrock streams tool
 *     input incrementally (delta.toolUse.input is a partial JSON string), so
 *     each call emits start → input* → end, parsing the joined JSON at the stop.
 *
 * AUTH WRINKLE (documented): Bedrock authenticates via the **AWS credential
 * chain**, NOT an `{ apiKey }`. Unlike every other SDK adapter, this one does
 * NOT consult the CredentialBroker — the AWS SDK resolves credentials itself
 * from (in order): the AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY (+ optional
 * AWS_SESSION_TOKEN) env vars, the shared `~/.aws/credentials` + `~/.aws/config`
 * profiles, AWS SSO, and the EC2/ECS IAM role (IMDS). The broker's
 * `{ apiKey }` shape cannot express an AWS access-key pair, so honoring it would
 * be lossy; we deliberately bypass it. `region` is REQUIRED (from spec.region or
 * AWS_REGION / AWS_DEFAULT_REGION) → ConfigError at construction if absent.
 * Credential resolution is deferred to the first call (the AWS chain is broad
 * and resolves lazily); an unresolved chain surfaces as a MissingCredentialError
 * error chunk with AWS-specific remediation.
 *
 *   - AbortSignal: forwarded via client.send(cmd, { abortSignal }) → 'aborted'.
 *   - Capabilities: from CAPABILITY_MATRIX['bedrock-sdk'] (supportsJsonMode: false,
 *     supportsExtendedThinking: true via reasoningContent).
 */

import { BedrockRuntimeClient, ConverseStreamCommand } from '@aws-sdk/client-bedrock-runtime';
import type {
  AgentAdapter,
  AgentInput,
  AgentInvocationResult,
  AgentSpecType,
  BedrockSdkSpec,
  InvokeOptions,
  Logger,
  TokenUsage,
} from '../../agent.ts';
import type { AdapterCapabilities } from '../../capabilities.ts';
import { CAPABILITY_MATRIX } from '../../capabilities.ts';
import {
  type AdapterError,
  AuthError,
  CapabilityMismatchError,
  ConfigError,
  classifyHttpError,
  classifyNetworkError,
  MissingCredentialError,
} from '../../errors.ts';
import type { AdapterDeps } from '../../registry.ts';
import { registerAdapter } from '../../registry.ts';
import type { AgentChunk } from '../../stream.ts';
import { reduceStream } from '../../stream.ts';
import { buildRequest, mapStopReason } from './normalize.ts';

const BEDROCK_PROVIDER = 'bedrock';

const BEDROCK_CRED_REMEDIATION =
  'No AWS credentials could be resolved for the bedrock-sdk adapter. Bedrock uses the AWS ' +
  'credential chain (it does NOT take an apiKey). Provide credentials via the AWS_ACCESS_KEY_ID / ' +
  'AWS_SECRET_ACCESS_KEY (+ optional AWS_SESSION_TOKEN) environment variables, a ~/.aws/credentials ' +
  'profile (set spec.profile or AWS_PROFILE), AWS SSO, or an attached IAM role.';

// ---------------------------------------------------------------------------
// Minimal structural views of the ConverseStream event union (the mock
// satisfies these structurally; the real ConverseStreamOutput is assignable).
// ---------------------------------------------------------------------------

interface BedrockStreamDelta {
  text?: string;
  toolUse?: { input?: string };
  reasoningContent?: { text?: string; signature?: string; redactedContent?: Uint8Array };
}

interface BedrockStreamEvent {
  messageStart?: { role?: string };
  contentBlockStart?: {
    start?: { toolUse?: { toolUseId?: string; name?: string } };
    contentBlockIndex?: number;
  };
  contentBlockDelta?: { delta?: BedrockStreamDelta; contentBlockIndex?: number };
  contentBlockStop?: { contentBlockIndex?: number };
  messageStop?: { stopReason?: string };
  metadata?: {
    usage?: {
      inputTokens?: number;
      outputTokens?: number;
      cacheReadInputTokens?: number;
      cacheWriteInputTokens?: number;
    };
  };
}

interface InProgressToolCall {
  toolCallId: string;
  toolName: string;
  argParts: string[];
}

// ---------------------------------------------------------------------------
// Region resolution (AWS credential-chain region)
// ---------------------------------------------------------------------------

/**
 * Resolve the AWS region at construction time.
 *
 * Priority: spec.region → AWS_REGION → AWS_DEFAULT_REGION → ConfigError. The
 * region is required because the Bedrock runtime client cannot route a request
 * without one.
 */
export function resolveRegion(spec: BedrockSdkSpec): string {
  const region = spec.region ?? process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION;
  if (!region) {
    throw new ConfigError(
      'No AWS region found for the bedrock-sdk adapter. Provide one via spec.region or the ' +
        'AWS_REGION / AWS_DEFAULT_REGION environment variable.',
    );
  }
  return region;
}

// ---------------------------------------------------------------------------
// BedrockSdkAdapter
// ---------------------------------------------------------------------------

export class BedrockSdkAdapter implements AgentAdapter {
  readonly type: AgentSpecType = 'bedrock-sdk';
  readonly capabilities: AdapterCapabilities;
  readonly workdir: string;
  readonly region: string;

  private readonly client: BedrockRuntimeClient;
  private readonly spec: BedrockSdkSpec;
  private readonly logger?: Logger;

  constructor(spec: BedrockSdkSpec, deps: AdapterDeps) {
    this.spec = spec;
    this.workdir = deps.workdir;
    this.capabilities = CAPABILITY_MATRIX['bedrock-sdk'];
    this.logger = deps.logger;
    this.region = resolveRegion(spec);

    // AUTH: the CredentialBroker is intentionally bypassed for bedrock — the AWS
    // SDK resolves credentials via its own default chain (see file docstring).
    // A named profile is surfaced to that chain via the standard AWS_PROFILE env
    // convention, without clobbering an AWS_PROFILE already set in the env.
    if (spec.profile && !process.env.AWS_PROFILE) {
      process.env.AWS_PROFILE = spec.profile;
    }

    this.client = new BedrockRuntimeClient({ region: this.region });
  }

  // -------------------------------------------------------------------------
  // invoke — reduce the stream (PRD §10 parity guarantee)
  // -------------------------------------------------------------------------

  async invoke(input: AgentInput, opts?: InvokeOptions): Promise<AgentInvocationResult> {
    this._checkToolCapability(input);
    return reduceStream(this.stream(input, opts));
  }

  // -------------------------------------------------------------------------
  // stream — ConverseStream event stream → AgentChunk async iterable
  // -------------------------------------------------------------------------

  async *stream(input: AgentInput, opts?: InvokeOptions): AsyncIterable<AgentChunk> {
    this._checkToolCapability(input);

    const systemPrompt = input.systemPrompt ?? this.spec.systemPrompt;
    const request = buildRequest(input, this.spec.model, systemPrompt);

    this.logger?.debug?.('[bedrock-sdk] request', { model: this.spec.model, region: this.region });

    // Tool calls keyed by their Converse contentBlockIndex.
    const toolCalls = new Map<number, InProgressToolCall>();
    let usage: TokenUsage | undefined;
    let finishReason: AgentInvocationResult['finishReason'];

    try {
      const command = new ConverseStreamCommand(
        request as unknown as ConstructorParameters<typeof ConverseStreamCommand>[0],
      );
      const response = (await this.client.send(
        command,
        opts?.signal !== undefined ? { abortSignal: opts.signal } : undefined,
      )) as unknown as { stream?: AsyncIterable<BedrockStreamEvent> };

      for await (const event of response.stream ?? []) {
        if (event.contentBlockStart?.start?.toolUse) {
          yield* startToolCall(event, toolCalls);
        }
        if (event.contentBlockDelta) {
          yield* handleDelta(event, toolCalls);
        }
        if (event.contentBlockStop) {
          yield* stopContentBlock(event, toolCalls);
        }
        if (event.messageStop?.stopReason) {
          finishReason = mapStopReason(event.messageStop.stopReason);
        }
        if (event.metadata?.usage) {
          const u = event.metadata.usage;
          usage = {
            inputTokens: u.inputTokens ?? 0,
            outputTokens: u.outputTokens ?? 0,
            ...(u.cacheReadInputTokens !== undefined
              ? { cacheReadTokens: u.cacheReadInputTokens }
              : {}),
            ...(u.cacheWriteInputTokens !== undefined
              ? { cacheWriteTokens: u.cacheWriteInputTokens }
              : {}),
          };
        }
      }
    } catch (err) {
      if (isAbort(err, opts?.signal)) {
        yield { type: 'message-stop', finishReason: 'aborted' };
        return;
      }
      yield { type: 'error', error: classifyBedrockError(err) };
      return;
    }

    // Close any tool calls not terminated by a contentBlockStop (defensive).
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
// ConverseStream event → AgentChunk mapping helpers
// ---------------------------------------------------------------------------

function* startToolCall(
  event: BedrockStreamEvent,
  toolCalls: Map<number, InProgressToolCall>,
): Generator<AgentChunk> {
  const start = event.contentBlockStart?.start?.toolUse;
  if (!start) return;
  const idx = event.contentBlockStart?.contentBlockIndex ?? 0;
  const entry: InProgressToolCall = {
    toolCallId: start.toolUseId ?? `bedrock-tool-${idx}`,
    toolName: start.name ?? 'unknown',
    argParts: [],
  };
  toolCalls.set(idx, entry);
  yield { type: 'tool-call-start', toolCallId: entry.toolCallId, toolName: entry.toolName };
}

function* handleDelta(
  event: BedrockStreamEvent,
  toolCalls: Map<number, InProgressToolCall>,
): Generator<AgentChunk> {
  const delta = event.contentBlockDelta?.delta;
  if (!delta) return;
  if (delta.text) {
    yield { type: 'text-delta', text: delta.text };
  }
  if (delta.reasoningContent?.text) {
    yield { type: 'thinking-delta', text: delta.reasoningContent.text };
  }
  if (delta.toolUse?.input !== undefined) {
    const idx = event.contentBlockDelta?.contentBlockIndex ?? 0;
    let entry = toolCalls.get(idx);
    if (!entry) {
      // Defensive: a toolUse delta with no preceding contentBlockStart.
      entry = { toolCallId: `bedrock-tool-${idx}`, toolName: 'unknown', argParts: [] };
      toolCalls.set(idx, entry);
      yield { type: 'tool-call-start', toolCallId: entry.toolCallId, toolName: entry.toolName };
    }
    const part = delta.toolUse.input;
    entry.argParts.push(part);
    yield { type: 'tool-call-input', toolCallId: entry.toolCallId, partialInput: part };
  }
}

function* stopContentBlock(
  event: BedrockStreamEvent,
  toolCalls: Map<number, InProgressToolCall>,
): Generator<AgentChunk> {
  const idx = event.contentBlockStop?.contentBlockIndex ?? 0;
  const entry = toolCalls.get(idx);
  if (!entry) return; // a text/reasoning block stop carries no tool state.
  yield finalizeToolCall(entry);
  toolCalls.delete(idx);
}

function* emitToolCallEnds(toolCalls: Map<number, InProgressToolCall>): Generator<AgentChunk> {
  for (const entry of toolCalls.values()) {
    yield finalizeToolCall(entry);
  }
  toolCalls.clear();
}

function finalizeToolCall(entry: InProgressToolCall): AgentChunk {
  const joined = entry.argParts.join('');
  let input: unknown = {};
  if (joined.length > 0) {
    try {
      input = JSON.parse(joined);
    } catch {
      input = joined;
    }
  }
  return { type: 'tool-call-end', toolCallId: entry.toolCallId, input };
}

// ---------------------------------------------------------------------------
// Error + abort classification
// ---------------------------------------------------------------------------

function isAbort(err: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  return err instanceof Error && (err.name === 'AbortError' || /abort/i.test(err.message));
}

/** True when the AWS SDK failed to resolve credentials from any provider. */
function isCredentialError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const name = (err as { name?: string }).name ?? '';
  if (name === 'CredentialsProviderError') return true;
  const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
  const message = (err as { message?: string }).message ?? '';
  // A credential-chain failure has no HTTP status (it never reached Bedrock).
  return status === undefined && /credential/i.test(message);
}

function classifyBedrockError(err: unknown): AdapterError {
  if (isCredentialError(err)) {
    return new MissingCredentialError(BEDROCK_CRED_REMEDIATION, { cause: err });
  }
  const message = err instanceof Error ? err.message : String(err);
  const status = (err as { $metadata?: { httpStatusCode?: number } } | null)?.$metadata
    ?.httpStatusCode;
  if (typeof status === 'number' && status > 0) {
    // Bedrock AccessDenied is 403; classifyHttpError only special-cases 401.
    if (status === 401 || status === 403) {
      return new AuthError(`${BEDROCK_PROVIDER}: auth failed (${status}): ${message}`, {
        cause: err,
      });
    }
    return classifyHttpError({ status, body: message, cause: err, context: BEDROCK_PROVIDER });
  }
  return classifyNetworkError(err, BEDROCK_PROVIDER);
}

// ---------------------------------------------------------------------------
// Factory + self-registration
// ---------------------------------------------------------------------------

registerAdapter(
  'bedrock-sdk',
  // region validation (ConfigError) happens in the constructor — fail fast at
  // createAgent() time. Credentials resolve lazily via the AWS chain on first call.
  (spec, deps) => new BedrockSdkAdapter(spec as BedrockSdkSpec, deps),
  CAPABILITY_MATRIX['bedrock-sdk'],
);
