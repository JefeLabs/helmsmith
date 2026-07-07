/**
 * Conformance scenarios — the fixed behaviour set every AgentAdapter must
 * satisfy to be swap-compatible (PRD §5, Phase E).
 *
 * Each scenario is a `{ name, run(adapter, harness), skipFor?(caps) }`. The
 * scenarios are backend-AGNOSTIC: they send a normalized AgentInput and assert
 * on the normalized AgentChunk / AgentInvocationResult surface only. They never
 * reach into a specific backend, so a third-party adapter (built-in or external)
 * that passes is swap-compatible by construction.
 *
 * Capability awareness:
 *   - `skipFor(caps)` auto-skips a scenario the adapter cannot honour
 *     (e.g. extended-thinking on an adapter with supportsExtendedThinking:false).
 *   - the tool-use scenario BRANCHES on caps.toolUseMode: host-loop adapters get
 *     a custom `tools` array (custom-tool injection); autonomous adapters (which
 *     reject custom tools) get a prompt that triggers a BUILT-IN tool call.
 */

import type { AdapterCapabilities, AgentAdapter } from '../agent.ts';
import { AdapterError } from '../errors.ts';
import { SENTINELS } from './fixtures/index.ts';

// ---------------------------------------------------------------------------
// Harness — utilities handed to every scenario
// ---------------------------------------------------------------------------

export interface ConformanceHarness {
  /** The adapter-under-test's reported capabilities. */
  readonly caps: AdapterCapabilities;
  /** Drain an AgentChunk stream into an array. */
  collect<T>(stream: AsyncIterable<T>): Promise<T[]>;
  /** Throw a descriptive Error when `cond` is falsy. */
  assert(cond: unknown, message: string): void;
}

