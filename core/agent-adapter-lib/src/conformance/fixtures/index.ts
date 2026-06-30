/**
 * Conformance fixtures — deterministic mocked-backend responses (PRD §5, Phase E).
 *
 * The conformance suite (../index.ts + ../scenarios.ts) is backend-AGNOSTIC: it
 * drives any AgentAdapter through a fixed scenario set and asserts on the
 * normalized AgentChunk / AgentInvocationResult surface. This module supplies
 * the OTHER half — the canned per-backend wire-format responses that let the
 * driving test (../conformance.test.ts) run all 11 built-in adapters against the
 * suite with NO network and NO real subprocess in CI.
 *
 * Design — INPUT-DRIVEN mocks (no shared mutable state):
 *   Each mock is a pure function of (request, signal). It inspects the request
 *   the adapter sent and produces a deterministic "plan" response:
 *     - 'text'      — a plain text answer + usage + stop  (echo / multi-turn)
 *     - 'tool'      — a tool-call surfaces in the stream    (tool-use)
 *     - 'thinking'  — a thinking/reasoning event surfaces   (extended-thinking)
 *     - 'abort'     — the backend errors out as if aborted  (abort scenario)
 *     - 'malformed' — the backend rejects the request       (malformed input)
 *
 *   The plan is decided from the request alone:
 *     - empty messages         → 'malformed'  (a real backend would 400)
 *     - host-injected tools[]  → 'tool'        (host-loop adapters)
 *     - a sentinel in the text → 'tool'/'thinking'/'abort' (autonomous adapters,
 *       which reject custom tools, signal intent via a prompt sentinel instead)
 *     - aborted signal         → 'abort'       (SDK backends throw an AbortError)
 *     - otherwise              → 'text'
 *
 *   The sentinels are ALSO natural-language-ish so a real third-party backend
 *   driven by runConformance still does the right thing (e.g. calls a tool).
 */

import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Sentinels — the contract between scenarios (which embed them in prompts) and
// the fixtures (which interpret them). Harmless extra text for real backends.
// ---------------------------------------------------------------------------

export const SENTINELS = {
  /** "Please use a tool to …" — autonomous adapters surface a built-in tool call. */
  tool: '[[conformance:please-call-a-tool]]',
  /** "Think step by step …" — thinking-capable adapters surface a reasoning event. */
  thinking: '[[conformance:think-out-loud]]',
  /** The request that the scenario will abort mid-flight. */
  abort: '[[conformance:long-running-abort]]',
} as const;

export type Plan = 'text' | 'tool' | 'thinking' | 'abort' | 'malformed';

export interface PlanSignals {
  /** Serialized request (messages/contents) for sentinel detection. */
  requestText: string;
  /** True when the request carries no messages — a malformed invocation. */
  isEmpty: boolean;
  /** True when the host injected custom tool definitions (host-loop adapters). */
  hasTools: boolean;
  /** True when the call's AbortSignal is already aborted. */
  signalAborted: boolean;
}

/** Decide the deterministic response plan from a backend request. */
export function detectPlan(s: PlanSignals): Plan {
  if (s.signalAborted) return 'abort';
  if (s.isEmpty) return 'malformed';
  if (s.hasTools) return 'tool';
  if (s.requestText.includes(SENTINELS.tool)) return 'tool';
  if (s.requestText.includes(SENTINELS.thinking)) return 'thinking';
  if (s.requestText.includes(SENTINELS.abort)) return 'abort';
  return 'text';
}

/** An AbortError shaped like the ones backends throw when a request is cancelled. */
export function makeAbortError(): Error {
  return Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' });
}

/** A generic backend rejection for malformed input (classified into AdapterError). */
export function makeMalformedError(provider: string): Error {
  return new Error(`${provider}: invalid request — at least one message is required (empty input)`);
}

// ---------------------------------------------------------------------------
// SDK wire-format event builders (verbatim shapes from each adapter's tests)
// ---------------------------------------------------------------------------

type Obj = Record<string, unknown>;

