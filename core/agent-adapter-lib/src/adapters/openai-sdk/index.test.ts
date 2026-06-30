/**
 * OpenAiSdkAdapter unit tests.
 *
 * Mocks `openai` so no real API calls are made. Covers: AgentChunk mapping
 * (delta.content / tool_calls deltas / usage / finish_reason), invoke=reduceStream
 * parity, broker apiKey resolution, missing cred → MissingCredentialError, abort,
 * tool-call surfacing (host-loop), and HTTP error classification.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OpenAiSdkSpec } from '../../agent.ts';
import { CAPABILITY_MATRIX } from '../../capabilities.ts';
import { AuthError, MissingCredentialError } from '../../errors.ts';
import type { AdapterDeps } from '../../registry.ts';
import { getAdapterFactory } from '../../registry.ts';
import type { AgentChunk } from '../../stream.ts';
import { OpenAiSdkAdapter, resolveApiKey } from './index.ts';

// ---------------------------------------------------------------------------
// Mock `openai`
// ---------------------------------------------------------------------------

let fakeChunks: Array<Record<string, unknown>> = [];
let createError: unknown;
let lastBody: Record<string, unknown> | undefined;
let lastOptions: { signal?: AbortSignal } | undefined;

vi.mock('openai', () => {
  class APIError extends Error {
    status: number;
    headers: Headers | undefined;
    error: unknown;
    constructor(status: number, error: unknown, message: string) {
      super(message);
      this.name = 'APIError';
      this.status = status;
      this.error = error;
      this.headers = undefined;
    }
  }
  class APIUserAbortError extends APIError {
    constructor() {
      super(0, undefined, 'Request was aborted.');
      this.name = 'APIUserAbortError';
    }
  }

  async function* makeStream(opts?: {
    signal?: AbortSignal;
  }): AsyncGenerator<Record<string, unknown>> {
    for (const chunk of fakeChunks) {
      if (opts?.signal?.aborted) {
        throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      }
      yield chunk;
    }
  }

  class OpenAI {
    static APIError = APIError;
    static APIUserAbortError = APIUserAbortError;

    chat = {
      completions: {
        create: vi.fn(async (body: Record<string, unknown>, options?: { signal?: AbortSignal }) => {
          lastBody = body;
          lastOptions = options;
          if (createError) throw createError;
          return makeStream(options);
        }),
      },
    };
    constructor(public opts: { apiKey?: string }) {}
  }

  return { default: OpenAI, APIError, APIUserAbortError };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSpec(over?: Partial<OpenAiSdkSpec>): OpenAiSdkSpec {
  return { type: 'openai-sdk', model: 'gpt-4o', apiKey: 'sk-test', ...over };
}

function makeDeps(over?: Partial<AdapterDeps>): AdapterDeps {
  return { workdir: '/work/dir', repoRoot: '/work/dir', commit: 'abc', branch: 'main', ...over };
}

function makeAdapter(spec?: Partial<OpenAiSdkSpec>, deps?: Partial<AdapterDeps>) {
  return new OpenAiSdkAdapter(makeSpec(spec), makeDeps(deps), 'sk-test');
}

async function collect(stream: AsyncIterable<AgentChunk>): Promise<AgentChunk[]> {
  const out: AgentChunk[] = [];
  for await (const c of stream) out.push(c);
  return out;
}

function textChunk(content: string, finishReason: string | null = null): Record<string, unknown> {
  return { choices: [{ delta: { content }, finish_reason: finishReason }] };
}

function usageChunk(prompt = 3, completion = 2): Record<string, unknown> {
  return { choices: [], usage: { prompt_tokens: prompt, completion_tokens: completion } };
}

let savedKey: string | undefined;
beforeEach(() => {
  fakeChunks = [];
  createError = undefined;
  lastBody = undefined;
  lastOptions = undefined;
  savedKey = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
});
afterEach(() => {
  if (savedKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = savedKey;
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Basics
// ---------------------------------------------------------------------------

describe('OpenAiSdkAdapter — basics', () => {
  it('reports the openai-sdk capability matrix (supportsJsonMode: true)', () => {
    const adapter = makeAdapter();
    expect(adapter.type).toBe('openai-sdk');
    expect(adapter.capabilities).toEqual(CAPABILITY_MATRIX['openai-sdk']);
    expect(adapter.capabilities.supportsToolUse).toBe(true);
    expect(adapter.capabilities.supportsJsonMode).toBe(true);
    expect(adapter.capabilities.reportsUsage).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Streaming + parity
// ---------------------------------------------------------------------------

describe('OpenAiSdkAdapter — streaming + parity', () => {
  it('maps deltas to AgentChunks (text, usage, message-stop)', async () => {
    fakeChunks = [textChunk('po'), textChunk('ng', 'stop'), usageChunk(3, 2)];
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
    fakeChunks = [textChunk('po'), textChunk('ng', 'stop'), usageChunk(3, 2)];
    const result = await makeAdapter().invoke({ messages: [{ role: 'user', content: 'ping' }] });
    expect(result.content).toBe('pong');
    expect(result.finishReason).toBe('stop');
    expect(result.usage).toEqual({ inputTokens: 3, outputTokens: 2 });
  });

  it('sends stream:true + include_usage and the normalized body', async () => {
    fakeChunks = [textChunk('ok', 'stop')];
    await collect(
      makeAdapter({ model: 'gpt-4.1' }).stream({
        messages: [{ role: 'user', content: 'hi' }],
        systemPrompt: 'sys',
      }),
    );
    expect(lastBody?.model).toBe('gpt-4.1');
    expect(lastBody?.stream).toBe(true);
    expect(lastBody?.stream_options).toEqual({ include_usage: true });
    expect(lastBody?.messages).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hi' },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Tool use (host-loop)
// ---------------------------------------------------------------------------

describe('OpenAiSdkAdapter — tool use', () => {
  it('surfaces tool_calls deltas as tool-call-* chunks', async () => {
    fakeChunks = [
      {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call_1',
                  type: 'function',
                  function: { name: 'f', arguments: '' },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"a":1}' } }] } }] },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
      usageChunk(5, 1),
    ];
    const chunks = await collect(
      makeAdapter().stream({
        messages: [{ role: 'user', content: 'go' }],
        tools: [{ name: 'f' }],
      }),
    );
    expect(chunks).toContainEqual({ type: 'tool-call-start', toolCallId: 'call_1', toolName: 'f' });
    expect(chunks).toContainEqual({
      type: 'tool-call-input',
      toolCallId: 'call_1',
      partialInput: '{"a":1}',
    });
    expect(chunks).toContainEqual({ type: 'tool-call-end', toolCallId: 'call_1', input: { a: 1 } });
    expect(chunks.at(-1)).toEqual({ type: 'message-stop', finishReason: 'tool_use' });

    // tools forwarded
    expect((lastBody?.tools as Array<{ function: { name: string } }>)[0]?.function.name).toBe('f');
  });
});

// ---------------------------------------------------------------------------
// Errors + abort
// ---------------------------------------------------------------------------

describe('OpenAiSdkAdapter — errors + abort', () => {
  it('classifies an APIError (401 → AuthError) as an error chunk', async () => {
    const { APIError } = (await import('openai')) as unknown as {
      APIError: new (s: number, e: unknown, m: string) => Error;
    };
    createError = new APIError(401, { message: 'invalid_api_key' }, 'Unauthorized');
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
    fakeChunks = [textChunk('partial')];
    const chunks = await collect(
      makeAdapter().stream({ messages: [{ role: 'user', content: 'x' }] }, { signal: ctrl.signal }),
    );
    expect(chunks.at(-1)).toEqual({ type: 'message-stop', finishReason: 'aborted' });
    expect(lastOptions?.signal).toBe(ctrl.signal);
  });
});

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

describe('OpenAiSdkAdapter — auth', () => {
  it('resolveApiKey prefers spec.apiKey, then broker, then env', async () => {
    expect(await resolveApiKey(makeSpec({ apiKey: 'spec' }))).toBe('spec');

    const broker = { getCredential: vi.fn(async () => ({ apiKey: 'broker' })) };
    expect(await resolveApiKey(makeSpec({ apiKey: undefined }), broker)).toBe('broker');
    expect(broker.getCredential).toHaveBeenCalledWith('openai');

    process.env.OPENAI_API_KEY = 'env';
    expect(await resolveApiKey(makeSpec({ apiKey: undefined }))).toBe('env');
  });

  it('throws MissingCredentialError when nothing resolves', async () => {
    await expect(resolveApiKey(makeSpec({ apiKey: undefined }))).rejects.toBeInstanceOf(
      MissingCredentialError,
    );
  });

  it('factory throws MissingCredentialError when no key and no broker', () => {
    const factory = getAdapterFactory('openai-sdk');
    expect(factory).toBeDefined();
    expect(() => factory?.factory({ type: 'openai-sdk', model: 'gpt-4o' }, makeDeps())).toThrow(
      MissingCredentialError,
    );
  });

  it('factory uses the broker-resolved key (lazy adapter)', async () => {
    fakeChunks = [textChunk('ok', 'stop')];
    const factory = getAdapterFactory('openai-sdk');
    const broker = { getCredential: vi.fn(async () => ({ apiKey: 'broker-key' })) };
    const adapter = factory?.factory(
      { type: 'openai-sdk', model: 'gpt-4o' },
      makeDeps({ credentialBroker: broker }),
    );
    const result = await adapter?.invoke({ messages: [{ role: 'user', content: 'hi' }] });
    expect(broker.getCredential).toHaveBeenCalledWith('openai');
    expect(result?.content).toBe('ok');
  });
});

// ---------------------------------------------------------------------------
// Live integration (gated on a real OPENAI_API_KEY)
// ---------------------------------------------------------------------------

describe.skipIf(!process.env.OPENAI_API_KEY)('OpenAiSdkAdapter — live integration', () => {
  it('invokes a real openai model and returns text', async () => {
    const key = process.env.OPENAI_API_KEY as string;
    const adapter = new OpenAiSdkAdapter(
      { type: 'openai-sdk', model: 'gpt-4o-mini', apiKey: key },
      makeDeps(),
      key,
    );
    const result = await adapter.invoke({
      messages: [{ role: 'user', content: 'Reply with exactly: pong' }],
    });
    expect(result.content.toLowerCase()).toContain('pong');
  }, 30000);
});
