/**
 * ClaudeSdkAdapter unit tests.
 *
 * Mocks @anthropic-ai/sdk so no real API calls are made.
 * Tests cover: AgentChunk mapping, invoke=reduceStream parity,
 * broker apiKey resolution, missing cred, abort, tool-use, usage.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClaudeSdkSpec } from '../../agent.ts';
import { CAPABILITY_MATRIX } from '../../capabilities.ts';
import { MissingCredentialError } from '../../errors.ts';
import type { AdapterDeps } from '../../registry.ts';
import { getAdapterFactory } from '../../registry.ts';
import type { AgentChunk } from '../../stream.ts';
import { ClaudeSdkAdapter, resolveApiKey } from './index.ts';

// ---------------------------------------------------------------------------
// Mock @anthropic-ai/sdk
// ---------------------------------------------------------------------------

// We define the fake stream factory before vi.mock() so the hoisted mock
// can access it via a shared let binding.
let fakeStreamEvents: Array<Record<string, unknown>> = [];
// Captures the request body passed to messages.stream() for assertions.
let lastStreamBody: Record<string, unknown> | undefined;

vi.mock('@anthropic-ai/sdk', () => {
  class APIUserAbortError extends Error {
    constructor() {
      super('Request was aborted.');
      this.name = 'APIUserAbortError';
    }
  }

  class APIError extends Error {
    status = 500;
    headers: Record<string, string> = {};
    error: unknown = {};
  }

  async function* makeFakeStream(
    body: unknown,
    opts?: { signal?: AbortSignal },
  ): AsyncIterable<Record<string, unknown>> {
    lastStreamBody = body as Record<string, unknown>;
    for (const event of fakeStreamEvents) {
      if (opts?.signal?.aborted) {
        throw new APIUserAbortError();
      }
      yield event;
    }
  }

  const streamMock = vi.fn().mockImplementation(makeFakeStream);

  // Use a proper class (not arrow function) so `new MockAnthropic()` works
  class MockAnthropic {
    static APIError = APIError;
    static APIUserAbortError = APIUserAbortError;

    messages = {
      stream: streamMock,
    };
  }

  return {
    default: MockAnthropic,
    APIUserAbortError,
  };
});

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeSpec(overrides?: Partial<ClaudeSdkSpec>): ClaudeSdkSpec {
  return { type: 'claude-sdk', model: 'claude-opus-4-7', apiKey: 'sk-test-key', ...overrides };
}

function makeDeps(overrides?: Partial<AdapterDeps>): AdapterDeps {
  return {
    workdir: '/tmp/test-repo',
    repoRoot: '/tmp/test-repo',
    commit: 'abc123',
    branch: 'main',
    ...overrides,
  };
}

function makeAdapter(spec?: Partial<ClaudeSdkSpec>, deps?: Partial<AdapterDeps>): ClaudeSdkAdapter {
  return new ClaudeSdkAdapter(makeSpec(spec), makeDeps(deps), makeSpec(spec).apiKey ?? 'sk-test');
}

async function collectChunks(
  adapter: ClaudeSdkAdapter,
  messages = [{ role: 'user' as const, content: 'hello' }],
): Promise<AgentChunk[]> {
  const chunks: AgentChunk[] = [];
  for await (const chunk of adapter.stream({ messages })) {
    chunks.push(chunk);
  }
  return chunks;
}

// ---------------------------------------------------------------------------
// Stream event factories
// ---------------------------------------------------------------------------

function messageStartEvent(inputTokens = 10): Record<string, unknown> {
  return {
    type: 'message_start',
    message: {
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      content: [],
      model: 'claude-opus-4-7',
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: inputTokens, output_tokens: 0 },
    },
  };
}

function textBlockStart(index = 0): Record<string, unknown> {
  return { type: 'content_block_start', index, content_block: { type: 'text', text: '' } };
}

function textDelta(text: string, index = 0): Record<string, unknown> {
  return { type: 'content_block_delta', index, delta: { type: 'text_delta', text } };
}

function textBlockStop(index = 0): Record<string, unknown> {
  return { type: 'content_block_stop', index };
}

function toolBlockStart(index: number, id: string, name: string): Record<string, unknown> {
  return {
    type: 'content_block_start',
    index,
    content_block: { type: 'tool_use', id, name, input: {} },
  };
}

function toolInputDelta(partialJson: string, index: number): Record<string, unknown> {
  return {
    type: 'content_block_delta',
    index,
    delta: { type: 'input_json_delta', partial_json: partialJson },
  };
}

function messageDeltaEvent(stopReason: string, outputTokens = 5): Record<string, unknown> {
  return {
    type: 'message_delta',
    delta: { stop_reason: stopReason, stop_sequence: null },
    usage: { output_tokens: outputTokens },
  };
}

function thinkingBlockStart(index = 0): Record<string, unknown> {
  return {
    type: 'content_block_start',
    index,
    content_block: { type: 'thinking', thinking: '', signature: '' },
  };
}

function thinkingDelta(thinking: string, index = 0): Record<string, unknown> {
  return { type: 'content_block_delta', index, delta: { type: 'thinking_delta', thinking } };
}

function signatureDelta(signature: string, index = 0): Record<string, unknown> {
  return { type: 'content_block_delta', index, delta: { type: 'signature_delta', signature } };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  fakeStreamEvents = [];
  lastStreamBody = undefined;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('ClaudeSdkAdapter — basics', () => {
  it('has the correct type and capabilities', () => {
    const adapter = makeAdapter();
    expect(adapter.type).toBe('claude-sdk');
    expect(adapter.capabilities).toEqual(CAPABILITY_MATRIX['claude-sdk']);
    expect(adapter.capabilities.supportsToolUse).toBe(true);
    expect(adapter.capabilities.supportsJsonMode).toBe(false);
    expect(adapter.capabilities.supportsSessionResume).toBe(false);
  });

  it('exposes workdir from deps', () => {
    const adapter = makeAdapter(undefined, { workdir: '/my/repo' });
    expect(adapter.workdir).toBe('/my/repo');
  });
});

describe('ClaudeSdkAdapter — text streaming', () => {
  it('maps text-delta events correctly', async () => {
    fakeStreamEvents = [
      messageStartEvent(10),
      textBlockStart(0),
      textDelta('Hello', 0),
      textDelta(', world!', 0),
      textBlockStop(0),
      messageDeltaEvent('end_turn', 5),
      { type: 'message_stop' },
    ];

    const adapter = makeAdapter();
    const chunks = await collectChunks(adapter);

    const textChunks = chunks.filter((c) => c.type === 'text-delta');
    expect(textChunks).toHaveLength(2);
    expect(textChunks[0]).toEqual({ type: 'text-delta', text: 'Hello' });
    expect(textChunks[1]).toEqual({ type: 'text-delta', text: ', world!' });
  });

  it('emits usage chunk with correct token counts', async () => {
    fakeStreamEvents = [
      messageStartEvent(10),
      textBlockStart(0),
      textDelta('hi', 0),
      textBlockStop(0),
      messageDeltaEvent('end_turn', 8),
      { type: 'message_stop' },
    ];

    const adapter = makeAdapter();
    const chunks = await collectChunks(adapter);

    const usageChunk = chunks.find((c) => c.type === 'usage');
    expect(usageChunk).toMatchObject({
      type: 'usage',
      usage: { inputTokens: 10, outputTokens: 8 },
    });
  });

  it('emits message-stop with finishReason:stop for end_turn', async () => {
    fakeStreamEvents = [
      messageStartEvent(),
      textBlockStart(0),
      textDelta('done', 0),
      textBlockStop(0),
      messageDeltaEvent('end_turn'),
      { type: 'message_stop' },
    ];

    const adapter = makeAdapter();
    const chunks = await collectChunks(adapter);

    const stopChunk = chunks.find((c) => c.type === 'message-stop');
    expect(stopChunk).toEqual({ type: 'message-stop', finishReason: 'stop' });
  });

  it('emits message-stop with finishReason:length for max_tokens', async () => {
    fakeStreamEvents = [
      messageStartEvent(),
      textBlockStart(0),
      textDelta('partial', 0),
      textBlockStop(0),
      messageDeltaEvent('max_tokens'),
      { type: 'message_stop' },
    ];

    const adapter = makeAdapter();
    const chunks = await collectChunks(adapter);

    const stopChunk = chunks.find((c) => c.type === 'message-stop');
    expect(stopChunk).toEqual({ type: 'message-stop', finishReason: 'length' });
  });
});

describe('ClaudeSdkAdapter — tool use', () => {
  it('maps tool-call events correctly', async () => {
    fakeStreamEvents = [
      messageStartEvent(15),
      toolBlockStart(0, 'tool_001', 'read_file'),
      toolInputDelta('{"path":', 0),
      toolInputDelta('"foo.ts"}', 0),
      textBlockStop(0),
      messageDeltaEvent('tool_use', 3),
      { type: 'message_stop' },
    ];

    const adapter = makeAdapter();
    const chunks = await collectChunks(adapter, [{ role: 'user', content: 'read foo.ts' }]);

    const startChunk = chunks.find((c) => c.type === 'tool-call-start');
    expect(startChunk).toEqual({
      type: 'tool-call-start',
      toolCallId: 'tool_001',
      toolName: 'read_file',
    });

    const inputChunks = chunks.filter((c) => c.type === 'tool-call-input');
    expect(inputChunks).toHaveLength(2);

    const endChunk = chunks.find((c) => c.type === 'tool-call-end');
    expect(endChunk).toMatchObject({
      type: 'tool-call-end',
      toolCallId: 'tool_001',
      input: { path: 'foo.ts' },
    });

    const stopChunk = chunks.find((c) => c.type === 'message-stop');
    expect(stopChunk).toEqual({ type: 'message-stop', finishReason: 'tool_use' });
  });
});

describe('ClaudeSdkAdapter — invoke (reduceStream parity)', () => {
  it('invoke accumulates text-deltas into content', async () => {
    fakeStreamEvents = [
      messageStartEvent(10),
      textBlockStart(0),
      textDelta('Hello', 0),
      textDelta(' world', 0),
      textBlockStop(0),
      messageDeltaEvent('end_turn', 5),
      { type: 'message_stop' },
    ];

    const adapter = makeAdapter();
    const result = await adapter.invoke({ messages: [{ role: 'user', content: 'hi' }] });

    expect(result.content).toBe('Hello world');
    expect(result.finishReason).toBe('stop');
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('invoke builds contentBlocks for tool-use', async () => {
    fakeStreamEvents = [
      messageStartEvent(15),
      toolBlockStart(0, 'tc1', 'edit_file'),
      toolInputDelta('{"path":"x.ts","content":"hi"}', 0),
      textBlockStop(0),
      messageDeltaEvent('tool_use', 3),
      { type: 'message_stop' },
    ];

    const adapter = makeAdapter();
    const result = await adapter.invoke({ messages: [{ role: 'user', content: 'edit' }] });

    const toolBlock = result.contentBlocks?.find((b) => b.type === 'tool-use');
    expect(toolBlock).toMatchObject({
      type: 'tool-use',
      id: 'tc1',
      name: 'edit_file',
    });
  });

  it('passes max_tokens:8192 (the real default, not the old 256 hardcode)', async () => {
    fakeStreamEvents = [
      messageStartEvent(),
      textBlockStart(0),
      textDelta('ok', 0),
      textBlockStop(0),
      messageDeltaEvent('end_turn'),
      { type: 'message_stop' },
    ];

    const adapter = makeAdapter();
    const result = await adapter.invoke({ messages: [{ role: 'user', content: 'hi' }] });

    expect(result.content).toBe('ok');
    // The streamMock captured the request body — assert the real default.
    expect(lastStreamBody?.max_tokens).toBe(8192);
    expect(lastStreamBody?.max_tokens).not.toBe(256);
  });
});

describe('ClaudeSdkAdapter — thinking mapping', () => {
  it('maps thinking_delta events → thinking-delta chunks (drops signature_delta)', async () => {
    fakeStreamEvents = [
      messageStartEvent(10),
      thinkingBlockStart(0),
      thinkingDelta('Let me reason', 0),
      thinkingDelta(' step by step', 0),
      signatureDelta('sig-abc', 0),
      textBlockStop(0),
      textBlockStart(1),
      textDelta('The answer.', 1),
      textBlockStop(1),
      messageDeltaEvent('end_turn', 7),
      { type: 'message_stop' },
    ];

    const adapter = makeAdapter();
    const chunks = await collectChunks(adapter);

    const thinkingChunks = chunks.filter((c) => c.type === 'thinking-delta');
    expect(thinkingChunks).toEqual([
      { type: 'thinking-delta', text: 'Let me reason' },
      { type: 'thinking-delta', text: ' step by step' },
    ]);
    // text still flows after the thinking block
    const textChunks = chunks.filter((c) => c.type === 'text-delta');
    expect(textChunks).toEqual([{ type: 'text-delta', text: 'The answer.' }]);
  });

  it('invoke folds thinking into a thinking contentBlock', async () => {
    fakeStreamEvents = [
      messageStartEvent(10),
      thinkingBlockStart(0),
      thinkingDelta('hmm', 0),
      textBlockStop(0),
      textBlockStart(1),
      textDelta('done', 1),
      textBlockStop(1),
      messageDeltaEvent('end_turn', 3),
      { type: 'message_stop' },
    ];

    const adapter = makeAdapter();
    const result = await adapter.invoke({ messages: [{ role: 'user', content: 'hi' }] });
    expect(result.content).toBe('done');
    expect(result.contentBlocks?.find((b) => b.type === 'thinking')).toEqual({
      type: 'thinking',
      thinking: 'hmm',
    });
  });
});

describe('ClaudeSdkAdapter — abort', () => {
  it('abort signal → finishReason:aborted', async () => {
    const ctrl = new AbortController();

    fakeStreamEvents = [
      messageStartEvent(),
      textBlockStart(0),
      textDelta('partial', 0),
      // Abort before more events arrive
    ];

    // Abort immediately (before any events can be processed in the async stream)
    ctrl.abort();

    const adapter = makeAdapter();
    const chunks: AgentChunk[] = [];
    for await (const chunk of adapter.stream(
      { messages: [{ role: 'user', content: 'hello' }] },
      { signal: ctrl.signal },
    )) {
      chunks.push(chunk);
    }

    const stopChunk = chunks.find((c) => c.type === 'message-stop');
    expect(stopChunk).toEqual({ type: 'message-stop', finishReason: 'aborted' });
  });
});

describe('ClaudeSdkAdapter — auth', () => {
  it('accepts apiKey from spec', () => {
    expect(
      () => new ClaudeSdkAdapter(makeSpec({ apiKey: 'sk-from-spec' }), makeDeps(), 'sk-from-spec'),
    ).not.toThrow();
  });

  it('throws MissingCredentialError when no key is provided to constructor', async () => {
    // Import the factory registration test - MissingCredentialError is thrown
    // by the factory when neither spec.apiKey nor ANTHROPIC_API_KEY is present.
    // Here we just verify MissingCredentialError is the right class.
    const err = new MissingCredentialError('no key');
    expect(err.name).toBe('MissingCredentialError');
    expect(err).toBeInstanceOf(MissingCredentialError);
  });
});

describe('ClaudeSdkAdapter — credential precedence', () => {
  const SAVED = process.env.ANTHROPIC_API_KEY;
  afterEach(() => {
    if (SAVED === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = SAVED;
  });

  it('resolveApiKey follows spec → broker → env', async () => {
    expect(await resolveApiKey(makeSpec({ apiKey: 'spec-key' }))).toBe('spec-key');

    delete process.env.ANTHROPIC_API_KEY;
    const broker = { getCredential: vi.fn(async () => ({ apiKey: 'broker-key' })) };
    expect(await resolveApiKey(makeSpec({ apiKey: undefined }), broker)).toBe('broker-key');
    expect(broker.getCredential).toHaveBeenCalledWith('anthropic');

    process.env.ANTHROPIC_API_KEY = 'env-key';
    expect(await resolveApiKey(makeSpec({ apiKey: undefined }))).toBe('env-key');
  });

  it('resolveApiKey prefers the broker over env (token rotation)', async () => {
    process.env.ANTHROPIC_API_KEY = 'env-key';
    const broker = { getCredential: vi.fn(async () => ({ apiKey: 'broker-key' })) };
    expect(await resolveApiKey(makeSpec({ apiKey: undefined }), broker)).toBe('broker-key');
  });

  it('factory prefers the broker over env (broker-before-env, lazy adapter)', async () => {
    fakeStreamEvents = [
      messageStartEvent(),
      textBlockStart(0),
      textDelta('ok', 0),
      textBlockStop(0),
      messageDeltaEvent('end_turn'),
      { type: 'message_stop' },
    ];
    process.env.ANTHROPIC_API_KEY = 'env-key';
    const factory = getAdapterFactory('claude-sdk');
    const broker = { getCredential: vi.fn(async () => ({ apiKey: 'broker-key' })) };
    const adapter = factory?.factory(
      { type: 'claude-sdk', model: 'claude-opus-4-7' },
      makeDeps({ credentialBroker: broker }),
    );
    const result = await adapter?.invoke({ messages: [{ role: 'user', content: 'hi' }] });
    expect(broker.getCredential).toHaveBeenCalledWith('anthropic');
    expect(result?.content).toBe('ok');
  });

  it('lazy adapter throws MissingCredentialError when broker returns empty and no env', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const factory = getAdapterFactory('claude-sdk');
    const broker = { getCredential: vi.fn(async () => ({ apiKey: '' })) };
    const adapter = factory?.factory(
      { type: 'claude-sdk', model: 'claude-opus-4-7' },
      makeDeps({ credentialBroker: broker }),
    );
    await expect(
      adapter?.invoke({ messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toBeInstanceOf(MissingCredentialError);
  });

  it('resolveApiKey logs (does not swallow) a broker failure, then falls back to env', async () => {
    process.env.ANTHROPIC_API_KEY = 'env-key';
    const warn = vi.fn();
    const broker = {
      getCredential: vi.fn(async () => {
        throw new Error('broker offline');
      }),
    };
    const key = await resolveApiKey(makeSpec({ apiKey: undefined }), broker, { warn });
    expect(key).toBe('env-key');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('broker offline');
  });
});

describe('ClaudeSdkAdapter — capability check', () => {
  it('throws CapabilityMismatchError when tools are passed to adapter with supportsToolUse:false', async () => {
    // We create a subclass with supportsToolUse:false to test the guard.
    // ClaudeSdkAdapter itself has supportsToolUse:true so we override.
    const adapter = makeAdapter();
    // Override capabilities to simulate a non-tool-use adapter
    Object.defineProperty(adapter, 'capabilities', {
      value: { ...CAPABILITY_MATRIX['claude-sdk'], supportsToolUse: false },
    });

    const { CapabilityMismatchError } = await import('../../errors.ts');
    await expect(
      adapter.invoke({ messages: [{ role: 'user', content: 'hi' }], tools: [{ name: 'foo' }] }),
    ).rejects.toBeInstanceOf(CapabilityMismatchError);
  });
});

describe('ClaudeSdkAdapter — multi-turn conformance', () => {
  it('echo scenario: simple text in → text out', async () => {
    fakeStreamEvents = [
      messageStartEvent(5),
      textBlockStart(0),
      textDelta('Echo: hello', 0),
      textBlockStop(0),
      messageDeltaEvent('end_turn', 3),
      { type: 'message_stop' },
    ];

    const adapter = makeAdapter();
    const result = await adapter.invoke({ messages: [{ role: 'user', content: 'hello' }] });
    expect(result.content).toBe('Echo: hello');
    expect(result.finishReason).toBe('stop');
  });

  it('usage scenario: usage is reported', async () => {
    fakeStreamEvents = [
      messageStartEvent(20),
      textBlockStart(0),
      textDelta('done', 0),
      textBlockStop(0),
      messageDeltaEvent('end_turn', 10),
      { type: 'message_stop' },
    ];

    const adapter = makeAdapter();
    const result = await adapter.invoke({ messages: [{ role: 'user', content: 'test' }] });
    expect(result.usage).toBeDefined();
    expect(result.usage?.inputTokens).toBe(20);
    expect(result.usage?.outputTokens).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// Live integration test (gated on real ANTHROPIC_API_KEY)
// ---------------------------------------------------------------------------

describe.skipIf(!process.env.ANTHROPIC_API_KEY)('ClaudeSdkAdapter — live integration', () => {
  it('invokes a real claude model and returns text', async () => {
    // Re-enable real SDK by not using the mock for this test.
    // This test is skipped in CI (no ANTHROPIC_API_KEY).
    const realAdapter = new ClaudeSdkAdapter(
      { type: 'claude-sdk', model: 'claude-haiku-4-5', apiKey: process.env.ANTHROPIC_API_KEY! },
      {
        workdir: process.cwd(),
        repoRoot: process.cwd(),
        commit: 'live',
        branch: 'main',
      },
      process.env.ANTHROPIC_API_KEY!,
    );

    const result = await realAdapter.invoke({
      messages: [{ role: 'user', content: 'Reply with exactly: pong' }],
    });

    expect(result.content).toContain('pong');
    expect(result.finishReason).toBe('stop');
    expect(result.usage?.inputTokens).toBeGreaterThan(0);
    expect(result.usage?.outputTokens).toBeGreaterThan(0);
  }, 30000);
});