/** Anthropic Messages stream events (claude-sdk). */
export function anthropicStreamEvents(plan: Plan): Obj[] {
  const messageStart = (input = 10): Obj => ({
    type: 'message_start',
    message: { role: 'assistant', content: [], usage: { input_tokens: input, output_tokens: 0 } },
  });
  const messageDelta = (stop: string, out = 5): Obj => ({
    type: 'message_delta',
    delta: { stop_reason: stop, stop_sequence: null },
    usage: { output_tokens: out },
  });
  const stop: Obj = { type: 'message_stop' };

  if (plan === 'tool') {
    return [
      messageStart(15),
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id: 'tool_1', name: 'get_weather', input: {} },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '{}' },
      },
      { type: 'content_block_stop', index: 0 },
      messageDelta('tool_use', 3),
      stop,
    ];
  }
  if (plan === 'thinking') {
    return [
      messageStart(10),
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'thinking', thinking: '', signature: '' },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'thinking_delta', thinking: 'Let me reason.' },
      },
      { type: 'content_block_stop', index: 0 },
      { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'pong' } },
      { type: 'content_block_stop', index: 1 },
      messageDelta('end_turn', 5),
      stop,
    ];
  }
  // text
  return [
    messageStart(10),
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'pong' } },
    { type: 'content_block_stop', index: 0 },
    messageDelta('end_turn', 5),
    stop,
  ];
}

/** OpenAI Chat Completions stream chunks (openai-sdk). */
export function openaiStreamChunks(plan: Plan): Obj[] {
  if (plan === 'tool') {
    return [
      {
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 0, id: 'call_1', function: { name: 'get_weather', arguments: '{}' } },
              ],
            },
          },
        ],
      },
      {
        choices: [{ delta: {}, finish_reason: 'tool_calls' }],
        usage: { prompt_tokens: 3, completion_tokens: 1 },
      },
    ];
  }
  return [
    { choices: [{ delta: { content: 'pong' }, finish_reason: null }] },
    {
      choices: [{ delta: {}, finish_reason: 'stop' }],
      usage: { prompt_tokens: 3, completion_tokens: 2 },
    },
  ];
}

/** Google @google/genai generateContentStream chunks (gemini-sdk). */
export function geminiStreamChunks(plan: Plan): Obj[] {
  if (plan === 'tool') {
    return [
      {
        candidates: [
          { content: { parts: [{ functionCall: { id: 'fc_1', name: 'get_weather', args: {} } }] } },
        ],
      },
      {
        candidates: [{ content: { parts: [] }, finishReason: 'STOP' }],
        usageMetadata: { promptTokenCount: 15, candidatesTokenCount: 3 },
      },
    ];
  }
  return [
    { candidates: [{ content: { parts: [{ text: 'pong' }] } }] },
    {
      candidates: [{ content: { parts: [] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
    },
  ];
}

/** AWS Bedrock ConverseStream events (bedrock-sdk). */
export function bedrockStreamEvents(plan: Plan): Obj[] {
  const start: Obj = { messageStart: { role: 'assistant' } };
  if (plan === 'tool') {
    return [
      start,
      {
        contentBlockStart: {
          start: { toolUse: { toolUseId: 'tool_1', name: 'get_weather' } },
          contentBlockIndex: 0,
        },
      },
      { contentBlockDelta: { delta: { toolUse: { input: '{}' } }, contentBlockIndex: 0 } },
      { contentBlockStop: { contentBlockIndex: 0 } },
      { messageStop: { stopReason: 'tool_use' } },
      { metadata: { usage: { inputTokens: 5, outputTokens: 1 } } },
    ];
  }
  if (plan === 'thinking') {
    return [
      start,
      {
        contentBlockDelta: {
          delta: { reasoningContent: { text: 'Let me reason.' } },
          contentBlockIndex: 0,
        },
      },
      { contentBlockDelta: { delta: { text: 'pong' }, contentBlockIndex: 0 } },
      { contentBlockStop: { contentBlockIndex: 0 } },
      { messageStop: { stopReason: 'end_turn' } },
      { metadata: { usage: { inputTokens: 3, outputTokens: 2 } } },
    ];
  }
  return [
    start,
    { contentBlockDelta: { delta: { text: 'pong' }, contentBlockIndex: 0 } },
    { contentBlockStop: { contentBlockIndex: 0 } },
    { messageStop: { stopReason: 'end_turn' } },
    { metadata: { usage: { inputTokens: 3, outputTokens: 2 } } },
  ];
}

/** @anthropic-ai/claude-agent-sdk query() SDKMessage stream (claude-agent-sdk). */
export function claudeAgentMessages(plan: Plan): Obj[] {
  const usage = {
    input_tokens: 10,
    output_tokens: 5,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
  };
  const result = (text: string, stop: string): Obj => ({
    type: 'result',
    subtype: 'success',
    result: text,
    stop_reason: stop,
    is_error: false,
    usage,
    uuid: 'uuid-r',
    session_id: 'sess-1',
  });
  if (plan === 'tool') {
    return [
      {
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', id: 'tool_1', name: 'Read', input: { file_path: 'x' } }],
          usage,
        },
        uuid: 'u1',
        session_id: 'sess-1',
      },
      result('done', 'tool_use'),
    ];
  }
  if (plan === 'thinking') {
    return [
      {
        type: 'assistant',
        message: {
          content: [
            { type: 'thinking', thinking: 'Let me reason.' },
            { type: 'text', text: 'pong' },
          ],
          usage,
        },
        uuid: 'u1',
        session_id: 'sess-1',
      },
      result('pong', 'end_turn'),
    ];
  }
  return [
    {
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'pong' }], usage },
      uuid: 'u1',
      session_id: 'sess-1',
    },
    result('pong', 'end_turn'),
  ];
}