export interface ConformanceScenario {
  /** Stable identifier (used for skipScenarios + reporting). */
  readonly name: string;
  /** Drive the adapter through the scenario; throw on a contract violation. */
  run(adapter: AgentAdapter, h: ConformanceHarness): Promise<void>;
  /** Auto-skip when the adapter's capabilities cannot honour this scenario. */
  skipFor?(caps: AdapterCapabilities): boolean;
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

/** echo — a single prompt yields assistant text in the result. */
const echo: ConformanceScenario = {
  name: 'echo',
  async run(adapter, h) {
    const result = await adapter.invoke({
      messages: [{ role: 'user', content: 'Reply with a short greeting.' }],
    });
    h.assert(
      typeof result.content === 'string' && result.content.length > 0,
      `echo: expected non-empty text content, got ${JSON.stringify(result.content)}`,
    );
  },
};

/** multi-turn — a multi-message conversation is accepted and answered. */
const multiTurn: ConformanceScenario = {
  name: 'multi-turn',
  async run(adapter, h) {
    const result = await adapter.invoke({
      messages: [
        { role: 'user', content: 'My name is Ada.' },
        { role: 'assistant', content: 'Nice to meet you, Ada.' },
        { role: 'user', content: 'What is my name?' },
      ],
    });
    h.assert(
      typeof result.content === 'string' && result.content.length > 0,
      'multi-turn: expected a non-empty text result for a multi-message conversation',
    );
  },
};

/**
 * abort — aborting the call ends the stream with finishReason 'aborted' and
 * never throws. The signal is aborted before consumption (deterministic across
 * streaming and buffered backends alike), exercising the same catch→'aborted'
 * path every adapter implements.
 */
const abort: ConformanceScenario = {
  name: 'abort',
  skipFor: (caps) => !caps.supportsCancellation,
  async run(adapter, h) {
    const ctrl = new AbortController();
    ctrl.abort();
    const result = await adapter.invoke(
      { messages: [{ role: 'user', content: `Start a long task. ${SENTINELS.abort}` }] },
      { signal: ctrl.signal },
    );
    h.assert(
      result.finishReason === 'aborted',
      `abort: expected finishReason 'aborted', got '${result.finishReason}'`,
    );
  },
};

/**
 * tool-use — a tool call surfaces in the stream. Capability-branched:
 *   - host-loop adapters: a custom `tools` array is injected (and accepted).
 *   - autonomous adapters: a prompt triggers a BUILT-IN tool call (they reject
 *     custom tools, so none are passed).
 * Skipped for autonomous + non-streaming adapters (copilot-cli buffers stdout
 * into one synthetic text block and surfaces no incremental tool-call chunks).
 */
const toolUse: ConformanceScenario = {
  name: 'tool-use',
  skipFor: (caps) =>
    !caps.supportsToolUse || (caps.toolUseMode === 'autonomous' && !caps.supportsStreaming),
  async run(adapter, h) {
    const stream =
      h.caps.toolUseMode === 'host-loop'
        ? adapter.stream({
            messages: [
              { role: 'user', content: `What is the weather in Paris? ${SENTINELS.tool}` },
            ],
            tools: [
              {
                name: 'get_weather',
                description: 'Get the current weather for a city.',
                inputSchema: { type: 'object', properties: { city: { type: 'string' } } },
              },
            ],
          })
        : adapter.stream({
            messages: [
              { role: 'user', content: `Please use a tool to read a file. ${SENTINELS.tool}` },
            ],
          });

    const chunks = await h.collect(stream);
    const sawToolCall = chunks.some(
      (c) => c.type === 'tool-call-start' || c.type === 'tool-call-end',
    );
    h.assert(
      sawToolCall,
      `tool-use: expected a tool-call-* chunk to surface (toolUseMode=${h.caps.toolUseMode})`,
    );
  },
};

/** malformed — an invalid invocation throws a typed AdapterError, not a crash. */
const malformed: ConformanceScenario = {
  name: 'malformed',
  async run(adapter, h) {
    let thrown: unknown;
    try {
      await adapter.invoke({ messages: [] });
    } catch (err) {
      thrown = err;
    }
    h.assert(thrown !== undefined, 'malformed: expected invoke({ messages: [] }) to throw');
    h.assert(
      thrown instanceof AdapterError,
      `malformed: expected an AdapterError, got ${
        thrown instanceof Error ? `${thrown.name}: ${thrown.message}` : String(thrown)
      }`,
    );
  },
};

/** usage — the adapter reports token usage. (skipFor !reportsUsage) */
const usage: ConformanceScenario = {
  name: 'usage',
  skipFor: (caps) => !caps.reportsUsage,
  async run(adapter, h) {
    const result = await adapter.invoke({
      messages: [{ role: 'user', content: 'hello' }],
    });
    const u = result.usage;
    h.assert(u !== undefined, 'usage: expected result.usage to be defined');
    h.assert(
      typeof u?.inputTokens === 'number' && typeof u?.outputTokens === 'number',
      'usage: expected numeric inputTokens/outputTokens',
    );
  },
};

/** extended-thinking — a thinking/reasoning event surfaces. (skipFor !supportsExtendedThinking) */
const extendedThinking: ConformanceScenario = {
  name: 'extended-thinking',
  skipFor: (caps) => !caps.supportsExtendedThinking,
  async run(adapter, h) {
    const chunks = await h.collect(
      adapter.stream({
        messages: [
          { role: 'user', content: `Think step by step, then answer. ${SENTINELS.thinking}` },
        ],
      }),
    );
    const sawThinking = chunks.some((c) => c.type === 'thinking-delta');
    h.assert(sawThinking, 'extended-thinking: expected a thinking-delta chunk to surface');
  },
};

/**
 * json-mode — a json-mode-capable adapter handles a structured-output request.
 * AgentInput exposes no response_format knob, so this is a capability-gated
 * smoke test that the adapter still produces a valid result. (skipFor !supportsJsonMode)
 */
const jsonMode: ConformanceScenario = {
  name: 'json-mode',
  skipFor: (caps) => !caps.supportsJsonMode,
  async run(adapter, h) {
    const result = await adapter.invoke({
      messages: [{ role: 'user', content: 'Return a small JSON object.' }],
    });
    h.assert(
      typeof result.content === 'string' && result.content.length > 0,
      'json-mode: expected a non-empty result for a json-capable adapter',
    );
  },
};

/** The full ordered scenario set the conformance runner drives. */
export const SCENARIOS: readonly ConformanceScenario[] = [
  echo,
  multiTurn,
  abort,
  toolUse,
  malformed,
  usage,
  extendedThinking,
  jsonMode,
];
