/**
 * GeminiSdkAdapter unit tests.
 *
 * Mocks @google/genai so no real API calls are made. Covers: AgentChunk
 * mapping (text / functionCall / usage / finish), invoke=reduceStream parity,
 * broker apiKey resolution, missing cred → MissingCredentialError, abort, and
 * tool-call surfacing (host-loop).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GeminiSdkSpec } from '../../agent.ts';
import { CAPABILITY_MATRIX } from '../../capabilities.ts';
import { MissingCredentialError } from '../../errors.ts';
import type { AdapterDeps } from '../../registry.ts';
import { getAdapterFactory } from '../../registry.ts';
import type { AgentChunk } from '../../stream.ts';
import { GeminiSdkAdapter, resolveApiKey } from './index.ts';

// ---------------------------------------------------------------------------
// Mock @google/genai
// ---------------------------------------------------------------------------

let fakeChunks: Array<Record<string, unknown>> = [];
let lastParams: Record<string, unknown> | undefined;

vi.mock('@google/genai', () => {
  class ApiError extends Error {
    status = 500;
  }

  async function* makeStream(config?: {
    abortSignal?: AbortSignal;
  }): AsyncGenerator<Record<string, unknown>> {
    for (const chunk of fakeChunks) {
      if (config?.abortSignal?.aborted) {
        throw Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' });
      }
      yield chunk;
    }
  }

  class GoogleGenAI {
    models = {
      generateContentStream: vi.fn(async (params: Record<string, unknown>) => {
        lastParams = params;
        return makeStream(params.config as { abortSignal?: AbortSignal });
      }),
    };
    constructor(public opts: { apiKey?: string }) {}
  }

  return { GoogleGenAI, ApiError };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSpec(over?: Partial<GeminiSdkSpec>): GeminiSdkSpec {
  return { type: 'gemini-sdk', model: 'gemini-2.0-flash', apiKey: 'test-key', ...over };
}

function makeDeps(over?: Partial<AdapterDeps>): AdapterDeps {
  return { workdir: '/work/dir', repoRoot: '/work/dir', commit: 'abc', branch: 'main', ...over };
}

function makeAdapter(spec?: Partial<GeminiSdkSpec>, deps?: Partial<AdapterDeps>) {
  return new GeminiSdkAdapter(makeSpec(spec), makeDeps(deps), 'test-key');
}

async function collect(stream: AsyncIterable<AgentChunk>): Promise<AgentChunk[]> {
  const out: AgentChunk[] = [];
  for await (const c of stream) out.push(c);
  return out;
}

function textChunk(text: string): Record<string, unknown> {
  return { candidates: [{ content: { parts: [{ text }] } }] };
}

function finalChunk(
  finishReason = 'STOP',
  promptTokenCount = 10,
  candidatesTokenCount = 5,
): Record<string, unknown> {
  return {
    candidates: [{ content: { parts: [] }, finishReason }],
    usageMetadata: { promptTokenCount, candidatesTokenCount },
  };
}

let savedGemini: string | undefined;
let savedGoogle: string | undefined;
beforeEach(() => {
  fakeChunks = [];
  lastParams = undefined;
  savedGemini = process.env.GEMINI_API_KEY;
  savedGoogle = process.env.GOOGLE_API_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.GOOGLE_API_KEY;
});
afterEach(() => {
  if (savedGemini === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = savedGemini;
  if (savedGoogle === undefined) delete process.env.GOOGLE_API_KEY;
  else process.env.GOOGLE_API_KEY = savedGoogle;
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Basics
// ---------------------------------------------------------------------------

describe('GeminiSdkAdapter — basics', () => {
  it('reports the gemini-sdk capability matrix (supportsJsonMode: true)', () => {
    const adapter = makeAdapter();
    expect(adapter.type).toBe('gemini-sdk');
    expect(adapter.capabilities).toEqual(CAPABILITY_MATRIX['gemini-sdk']);
    expect(adapter.capabilities.supportsToolUse).toBe(true);
    expect(adapter.capabilities.supportsJsonMode).toBe(true);
    expect(adapter.capabilities.reportsUsage).toBe(true);
  });

  it('exposes workdir from deps', () => {
    expect(makeAdapter(undefined, { workdir: '/my/repo' }).workdir).toBe('/my/repo');
  });
});

// ---------------------------------------------------------------------------
// Text streaming + usage + finish
// ---------------------------------------------------------------------------

describe('GeminiSdkAdapter — text streaming', () => {
  it('maps text parts to text-delta and surfaces usage + message-stop', async () => {
    fakeChunks = [textChunk('Hello'), textChunk(', world!'), finalChunk('STOP', 10, 5)];
    const chunks = await collect(
      makeAdapter().stream({ messages: [{ role: 'user', content: 'hi' }] }),
    );
    expect(chunks).toEqual<AgentChunk[]>([
      { type: 'text-delta', text: 'Hello' },
      { type: 'text-delta', text: ', world!' },
      { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } },
      { type: 'message-stop', finishReason: 'stop' },
    ]);
  });

  it('maps MAX_TOKENS to finishReason length', async () => {
    fakeChunks = [textChunk('partial'), finalChunk('MAX_TOKENS', 4, 8)];
    const chunks = await collect(
      makeAdapter().stream({ messages: [{ role: 'user', content: 'hi' }] }),
    );
    expect(chunks.at(-1)).toEqual({ type: 'message-stop', finishReason: 'length' });
  });

  it('forwards model + systemInstruction to the SDK', async () => {
    fakeChunks = [textChunk('ok'), finalChunk()];
    await collect(
      makeAdapter({ model: 'gemini-2.5-pro' }).stream({
        messages: [{ role: 'user', content: 'hi' }],
        systemPrompt: 'be terse',
      }),
    );
    expect(lastParams?.model).toBe('gemini-2.5-pro');
    expect((lastParams?.config as { systemInstruction?: string }).systemInstruction).toBe(
      'be terse',
    );
  });
});

// ---------------------------------------------------------------------------
// invoke (reduceStream parity)
// ---------------------------------------------------------------------------

describe('GeminiSdkAdapter — invoke parity', () => {
  it('reduces the stream into content + usage + finishReason', async () => {
    fakeChunks = [textChunk('Echo: '), textChunk('hello'), finalChunk('STOP', 7, 3)];
    const result = await makeAdapter().invoke({ messages: [{ role: 'user', content: 'hello' }] });
    expect(result.content).toBe('Echo: hello');
    expect(result.finishReason).toBe('stop');
    expect(result.usage).toEqual({ inputTokens: 7, outputTokens: 3 });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// Tool use (host-loop)
// ---------------------------------------------------------------------------

describe('GeminiSdkAdapter — tool use', () => {
  it('surfaces functionCall parts as tool-call-* chunks and finishReason tool_use', async () => {
    fakeChunks = [
      {
        candidates: [
          {
            content: { parts: [{ functionCall: { name: 'read_file', args: { path: 'foo.ts' } } }] },
          },
        ],
      },
      finalChunk('STOP', 15, 3),
    ];
    const chunks = await collect(
      makeAdapter().stream({
        messages: [{ role: 'user', content: 'read foo.ts' }],
        tools: [{ name: 'read_file' }],
      }),
    );
    const start = chunks.find((c) => c.type === 'tool-call-start');
    expect(start).toMatchObject({ type: 'tool-call-start', toolName: 'read_file' });
    const end = chunks.find((c) => c.type === 'tool-call-end');
    expect(end).toMatchObject({ type: 'tool-call-end', input: { path: 'foo.ts' } });
    expect(chunks.at(-1)).toEqual({ type: 'message-stop', finishReason: 'tool_use' });

    // tools forwarded as functionDeclarations
    const tools = (lastParams?.config as { tools?: unknown[] }).tools;
    expect(tools).toEqual([
      { functionDeclarations: [expect.objectContaining({ name: 'read_file' })] },
    ]);
  });

  it('invoke builds a tool-use contentBlock', async () => {
    fakeChunks = [
      {
        candidates: [
          { content: { parts: [{ functionCall: { id: 'fc1', name: 'edit', args: { x: 1 } } }] } },
        ],
      },
      finalChunk('STOP'),
    ];
    const result = await makeAdapter().invoke({
      messages: [{ role: 'user', content: 'edit' }],
      tools: [{ name: 'edit' }],
    });
    expect(result.contentBlocks?.find((b) => b.type === 'tool-use')).toMatchObject({
      type: 'tool-use',
      id: 'fc1',
      name: 'edit',
      input: { x: 1 },
    });
  });
});

// ---------------------------------------------------------------------------
// toolChoice → toolConfig.functionCallingConfig
// ---------------------------------------------------------------------------

describe('GeminiSdkAdapter — toolChoice', () => {
  function toolConfigOf(): unknown {
    return (lastParams?.config as { toolConfig?: unknown }).toolConfig;
  }

  it("maps 'auto' → functionCallingConfig mode AUTO", async () => {
    fakeChunks = [textChunk('ok'), finalChunk()];
    await collect(
      makeAdapter().stream({ messages: [{ role: 'user', content: 'hi' }], toolChoice: 'auto' }),
    );
    expect(toolConfigOf()).toEqual({ functionCallingConfig: { mode: 'AUTO' } });
  });

  it("maps 'none' → functionCallingConfig mode NONE", async () => {
    fakeChunks = [textChunk('ok'), finalChunk()];
    await collect(
      makeAdapter().stream({ messages: [{ role: 'user', content: 'hi' }], toolChoice: 'none' }),
    );
    expect(toolConfigOf()).toEqual({ functionCallingConfig: { mode: 'NONE' } });
  });

  it('maps a named toolChoice → mode ANY + allowedFunctionNames', async () => {
    fakeChunks = [textChunk('ok'), finalChunk()];
    await collect(
      makeAdapter().stream({
        messages: [{ role: 'user', content: 'hi' }],
        tools: [{ name: 'read_file' }],
        toolChoice: { name: 'read_file' },
      }),
    );
    expect(toolConfigOf()).toEqual({
      functionCallingConfig: { mode: 'ANY', allowedFunctionNames: ['read_file'] },
    });
  });

  it('omits toolConfig when no toolChoice is given', async () => {
    fakeChunks = [textChunk('ok'), finalChunk()];
    await collect(makeAdapter().stream({ messages: [{ role: 'user', content: 'hi' }] }));
    expect(toolConfigOf()).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Abort
// ---------------------------------------------------------------------------

describe('GeminiSdkAdapter — abort', () => {
  it('ends with finishReason aborted when the signal is aborted', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    fakeChunks = [textChunk('partial'), finalChunk()];
    const chunks = await collect(
      makeAdapter().stream(
        { messages: [{ role: 'user', content: 'hi' }] },
        { signal: ctrl.signal },
      ),
    );
    expect(chunks.at(-1)).toEqual({ type: 'message-stop', finishReason: 'aborted' });
  });
});

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

describe('GeminiSdkAdapter — auth', () => {
  it('resolveApiKey prefers spec.apiKey, then broker, then env', async () => {
    expect(await resolveApiKey(makeSpec({ apiKey: 'spec-key' }))).toBe('spec-key');

    const broker = { getCredential: vi.fn(async () => ({ apiKey: 'broker-key' })) };
    expect(await resolveApiKey(makeSpec({ apiKey: undefined }), broker)).toBe('broker-key');
    expect(broker.getCredential).toHaveBeenCalledWith('google');

    process.env.GEMINI_API_KEY = 'env-key';
    expect(await resolveApiKey(makeSpec({ apiKey: undefined }))).toBe('env-key');
  });

  it('falls back to GOOGLE_API_KEY', async () => {
    process.env.GOOGLE_API_KEY = 'google-env';
    expect(await resolveApiKey(makeSpec({ apiKey: undefined }))).toBe('google-env');
  });

  it('throws MissingCredentialError when nothing resolves', async () => {
    await expect(resolveApiKey(makeSpec({ apiKey: undefined }))).rejects.toBeInstanceOf(
      MissingCredentialError,
    );
  });

  it('factory throws MissingCredentialError when no key and no broker', () => {
    const factory = getAdapterFactory('gemini-sdk');
    expect(factory).toBeDefined();
    expect(() =>
      factory?.factory({ type: 'gemini-sdk', model: 'gemini-2.0-flash' }, makeDeps()),
    ).toThrow(MissingCredentialError);
  });

  it('factory uses the broker-resolved key (lazy adapter)', async () => {
    fakeChunks = [textChunk('ok'), finalChunk()];
    const factory = getAdapterFactory('gemini-sdk');
    const broker = { getCredential: vi.fn(async () => ({ apiKey: 'broker-key' })) };
    const adapter = factory?.factory(
      { type: 'gemini-sdk', model: 'gemini-2.0-flash' },
      makeDeps({ credentialBroker: broker }),
    );
    const result = await adapter?.invoke({ messages: [{ role: 'user', content: 'hi' }] });
    expect(broker.getCredential).toHaveBeenCalledWith('google');
    expect(result?.content).toBe('ok');
  });
});

// ---------------------------------------------------------------------------
// Live integration (gated on a real GEMINI_API_KEY)
// ---------------------------------------------------------------------------

describe.skipIf(!process.env.GEMINI_API_KEY && !process.env.GOOGLE_API_KEY)(
  'GeminiSdkAdapter — live integration',
  () => {
    it('invokes a real gemini model and returns text', async () => {
      const key = (process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY) as string;
      const adapter = new GeminiSdkAdapter(
        { type: 'gemini-sdk', model: 'gemini-2.0-flash', apiKey: key },
        makeDeps(),
        key,
      );
      const result = await adapter.invoke({
        messages: [{ role: 'user', content: 'Reply with exactly: pong' }],
      });
      expect(result.content.toLowerCase()).toContain('pong');
    }, 30000);
  },
);