/** GitHub Copilot SSE body (copilot-sdk, host-loop, no thinking). */
export function copilotSse(plan: Plan): string {
  if (plan === 'tool') {
    return (
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"get_weather","arguments":"{}"}}]}}]}\n\n' +
      'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n' +
      'data: [DONE]\n\n'
    );
  }
  return (
    'data: {"choices":[{"delta":{"content":"pong"},"finish_reason":"stop"}]}\n\n' +
    'data: {"choices":[],"usage":{"prompt_tokens":3,"completion_tokens":2}}\n\n' +
    'data: [DONE]\n\n'
  );
}

// ---------------------------------------------------------------------------
// CLI stdout — reuse each adapter's REAL captured transcript (PRD §5)
// ---------------------------------------------------------------------------

export type CliType =
  | 'claude-code-cli'
  | 'opencode-cli'
  | 'gemini-cli'
  | 'codex-cli'
  | 'copilot-cli';

const FIX_DIR = dirname(fileURLToPath(import.meta.url));

function readFixtureLines(cli: CliType, file: string): string[] {
  const path = join(FIX_DIR, '..', '..', 'adapters', cli, 'fixtures', file);
  return readFileSync(path, 'utf8')
    .split('\n')
    .filter((l) => l.trim().length > 0);
}

/** A reasoning/thinking stdout line for each thinking-capable CLI. */
function thinkingLine(cli: CliType): string {
  switch (cli) {
    case 'opencode-cli':
      return JSON.stringify({
        type: 'reasoning',
        part: { type: 'reasoning', text: 'Let me reason.' },
      });
    case 'codex-cli':
      return JSON.stringify({
        type: 'item.completed',
        item: { id: 'r0', item_type: 'reasoning', text: 'Let me reason.' },
      });
    default:
      // claude-code-cli carries thinking inside an assistant message block.
      return JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'thinking', thinking: 'Let me reason.' }],
          usage: { input_tokens: 1, output_tokens: 1 },
        },
      });
  }
}

/**
 * The stdout lines a mocked CLI subprocess should emit for the given plan.
 * 'abort' and 'malformed' emit nothing (the empty/non-zero exit drives them).
 */
