/**
 * ADAPTER_CATALOG — the "what exists" plane (PRD §8.7).
 *
 * Static data describing every built-in adapter. Readable with zero adapters
 * registered and zero provider SDKs installed, which is what lets a host ask
 * "what could I use?" before deciding what to import. The registry answers the
 * different question of "what did this host actually register" — see
 * `listAdapterTypes` / `getCapabilities` in capabilities.ts.
 *
 * Keyed by `string`, not `AgentSpecType`: by construction this table describes
 * adapters whose modules the host has deliberately NOT imported, so their types
 * are not members of that host's narrowed `AgentSpecType` (agent.ts).
 *
 * Built-in adapters draw their descriptor from here at registration time, so
 * catalog and registry cannot drift. EXTERNAL adapters are not in this table —
 * they pass their own descriptor to registerAdapter() and appear in registry
 * introspection only.
 *
 * `toolUseMode` records how each adapter executes tools: 'autonomous' (the
 * backend runs tools itself), 'host-loop' (the adapter surfaces tool-use events
 * and the host re-invokes), or 'none'. `supportsToolUse` is the derived
 * convenience flag (`toolUseMode !== 'none'`) and is kept consistent per row.
 *
 * copilot-sdk supportsJsonMode: false in the static catalog — at construction
 * the adapter resolves this from spec.model against a known-models allowlist
 * and may override (Phase D′).
 */

import type { AdapterCapabilities } from './agent.ts';

export interface AdapterCatalogEntry {
  /** The adapter's `spec.type`. Always equal to its key in ADAPTER_CATALOG. */
  type: string;
  capabilities: AdapterCapabilities;
}

