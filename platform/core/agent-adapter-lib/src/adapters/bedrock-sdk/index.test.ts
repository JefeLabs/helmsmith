/**
 * BedrockSdkAdapter unit tests.
 *
 * Mocks `@aws-sdk/client-bedrock-runtime` so no real AWS calls are made. Covers:
 * AgentChunk mapping (contentBlockDelta text / toolUse / reasoningContent,
 * metadata usage, messageStop), invoke=reduceStream parity, region passed to the
 * client, missing-region → ConfigError, unresolved-creds → MissingCredentialError,
 * host-loop tool-call surfacing, abort, HTTP error classification, and the
 * AWS_PROFILE auth wrinkle.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BedrockSdkSpec } from '../../agent.ts';
import { CAPABILITY_MATRIX } from '../../capabilities.ts';
import { AuthError, ConfigError, MissingCredentialError } from '../../errors.ts';
import type { AdapterDeps } from '../../registry.ts';
import { getAdapterFactory } from '../../registry.ts';
import type { AgentChunk } from '../../stream.ts';
import { BedrockSdkAdapter, resolveRegion } from './index.ts';

// ---------------------------------------------------------------------------
// Mock `@aws-sdk/client-bedrock-runtime`
// ---------------------------------------------------------------------------

let fakeEvents: Array<Record<string, unknown>> = [];
let sendError: unknown;
let lastCommandInput: Record<string, unknown> | undefined;
let lastSendOptions: { abortSignal?: AbortSignal } | undefined;
let lastClientConfig: { region?: string } | undefined;

vi.mock('@aws-sdk/client-bedrock-runtime', () => {
  class ConverseStreamCommand {
    constructor(public input: Record<string, unknown>) {}
  }

  async function* makeStream(options?: {
    abortSignal?: AbortSignal;
  }): AsyncGenerator<Record<string, unknown>> {
    for (const event of fakeEvents) {
      if (options?.abortSignal?.aborted) {
        throw Object.assign(new Error('Request aborted'), { name: 'AbortError' });
      }
      yield event;
    }
  }

  class BedrockRuntimeClient {
    send = vi.fn(
      async (
        command: { input: Record<string, unknown> },
        options?: { abortSignal?: AbortSignal },
      ) => {
        lastCommandInput = command.input;
        lastSendOptions = options;
        if (sendError) throw sendError;
        return { stream: makeStream(options) };
      },
    );
    constructor(public config: { region?: string }) {
      lastClientConfig = config;
    }
  }

  return { BedrockRuntimeClient, ConverseStreamCommand };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSpec(over?: Partial<BedrockSdkSpec>): BedrockSdkSpec {
  return {
    type: 'bedrock-sdk',
    model: 'anthropic.claude-3-5-sonnet',
    region: 'us-east-1',
    ...over,
  };
}

function makeDeps(over?: Partial<AdapterDeps>): AdapterDeps {
  return { workdir: '/work/dir', repoRoot: '/work/dir', commit: 'abc', branch: 'main', ...over };
}

function makeAdapter(spec?: Partial<BedrockSdkSpec>, deps?: Partial<AdapterDeps>) {
  return new BedrockSdkAdapter(makeSpec(spec), makeDeps(deps));
}

async function collect(stream: AsyncIterable<AgentChunk>): Promise<AgentChunk[]> {
  const out: AgentChunk[] = [];
  for await (const c of stream) out.push(c);
  return out;
}

function textDeltaEvent(text: string): Record<string, unknown> {
  return { contentBlockDelta: { delta: { text }, contentBlockIndex: 0 } };
}
function messageStopEvent(stopReason: string): Record<string, unknown> {
  return { messageStop: { stopReason } };
}
function metadataEvent(inputTokens = 3, outputTokens = 2): Record<string, unknown> {
  return { metadata: { usage: { inputTokens, outputTokens } } };
}

let savedRegion: string | undefined;
let savedDefaultRegion: string | undefined;
let savedProfile: string | undefined;

beforeEach(() => {
  fakeEvents = [];
  sendError = undefined;
  lastCommandInput = undefined;
  lastSendOptions = undefined;
  lastClientConfig = undefined;
  savedRegion = process.env.AWS_REGION;
  savedDefaultRegion = process.env.AWS_DEFAULT_REGION;
  savedProfile = process.env.AWS_PROFILE;
  delete process.env.AWS_REGION;
  delete process.env.AWS_DEFAULT_REGION;
  delete process.env.AWS_PROFILE;
});
afterEach(() => {
  restore('AWS_REGION', savedRegion);
  restore('AWS_DEFAULT_REGION', savedDefaultRegion);
  restore('AWS_PROFILE', savedProfile);
  vi.clearAllMocks();
});

function restore(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

// ---------------------------------------------------------------------------
// Basics
// ---------------------------------------------------------------------------

describe('BedrockSdkAdapter — basics', () => {
  it('reports the bedrock-sdk capability matrix (host-loop, no json mode)', () => {
    const adapter = makeAdapter();
    expect(adapter.type).toBe('bedrock-sdk');
    expect(adapter.capabilities).toEqual(CAPABILITY_MATRIX['bedrock-sdk']);
    expect(adapter.capabilities.supportsToolUse).toBe(true);
    expect(adapter.capabilities.supportsJsonMode).toBe(false);
    expect(adapter.capabilities.supportsExtendedThinking).toBe(true);
    expect(adapter.capabilities.reportsUsage).toBe(true);
  });

  it('passes the resolved region to the Bedrock client', () => {
    const adapter = makeAdapter({ region: 'us-west-2' });
    expect(adapter.region).toBe('us-west-2');
    expect(lastClientConfig?.region).toBe('us-west-2');
  });
});

// ---------------------------------------------------------------------------
// Streaming + parity
// ---------------------------------------------------------------------------

describe('BedrockSdkAdapter — streaming + parity', () => {
  it('maps ConverseStream events to AgentChunks (text, usage, message-stop)', async () => {
    fakeEvents = [
      { messageStart: { role: 'assistant' } },
      textDeltaEvent('po'),
      textDeltaEvent('ng'),
      { contentBlockStop: { contentBlockIndex: 0 } },
      messageStopEvent('end_turn'),
      metadataEvent(3, 2),
    ];
    const chunks = await collect(
      makeAdapter().stream({ messages: [{ role: 'user', content: 'ping' }] }),
    );
    expect(chunks).toEqual<AgentChunk[]>([
      { type: 'text-delta', text: 'po' },
      { type: 'text-delta', text: 'ng' },
      { type: 'usage', usage: { inputTokens: 3, outputTokens: 2 } },
      { type: 'message-stop', finishReason: 'stop' },
    ]);
  });

  it('invoke() reduces the same stream', async () => {
    fakeEvents = [
      textDeltaEvent('po'),
      textDeltaEvent('ng'),
      messageStopEvent('end_turn'),
      metadataEvent(3, 2),
    ];
    const result = await makeAdapter().invoke({ messages: [{ role: 'user', content: 'ping' }] });
    expect(result.content).toBe('pong');
    expect(result.finishReason).toBe('stop');
    expect(result.usage).toEqual({ inputTokens: 3, outputTokens: 2 });
  });

  it('maps reasoningContent deltas to thinking-delta', async () => {
    fakeEvents = [
      {
        contentBlockDelta: {
          delta: { reasoningContent: { text: 'let me think' } },
          contentBlockIndex: 0,
        },
      },
      textDeltaEvent('answer'),
      messageStopEvent('end_turn'),
    ];
    const chunks = await collect(
      makeAdapter().stream({ messages: [{ role: 'user', content: 'q' }] }),
    );
    expect(chunks).toContainEqual({ type: 'thinking-delta', text: 'let me think' });
    expect(chunks).toContainEqual({ type: 'text-delta', text: 'answer' });
  });

  it('sends the normalized Converse request (modelId + messages + system)', async () => {
    fakeEvents = [textDeltaEvent('ok'), messageStopEvent('end_turn')];
    await collect(
      makeAdapter({ model: 'amazon.nova-pro-v1' }).stream({
        messages: [{ role: 'user', content: 'hi' }],
        systemPrompt: 'sys',
      }),
    );
    expect(lastCommandInput?.modelId).toBe('amazon.nova-pro-v1');
    expect(lastCommandInput?.messages).toEqual([{ role: 'user', content: [{ text: 'hi' }] }]);
    expect(lastCommandInput?.system).toEqual([{ text: 'sys' }]);
  });
});

// ---------------------------------------------------------------------------
// Tool use (host-loop)
// ---------------------------------------------------------------------------

describe('BedrockSdkAdapter — tool use', () => {
  it('surfaces toolUse content blocks as tool-call-* chunks', async () => {
    fakeEvents = [
      { messageStart: { role: 'assistant' } },
      {
        contentBlockStart: {
          start: { toolUse: { toolUseId: 'tool_1', name: 'f' } },
          contentBlockIndex: 0,
        },
      },
      { contentBlockDelta: { delta: { toolUse: { input: '{"a":' } }, contentBlockIndex: 0 } },
      { contentBlockDelta: { delta: { toolUse: { input: '1}' } }, contentBlockIndex: 0 } },
      { contentBlockStop: { contentBlockIndex: 0 } },
      messageStopEvent('tool_use'),
      metadataEvent(5, 1),
    ];
    const chunks = await collect(
      makeAdapter().stream({
        messages: [{ role: 'user', content: 'go' }],
        tools: [{ name: 'f' }],
      }),
    );
    expect(chunks).toContainEqual({ type: 'tool-call-start', toolCallId: 'tool_1', toolName: 'f' });
    expect(chunks).toContainEqual({
      type: 'tool-call-input',
      toolCallId: 'tool_1',
      partialInput: '{"a":',
    });
    expect(chunks).toContainEqual({ type: 'tool-call-end', toolCallId: 'tool_1', input: { a: 1 } });
    expect(chunks.at(-1)).toEqual({ type: 'message-stop', finishReason: 'tool_use' });

    // tools forwarded into toolConfig
    const toolConfig = lastCommandInput?.toolConfig as {
      tools: Array<{ toolSpec: { name: string } }>;
    };
    expect(toolConfig.tools[0]?.toolSpec.name).toBe('f');
  });
});

// ---------------------------------------------------------------------------
// Auth (the AWS-credential-chain wrinkle)
// ---------------------------------------------------------------------------

describe('BedrockSdkAdapter — auth + region', () => {
  it('resolveRegion prefers spec.region, then AWS_REGION, then AWS_DEFAULT_REGION', () => {
    expect(resolveRegion(makeSpec({ region: 'eu-west-1' }))).toBe('eu-west-1');
    process.env.AWS_REGION = 'ap-south-1';
    expect(resolveRegion(makeSpec({ region: undefined }))).toBe('ap-south-1');
    delete process.env.AWS_REGION;
    process.env.AWS_DEFAULT_REGION = 'us-east-2';
    expect(resolveRegion(makeSpec({ region: undefined }))).toBe('us-east-2');
  });

  it('throws ConfigError at construction when no region resolves', () => {
    expect(() => new BedrockSdkAdapter(makeSpec({ region: undefined }), makeDeps())).toThrow(
      ConfigError,
    );
  });

  it('surfaces an unresolved AWS credential chain as a MissingCredentialError chunk', async () => {
    sendError = Object.assign(new Error('Could not load credentials from any providers'), {
      name: 'CredentialsProviderError',
    });
    const chunks = await collect(
      makeAdapter().stream({ messages: [{ role: 'user', content: 'x' }] }),
    );
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.type).toBe('error');
    if (chunks[0]?.type === 'error') {
      expect(chunks[0].error).toBeInstanceOf(MissingCredentialError);
    }
  });

  it('does NOT consult the CredentialBroker (broker is bypassed for bedrock)', async () => {
    fakeEvents = [textDeltaEvent('ok'), messageStopEvent('end_turn')];
    const broker = { getCredential: vi.fn(async () => ({ apiKey: 'unused' })) };
    await makeAdapter(undefined, { credentialBroker: broker }).invoke({
      messages: [{ role: 'user', content: 'hi' }],
    });
    expect(broker.getCredential).not.toHaveBeenCalled();
  });

  it('surfaces spec.profile via AWS_PROFILE without clobbering an existing value', () => {
    makeAdapter({ profile: 'dev-profile' });
    expect(process.env.AWS_PROFILE).toBe('dev-profile');

    process.env.AWS_PROFILE = 'explicit';
    makeAdapter({ profile: 'other-profile' });
    expect(process.env.AWS_PROFILE).toBe('explicit');
  });
});

// ---------------------------------------------------------------------------
// Errors + abort
// ---------------------------------------------------------------------------

describe('BedrockSdkAdapter — errors + abort', () => {
  it('classifies a 403 AccessDenied ($metadata) as an AuthError chunk', async () => {
    sendError = Object.assign(new Error('User is not authorized to perform bedrock:InvokeModel'), {
      name: 'AccessDeniedException',
      $metadata: { httpStatusCode: 403 },
    });
    const chunks = await collect(
      makeAdapter().stream({ messages: [{ role: 'user', content: 'x' }] }),
    );
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.type).toBe('error');
    if (chunks[0]?.type === 'error') {
      expect(chunks[0].error).toBeInstanceOf(AuthError);
    }
  });

  it('ends with finishReason aborted when the request aborts', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    fakeEvents = [textDeltaEvent('partial')];
    const chunks = await collect(
      makeAdapter().stream({ messages: [{ role: 'user', content: 'x' }] }, { signal: ctrl.signal }),
    );
    expect(chunks.at(-1)).toEqual({ type: 'message-stop', finishReason: 'aborted' });
    expect(lastSendOptions?.abortSignal).toBe(ctrl.signal);
  });
});

// ---------------------------------------------------------------------------
// Factory / registration
// ---------------------------------------------------------------------------

describe('BedrockSdkAdapter — factory', () => {
  it('is self-registered and constructs an adapter', async () => {
    fakeEvents = [textDeltaEvent('ok'), messageStopEvent('end_turn')];
    const factory = getAdapterFactory('bedrock-sdk');
    expect(factory).toBeDefined();
    const adapter = factory?.factory(makeSpec(), makeDeps());
    const result = await adapter?.invoke({ messages: [{ role: 'user', content: 'hi' }] });
    expect(result?.content).toBe('ok');
  });

  it('factory throws ConfigError when no region resolves', () => {
    const factory = getAdapterFactory('bedrock-sdk');
    expect(() => factory?.factory(makeSpec({ region: undefined }), makeDeps())).toThrow(
      ConfigError,
    );
  });
});

// ---------------------------------------------------------------------------
// Live integration (gated on real AWS creds + region — skipped here)
// ---------------------------------------------------------------------------

const LIVE_BEDROCK =
  !!process.env.AWS_REGION &&
  (!!process.env.AWS_ACCESS_KEY_ID || !!process.env.AWS_PROFILE) &&
  !!process.env.BEDROCK_LIVE_MODEL;

describe.skipIf(!LIVE_BEDROCK)('BedrockSdkAdapter — live integration', () => {
  it('invokes a real Bedrock model and returns text', async () => {
    const adapter = new BedrockSdkAdapter(
      {
        type: 'bedrock-sdk',
        model: process.env.BEDROCK_LIVE_MODEL as string,
        region: process.env.AWS_REGION as string,
      },
      makeDeps(),
    );
    const result = await adapter.invoke({
      messages: [{ role: 'user', content: 'Reply with exactly: pong' }],
    });
    expect(result.content.toLowerCase()).toContain('pong');
  }, 30000);
});