export function cliStdoutLines(cli: CliType, plan: Plan): string[] {
  if (plan === 'abort' || plan === 'malformed') return [];
  if (cli === 'copilot-cli') {
    // Plain-text print mode → buffered into one synthetic block.
    return ['pong'];
  }
  if (plan === 'tool') return readFixtureLines(cli, 'tool-use.jsonl');
  if (plan === 'thinking')
    return [thinkingLine(cli), ...readFixtureLines(cli, 'simple-text.jsonl')];
  return readFixtureLines(cli, 'simple-text.jsonl');
}

// ---------------------------------------------------------------------------
// CLI request inspection — which CLI, and what prompt did the adapter send?
// ---------------------------------------------------------------------------

/** Identify which CLI adapter spawned this process from its argv. */
export function detectCliType(args: string[]): CliType {
  if (args.includes('--input-format')) return 'claude-code-cli';
  if (args[0] === 'run') return 'opencode-cli';
  if (args.includes('--approval-mode')) return 'gemini-cli';
  if (args[0] === 'exec') return 'codex-cli';
  if (args.includes('--allow-all-tools')) return 'copilot-cli';
  // Fallback — should never happen for the built-in CLI adapters.
  return 'claude-code-cli';
}

/** Recover the prompt text the adapter sent (from argv, or stdin for claude). */
export function extractCliPrompt(cli: CliType, args: string[], stdin: string): string {
  switch (cli) {
    case 'claude-code-cli': {
      // stream-json over stdin: one JSON message per line.
      const texts: string[] = [];
      for (const line of stdin.split('\n')) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line) as { message?: { content?: unknown } };
          const content = msg.message?.content;
          if (typeof content === 'string') texts.push(content);
          else if (Array.isArray(content)) {
            for (const b of content) {
              if (b && typeof b === 'object' && 'text' in b)
                texts.push(String((b as { text: unknown }).text));
            }
          }
        } catch {
          // ignore non-JSON lines
        }
      }
      return texts.join('\n');
    }
    case 'gemini-cli': {
      const i = args.indexOf('--prompt');
      return i >= 0 ? (args[i + 1] ?? '') : '';
    }
    case 'copilot-cli': {
      const i = args.indexOf('-p');
      return i >= 0 ? (args[i + 1] ?? '') : '';
    }
    default:
      // opencode-cli + codex-cli append the prompt as the final positional arg.
      return args.length > 0 ? (args[args.length - 1] ?? '') : '';
  }
}

/** Decide the plan for a mocked CLI spawn (it cannot see the AbortSignal). */
export function detectCliPlan(cli: CliType, args: string[], stdin: string): Plan {
  const prompt = extractCliPrompt(cli, args, stdin);
  return detectPlan({
    requestText: prompt,
    isEmpty: prompt.trim().length === 0,
    hasTools: false, // autonomous CLIs reject custom tools; never set here
    signalAborted: false,
  });
}

// ---------------------------------------------------------------------------
// collect — drain an AgentChunk stream into an array (test helper)
// ---------------------------------------------------------------------------

export async function collect<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const chunk of stream) out.push(chunk);
  return out;
}

// ---------------------------------------------------------------------------
// Mock module builders — drop-in replacements for each backend SDK / spawn.
// The driving test wires these via vi.mock(...) so the suite needs no network
// or real subprocess. Each is a pure, input-driven mock (see detectPlan).
// ---------------------------------------------------------------------------

function planFromSdkRequest(args: {
  request: Obj;
  messages: unknown;
  tools: unknown;
  signalAborted: boolean;
}): Plan {
  const msgs = Array.isArray(args.messages) ? args.messages : [];
  const hasTools = Array.isArray(args.tools)
    ? args.tools.length > 0
    : args.tools !== undefined && args.tools !== null;
  return detectPlan({
    requestText: JSON.stringify(args.request),
    isEmpty: msgs.length === 0,
    hasTools,
    signalAborted: args.signalAborted,
  });
}