export const ADAPTER_CATALOG: Readonly<Record<string, AdapterCatalogEntry>> = {
  'claude-sdk': {
    type: 'claude-sdk',
    capabilities: {
      reportsUsage: true,
      supportsStreaming: true,
      supportsToolUse: true, // host-loop: adapter surfaces tool-use events; host re-invokes
      toolUseMode: 'host-loop',
      supportsExtendedThinking: true,
      supportsCancellation: true,
      supportsCapture: true,
      supportsJsonMode: false, // Anthropic uses tool-use for structured output
      supportsSessionResume: false,
    },
  },

  'claude-agent-sdk': {
    type: 'claude-agent-sdk',
    capabilities: {
      reportsUsage: true,
      supportsStreaming: true,
      supportsToolUse: true, // autonomous tool execution via the Agent SDK
      toolUseMode: 'autonomous',
      supportsExtendedThinking: true,
      supportsCancellation: true,
      supportsCapture: true,
      supportsJsonMode: false,
      supportsSessionResume: false,
    },
  },

  'claude-code-cli': {
    type: 'claude-code-cli',
    capabilities: {
      reportsUsage: true,
      supportsStreaming: true,
      supportsToolUse: true, // built-in tools (Read, Edit, Bash…); host cannot inject
      toolUseMode: 'autonomous',
      supportsExtendedThinking: true,
      supportsCancellation: true, // SIGTERM
      supportsCapture: true, // transcript file
      supportsJsonMode: false, // wraps Anthropic — no response_format surface
      supportsSessionResume: false, // v1.1
    },
  },

  'opencode-cli': {
    type: 'opencode-cli',
    capabilities: {
      reportsUsage: true, // verified: opencode emits token usage in its JSON output
      supportsStreaming: true,
      supportsToolUse: true, // built-in tools; host cannot inject
      toolUseMode: 'autonomous',
      supportsExtendedThinking: true, // verified: opencode surfaces reasoning/thinking
      supportsCancellation: true, // SIGTERM
      supportsCapture: true, // transcript file
      supportsJsonMode: false,
      supportsSessionResume: false,
    },
  },

  'copilot-sdk': {
    type: 'copilot-sdk',
    capabilities: {
      reportsUsage: true, // OpenAI-style usage block
      supportsStreaming: true, // SSE
      supportsToolUse: true, // OpenAI-style function calling; host can inject custom tools
      toolUseMode: 'host-loop',
      supportsExtendedThinking: false,
      supportsCancellation: true, // AbortSignal aborts the fetch
      supportsCapture: true,
      supportsJsonMode: false, // model-dependent; resolved at construction in Phase D′
      supportsSessionResume: false, // server-side invocation-scoped
    },
  },

  // Verified against the REAL standalone `copilot` (GitHub Copilot CLI v1.0.65):
  // `copilot -p <prompt> --allow-all-tools --add-dir <workdir>` runs an
  // autonomous agent with built-in tools (edit files, run shell, search). The
  // adapter uses text print mode and buffers stdout into one synthetic block, so
  // it does NOT surface incremental chunks (supportsStreaming:false) and text
  // mode reports no token usage (reportsUsage:false).
  'copilot-cli': {
    type: 'copilot-cli',
    capabilities: {
      reportsUsage: false, // text print mode emits no token counts
      supportsStreaming: false, // adapter buffers stdout into one synthetic block
      supportsToolUse: true, // autonomous built-in tools (--allow-all-tools)
      toolUseMode: 'autonomous',
      supportsExtendedThinking: false,
      supportsCancellation: true, // SIGTERM
      supportsCapture: true, // full stdout transcript
      supportsJsonMode: false,
      supportsSessionResume: false,
    },
  },

  // Verified against the REAL `gemini` CLI v0.43.0 stream-json output
  // (@google/gemini-cli-core JsonStreamEventType: init/message/tool_use/
  // tool_result/error/result).
  'gemini-cli': {
    type: 'gemini-cli',
    capabilities: {
      reportsUsage: true, // result event carries stats { input_tokens, output_tokens }
      supportsStreaming: true, // -o stream-json (newline-delimited JSON events)
      supportsToolUse: true, // autonomous built-in tools; --approval-mode yolo
      toolUseMode: 'autonomous',
      supportsExtendedThinking: false, // stream-json has no thinking/reasoning event type
      supportsCancellation: true, // SIGTERM
      supportsCapture: true, // full stream-json transcript
      supportsJsonMode: false, // -o json is an OUTPUT format, not a model response_format
      supportsSessionResume: false, // --resume exists but not wired (v1.1)
    },
  },

  // Verified against the REAL `@google/genai` v2.10.0 streaming API
  // (ai.models.generateContentStream → AsyncGenerator<GenerateContentResponse>;
  // candidates[].content.parts[] carry text + functionCall; usageMetadata +
  // candidate.finishReason on the final chunk). Chat-mode host-loop tool use.
  'gemini-sdk': {
    type: 'gemini-sdk',
    capabilities: {
      reportsUsage: true, // usageMetadata { promptTokenCount, candidatesTokenCount }
      supportsStreaming: true, // generateContentStream
      supportsToolUse: true, // host-loop: functionCall parts surfaced as tool-call-*
      toolUseMode: 'host-loop',
      supportsExtendedThinking: false, // thinking parts not surfaced as thinking-delta (v1.1)
      supportsCancellation: true, // config.abortSignal aborts the request
      supportsCapture: true,
      supportsJsonMode: true, // structured output via responseMimeType + responseJsonSchema
      supportsSessionResume: false,
    },
  },

  // Verified against the REAL `openai` v6.45.0 Chat Completions streaming API
  // (client.chat.completions.create({stream:true}) → Stream<ChatCompletionChunk>;
  // choices[].delta.content + delta.tool_calls[] deltas; usage on the final
  // chunk via stream_options.include_usage). Chat-mode host-loop tool use.
  'openai-sdk': {
    type: 'openai-sdk',
    capabilities: {
      reportsUsage: true, // usage { prompt_tokens, completion_tokens }
      supportsStreaming: true, // chat.completions.create({ stream: true })
      supportsToolUse: true, // host-loop: tool_calls deltas surfaced as tool-call-*
      toolUseMode: 'host-loop',
      supportsExtendedThinking: false, // reasoning models expose no delta in chat.completions
      supportsCancellation: true, // RequestOptions.signal aborts the request
      supportsCapture: true,
      supportsJsonMode: true, // response_format (json_object / json_schema)
      supportsSessionResume: false,
    },
  },

  // Verified against the REAL `codex` CLI v0.133.0 `codex exec --json` events
  // (thread.started/turn.started/turn.completed/turn.failed/item.completed/error;
  // ThreadItem variants agent_message/reasoning/command_execution/file_change/
  // mcp_tool_call/web_search).
  'codex-cli': {
    type: 'codex-cli',
    capabilities: {
      reportsUsage: true, // turn.completed.usage { input_tokens, output_tokens, cached_input_tokens }
      supportsStreaming: true, // --json (JSONL thread events)
      supportsToolUse: true, // autonomous built-in tools (exec/patch/mcp/web_search)
      toolUseMode: 'autonomous',
      supportsExtendedThinking: true, // emits reasoning ThreadItems → thinking-delta
      supportsCancellation: true, // SIGTERM
      supportsCapture: true, // full JSONL transcript
      supportsJsonMode: false, // codex exec has --output-schema, but the adapter doesn't wire it
      supportsSessionResume: false, // codex exec resume exists but not wired (v1.1)
    },
  },

  // Verified against the REAL `@aws-sdk/client-bedrock-runtime` v3.1076.0
  // ConverseStream API (BedrockRuntimeClient.send(ConverseStreamCommand) →
  // { stream: AsyncIterable<ConverseStreamOutput> }; the union carries
  // messageStart / contentBlockStart / contentBlockDelta / contentBlockStop /
  // messageStop / metadata). Chat-mode host-loop tool use via toolConfig.
  'bedrock-sdk': {
    type: 'bedrock-sdk',
    capabilities: {
      reportsUsage: true, // metadata.usage { inputTokens, outputTokens }
      supportsStreaming: true, // ConverseStreamCommand
      supportsToolUse: true, // host-loop: contentBlock toolUse surfaced as tool-call-*
      toolUseMode: 'host-loop',
      supportsExtendedThinking: true, // ContentBlockDelta.reasoningContent.text → thinking-delta
      supportsCancellation: true, // client.send(cmd, { abortSignal }) aborts the request
      supportsCapture: true,
      supportsJsonMode: false, // Converse uses tool-use for structured output (no response_format)
      supportsSessionResume: false,
    },
  },
};
