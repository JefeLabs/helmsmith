/**
 * CopilotSdkAdapter unit tests.
 *
 * All HTTP is stubbed via `fetchFn` injection (or vi.stubGlobal for the factory
 * broker path) — no network. Covers: request URL/headers/body (normalize +
 * §8.4 headers), SSE → AgentChunk + invoke/stream parity, broker token as
 * Bearer, MissingCredentialError, tool_calls → tool-call-*, abort, and HTTP
 * error classification.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdapterDeps } from '../../registry.ts';
import { getAdapterFactory } from '../../registry.ts';
import type { AgentChunk } from '../../stream.ts';
import { CopilotSdkAdapter, resolveCopilotToken } from './index.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDeps(over?: Partial<AdapterDeps>): AdapterDeps {
  return { workdir: '/work/dir', repoRoot: '/work/dir', commit: 'abc', branch: 'main', ...over };
}

function sseResponse(sse: string, status = 200): Response {
  return new Response(sse, {
    status,
    headers: { 'content-type': 'text/event-stream' },
  });
}

const TEXT_SSE =
  'data: {"choices":[{"delta":{"content":"po"},"finish_reason":null}]}\n\n' +
  'data: {"choices":[{"delta":{"content":"ng"},"finish_reason":"stop"}]}\n\n' +
  'data: {"choices":[],"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5}}\n\n' +
  'data: [DONE]\n\n';

let savedToken: string | undefined;
beforeEach(() => {
  savedToken = process.env.COPILOT_TOKEN;
  delete process.env.COPILOT_TOKEN;
});
afterEach(() => {
  if (savedToken === undefined) delete process.env.COPILOT_TOKEN;
  else process.env.COPILOT_TOKEN = savedToken;
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Request contract: URL + headers + body
// ---------------------------------------------------------------------------

describe('CopilotSdkAdapter — request contract', () => {
  it('POSTs to the chat endpoint with §8.4 headers, Bearer token, and OpenAI body', async () => {
    let url: string | undefined;
    let init: RequestInit | undefined;
    const fetchFn = (async (u: string, i: RequestInit) => {
      url = u;
      init = i;
      return sseResponse(TEXT_SSE);
    }) as unknown as typeof fetch;

    const adapter = new CopilotSdkAdapter(
      { type: 'copilot-sdk', model: 'gpt-4o' },
      makeDeps(),
      'copilot-session-xyz',
      fetchFn,
    );

    const chunks: AgentChunk[] = [];
    for await (const c of adapter.stream({ messages: [{ role: 'user', content: 'ping' }] })) {
      chunks.push(c);
    }

    expect(url).toBe('https://api.githubcopilot.com/chat/completions');
    expect(init?.method).toBe('POST');
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer copilot-session-xyz');
    expect(headers['Copilot-Integration-Id']).toBe('vscode-chat');
    expect(headers['User-Agent']).toBe('GithubCopilot/1.155.0');
    expect(headers['Openai-Intent']).toBe('conversation-panel');

    const body = JSON.parse(init?.body as string);
    expect(body.model).toBe('gpt-4o');
    expect(body.stream).toBe(true);
    expect(body.stream_options).toEqual({ include_usage: true });
    expect(body.messages).toEqual([{ role: 'user', content: 'ping' }]);
  });
});

// ---------------------------------------------------------------------------
// SSE → AgentChunk + invoke/stream parity
// ---------------------------------------------------------------------------

describe('CopilotSdkAdapter — streaming + parity', () => {
  it('stream() maps SSE to AgentChunks', async () => {
    const fetchFn = (async () => sseResponse(TEXT_SSE)) as unknown as typeof fetch;
    const adapter = new CopilotSdkAdapter(
      { type: 'copilot-sdk', model: 'gpt-4o' },
      makeDeps(),
      'tok',
      fetchFn,
    );
    const chunks: AgentChunk[] = [];
    for await (const c of adapter.stream({ messages: [{ role: 'user', content: 'ping' }] })) {
      chunks.push(c);
    }
    expect(chunks).toEqual<AgentChunk[]>([
      { type: 'text-delta', text: 'po' },
      { type: 'text-delta', text: 'ng' },
      { type: 'usage', usage: { inputTokens: 3, outputTokens: 2 } },
      { type: 'message-stop', finishReason: 'stop' },
    ]);
  });

  it('invoke() reduces the same stream', async () => {
    const fetchFn = (async () => sseResponse(TEXT_SSE)) as unknown as typeof fetch;
    const adapter = new CopilotSdkAdapter(
      { type: 'copilot-sdk', model: 'gpt-4o' },
      makeDeps(),
      'tok',
      fetchFn,
    );
    const result = await adapter.invoke({ messages: [{ role: 'user', content: 'ping' }] });
    expect(result.content).toBe('pong');
    expect(result.finishReason).toBe('stop');
    expect(result.usage).toEqual({ inputTokens: 3, outputTokens: 2 });
  });

  it('surfaces tool_calls as tool-call-* chunks (host-loop)', async () => {
    const sse =
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"f","arguments":"{}"}}]}}]}\n\n' +
      'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n' +
      'data: [DONE]\n\n';
    const fetchFn = (async () => sseResponse(sse)) as unknown as typeof fetch;
    const adapter = new CopilotSdkAdapter(
      { type: 'copilot-sdk', model: 'gpt-4o' },
      makeDeps(),
      'tok',
      fetchFn,
    );
    const chunks: AgentChunk[] = [];
    for await (const c of adapter.stream({
      messages: [{ role: 'user', content: 'go' }],
      tools: [{ name: 'f' }],
    })) {
      chunks.push(c);
    }
    expect(chunks).toContainEqual({ type: 'tool-call-start', toolCallId: 'call_1', toolName: 'f' });
    expect(chunks).toContainEqual({ type: 'tool-call-end', toolCallId: 'call_1', input: {} });
    expect(chunks.at(-1)).toEqual({ type: 'message-stop', finishReason: 'tool_use' });
  });
});

// ---------------------------------------------------------------------------
// Errors + abort
// ---------------------------------------------------------------------------

describe('CopilotSdkAdapter — errors + abort', () => {
  it('emits a classified error chunk on a non-2xx response', async () => {
    const fetchFn = (async () => sseResponse('forbidden', 403)) as unknown as typeof fetch;
    const adapter = new CopilotSdkAdapter(
      { type: 'copilot-sdk', model: 'gpt-4o' },
      makeDeps(),
      'tok',
      fetchFn,
    );
    const chunks: AgentChunk[] = [];
    for await (const c of adapter.stream({ messages: [{ role: 'user', content: 'x' }] })) {
      chunks.push(c);
    }
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.type).toBe('error');
  });

  it('ends with finishReason "aborted" when the fetch aborts', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const fetchFn = (async () => {
      throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    }) as unknown as typeof fetch;
    const adapter = new CopilotSdkAdapter(
      { type: 'copilot-sdk', model: 'gpt-4o' },
      makeDeps(),
      'tok',
      fetchFn,
    );
    const chunks: AgentChunk[] = [];
    for await (const c of adapter.stream(
      { messages: [{ role: 'user', content: 'x' }] },
      { signal: ctrl.signal },
    )) {
      chunks.push(c);
    }
    expect(chunks.at(-1)).toEqual({ type: 'message-stop', finishReason: 'aborted' });
  });
});

// ---------------------------------------------------------------------------
// Auth: token resolution + broker → Bearer + MissingCredentialError
// ---------------------------------------------------------------------------

describe('CopilotSdkAdapter — auth', () => {
  it('resolveCopilotToken prefers spec.apiKey, then broker, then env', async () => {
    expect(await resolveCopilotToken({ type: 'copilot-sdk', model: 'm', apiKey: 'spec' })).toBe(
      'spec',
    );

    const broker = { getCredential: vi.fn(async () => ({ apiKey: 'broker-tok' })) };
    expect(await resolveCopilotToken({ type: 'copilot-sdk', model: 'm' }, broker)).toBe(
      'broker-tok',
    );
    expect(broker.getCredential).toHaveBeenCalledWith('github-copilot');

    process.env.COPILOT_TOKEN = 'env-tok';
    expect(await resolveCopilotToken({ type: 'copilot-sdk', model: 'm' })).toBe('env-tok');
  });

  it('resolveCopilotToken throws MissingCredentialError when nothing resolves', async () => {
    await expect(resolveCopilotToken({ type: 'copilot-sdk', model: 'm' })).rejects.toThrow(
      /Copilot session token/,
    );
  });

  it('factory injects the broker-resolved token as the Bearer header', async () => {
    await import('./index.ts'); // ensure self-registration ran
    let auth: string | undefined;
    const fetchStub = vi.fn(async (_u: string, i: RequestInit) => {
      auth = (i.headers as Record<string, string>).Authorization;
      return sseResponse(TEXT_SSE);
    });
    vi.stubGlobal('fetch', fetchStub);

    const factory = getAdapterFactory('copilot-sdk');
    expect(factory).toBeDefined();
    const broker = { getCredential: vi.fn(async () => ({ apiKey: 'broker-session' })) };
    const adapter = factory?.factory(
      { type: 'copilot-sdk', model: 'gpt-4o' },
      makeDeps({ credentialBroker: broker }),
    );
    for await (const _ of adapter!.stream({ messages: [{ role: 'user', content: 'hi' }] })) {
      /* drain */
    }
    expect(broker.getCredential).toHaveBeenCalledWith('github-copilot');
    expect(auth).toBe('Bearer broker-session');
  });

  it('factory throws MissingCredentialError when no token and no broker', async () => {
    await import('./index.ts');
    const factory = getAdapterFactory('copilot-sdk');
    expect(() => factory?.factory({ type: 'copilot-sdk', model: 'm' }, makeDeps())).toThrow(
      /Copilot session token/,
    );
  });
});

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------

describe('CopilotSdkAdapter — capabilities', () => {
  it('reports the copilot-sdk capability matrix', () => {
    const adapter = new CopilotSdkAdapter(
      { type: 'copilot-sdk', model: 'gpt-4o' },
      makeDeps(),
      'tok',
    );
    expect(adapter.type).toBe('copilot-sdk');
    expect(adapter.capabilities.supportsStreaming).toBe(true);
    expect(adapter.capabilities.supportsToolUse).toBe(true);
    expect(adapter.capabilities.reportsUsage).toBe(true);
  });
});