/** Mock for `@anthropic-ai/sdk` (claude-sdk). */
export function makeAnthropicMockModule(): Record<string, unknown> {
  class APIUserAbortError extends Error {
    constructor() {
      super('Request was aborted.');
      this.name = 'APIUserAbortError';
    }
  }
  class APIError extends Error {
    status = 0;
    headers: Record<string, string> = {};
    error: unknown = {};
  }
  function stream(body: Obj, opts?: { signal?: AbortSignal }): AsyncIterable<Obj> {
    const plan = planFromSdkRequest({
      request: body ?? {},
      messages: (body as { messages?: unknown })?.messages,
      tools: (body as { tools?: unknown })?.tools,
      signalAborted: !!opts?.signal?.aborted,
    });
    return (async function* () {
      if (plan === 'abort') throw new APIUserAbortError();
      if (plan === 'malformed') throw makeMalformedError('anthropic');
      for (const ev of anthropicStreamEvents(plan)) yield ev;
    })();
  }
  class MockAnthropic {
    static APIError = APIError;
    static APIUserAbortError = APIUserAbortError;
    messages = { stream };
    constructor(_opts?: unknown) {}
  }
  return { default: MockAnthropic, APIUserAbortError };
}

/** Mock for `openai` (openai-sdk). */
export function makeOpenAiMockModule(): Record<string, unknown> {
  class APIError extends Error {
    status = 0;
    headers: unknown = {};
    error: unknown = {};
  }
  class APIUserAbortError extends Error {
    constructor() {
      super('Request was aborted.');
      this.name = 'APIUserAbortError';
    }
  }
  class MockOpenAI {
    static APIError = APIError;
    static APIUserAbortError = APIUserAbortError;
    chat = {
      completions: {
        create: async (body: Obj, opts?: { signal?: AbortSignal }): Promise<AsyncIterable<Obj>> => {
          const plan = planFromSdkRequest({
            request: body ?? {},
            messages: (body as { messages?: unknown })?.messages,
            tools: (body as { tools?: unknown })?.tools,
            signalAborted: !!opts?.signal?.aborted,
          });
          if (plan === 'abort') throw new APIUserAbortError();
          if (plan === 'malformed') throw makeMalformedError('openai');
          return (async function* () {
            for (const c of openaiStreamChunks(plan)) yield c;
          })();
        },
      },
    };
    constructor(_opts?: unknown) {}
  }
  return { default: MockOpenAI };
}

/** Mock for `@google/genai` (gemini-sdk). */
export function makeGeminiMockModule(): Record<string, unknown> {
  class ApiError extends Error {
    status = 0;
  }
  class GoogleGenAI {
    models: {
      generateContentStream: (req: Obj) => Promise<AsyncIterable<Obj>>;
    };
    constructor(_opts?: unknown) {
      this.models = {
        generateContentStream: async (req: Obj): Promise<AsyncIterable<Obj>> => {
          const config = (req as { config?: { tools?: unknown; abortSignal?: AbortSignal } })
            .config;
          const plan = planFromSdkRequest({
            request: req ?? {},
            messages: (req as { contents?: unknown })?.contents,
            tools: config?.tools,
            signalAborted: !!config?.abortSignal?.aborted,
          });
          if (plan === 'abort') throw makeAbortError();
          if (plan === 'malformed') throw makeMalformedError('gemini');
          return (async function* () {
            for (const c of geminiStreamChunks(plan)) yield c;
          })();
        },
      };
    }
  }
  return { GoogleGenAI, ApiError };
}

/** Mock for `@aws-sdk/client-bedrock-runtime` (bedrock-sdk). */
export function makeBedrockMockModule(): Record<string, unknown> {
  class ConverseStreamCommand {
    input: Obj;
    constructor(input: Obj) {
      this.input = input;
    }
  }
  class ConverseCommand {
    input: Obj;
    constructor(input: Obj) {
      this.input = input;
    }
  }
  class BedrockRuntimeClient {
    constructor(_config?: unknown) {}
    send = async (
      command: { input?: Obj },
      opts?: { abortSignal?: AbortSignal },
    ): Promise<{ stream: AsyncIterable<Obj> }> => {
      const input = command?.input ?? {};
      const plan = planFromSdkRequest({
        request: input,
        messages: (input as { messages?: unknown }).messages,
        tools: (input as { toolConfig?: unknown }).toolConfig,
        signalAborted: !!opts?.abortSignal?.aborted,
      });
      if (plan === 'malformed') throw makeMalformedError('bedrock');
      const stream = (async function* () {
        if (plan === 'abort') throw makeAbortError();
        for (const ev of bedrockStreamEvents(plan)) yield ev;
      })();
      return { stream };
    };
  }
  return { BedrockRuntimeClient, ConverseStreamCommand, ConverseCommand };
}

/** Mock for `@anthropic-ai/claude-agent-sdk` (claude-agent-sdk). */
export function makeClaudeAgentMockModule(): Record<string, unknown> {
  function query(params: { prompt?: string }): AsyncIterable<Obj> {
    const prompt = params?.prompt ?? '';
    const plan = detectPlan({
      requestText: prompt,
      isEmpty: prompt.trim().length === 0,
      hasTools: false,
      signalAborted: false,
    });
    return (async function* () {
      if (plan === 'malformed') throw makeMalformedError('claude-agent-sdk');
      for (const m of claudeAgentMessages(plan)) yield m;
    })();
  }
  return { query };
}

/** An injectable `fetch` for copilot-sdk (no module mock needed). */
export function makeCopilotFetch(): typeof fetch {
  return (async (_url: string, init?: RequestInit): Promise<Response> => {
    const signal = init?.signal ?? undefined;
    if (signal?.aborted) throw makeAbortError();
    const body = init?.body ? (JSON.parse(init.body as string) as Obj) : {};
    const plan = planFromSdkRequest({
      request: body,
      messages: (body as { messages?: unknown }).messages,
      tools: (body as { tools?: unknown }).tools,
      signalAborted: !!signal?.aborted,
    });
    if (plan === 'malformed') {
      return new Response('invalid request: at least one message is required', { status: 400 });
    }
    if (plan === 'abort') throw makeAbortError();
    return new Response(copilotSse(plan), {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    });
  }) as unknown as typeof fetch;
}

// ---------------------------------------------------------------------------
// conformanceSpawn — a node:child_process.spawn replacement for the 5 CLIs.
// ---------------------------------------------------------------------------

interface FakeChild extends EventEmitter {
  stdout: EventEmitter;
  stderr: EventEmitter;
  stdin: { write: (d: unknown) => boolean; end: () => void; on: () => void };
  kill: (signal?: string) => boolean;
  killed: boolean;
}

/**
 * Spawn replacement: builds a fake subprocess whose stdout is the canned
 * transcript for the detected CLI + plan. Mirrors the per-adapter fakeChild
 * pattern (emit stdout 'data' then 'close'); kill() emits 'close' so abort
 * resolves. 'malformed' exits non-zero so the adapter throws a typed error.
 */
export function conformanceSpawn(_binary: string, args: string[], _options?: unknown): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  let stdinBuf = '';
  child.stdin = {
    write: (d: unknown) => {
      stdinBuf += typeof d === 'string' ? d : String(d);
      return true;
    },
    end: () => {},
    on: () => {},
  };
  child.killed = false;
  child.kill = (signal?: string) => {
    child.killed = true;
    setImmediate(() => child.emit('close', null, signal ?? 'SIGTERM'));
    return true;
  };

  setImmediate(() => {
    const cli = detectCliType(args);
    const plan = detectCliPlan(cli, args, stdinBuf);
    const lines = cliStdoutLines(cli, plan);
    const exitCode = plan === 'malformed' ? 1 : 0;
    const out = lines.join('\n') + (lines.length > 0 ? '\n' : '');
    if (out) child.stdout.emit('data', Buffer.from(out));
    setImmediate(() => {
      child.stdout.emit('close');
      child.stderr.emit('close');
      setImmediate(() => child.emit('close', exitCode));
    });
  });

  return child;
}
