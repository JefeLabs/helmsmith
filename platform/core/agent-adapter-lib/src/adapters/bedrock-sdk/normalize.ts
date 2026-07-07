/**
 * normalize.ts — AgentInput ↔ AWS Bedrock Converse shape mapping for the
 * bedrock-sdk adapter (Phase D⁗b).
 *
 * Maps the lib's normalized AgentInput into a Bedrock `ConverseStreamCommand`
 * request (modelId / messages / system / toolConfig / inferenceConfig) and maps
 * the Converse `stopReason` back into the lib's finishReason. Pure functions —
 * no I/O, no SDK dependency (request shapes are inlined so the AWS SDK stays an
 * optional peer dependency).
 *
 * Verified against `@aws-sdk/client-bedrock-runtime` v3.1076.0:
 *   - Message            = { role: 'user' | 'assistant'; content: ContentBlock[] }
 *   - ContentBlock       = { text } | { toolUse } | { toolResult } | …  (union)
 *   - SystemContentBlock = { text } | …
 *   - Tool               = { toolSpec: { name, description?, inputSchema: { json } } }
 *   - ToolChoice         = { auto } | { any } | { tool: { name } }
 *   - StopReason enum    = end_turn | stop_sequence | max_tokens | tool_use |
 *                          content_filtered | guardrail_intervened | …
 */

import type { AgentInput, ChatMessage, ToolDefinition } from '../../agent.ts';

// ---------------------------------------------------------------------------
// Bedrock Converse request shapes (inline — no SDK dependency)
// ---------------------------------------------------------------------------

/** A Bedrock Converse content block (request side; subset the adapter emits). */
export type BedrockContentBlock =
  | { text: string }
  | { toolUse: { toolUseId: string; name: string; input: unknown } }
  | { toolResult: { toolUseId: string; content: { text: string }[] } };

/** A Bedrock Converse message — role + ordered content blocks. */
export interface BedrockMessage {
  role: 'user' | 'assistant';
  content: BedrockContentBlock[];
}

/** A Bedrock Converse system block (text-only subset). */
export interface BedrockSystemBlock {
  text: string;
}

/** A Bedrock Converse tool — `toolSpec` with a JSON-Schema `inputSchema.json`. */
export interface BedrockTool {
  toolSpec: {
    name: string;
    description?: string;
    inputSchema: { json: Record<string, unknown> };
  };
}

/** A Bedrock Converse tool-choice directive. */
export type BedrockToolChoice =
  | { auto: Record<string, never> }
  | { any: Record<string, never> }
  | { tool: { name: string } };

/** A Bedrock Converse tool configuration. */
export interface BedrockToolConfig {
  tools: BedrockTool[];
  toolChoice?: BedrockToolChoice;
}

/** The subset of `ConverseStreamCommandInput` the adapter populates. */
export interface BedrockConverseRequest {
  modelId: string;
  messages: BedrockMessage[];
  system?: BedrockSystemBlock[];
  toolConfig?: BedrockToolConfig;
  inferenceConfig?: { maxTokens?: number };
}

/** Default max output tokens — Converse requires a positive value for some models. */
export const DEFAULT_MAX_TOKENS = 4096;

// ---------------------------------------------------------------------------
// normalizeMessages — ChatMessage[] → Bedrock Message[]
// ---------------------------------------------------------------------------

/**
 * Convert the lib's ChatMessage array into Bedrock Converse `messages`.
 *
 * Role mapping: 'assistant' → 'assistant'; 'user' and 'tool' → 'user' (Converse
 * keeps the system prompt in a separate `system` field — never as a message
 * role — and tool results ride back in a user-role message).
 *
 * ContentBlock mapping:
 *   - text        → { text }
 *   - tool-use    → { toolUse: { toolUseId, name, input } }
 *   - tool-result → { toolResult: { toolUseId, content: [{ text }] } }
 *   - thinking    → skipped (assistant-only output; never re-sent upstream)
 *
 * A message that maps to zero blocks (e.g. only thinking) gets a single empty
 * text block so the Converse request stays valid (content must be non-empty).
 */
export function normalizeMessages(messages: ChatMessage[]): BedrockMessage[] {
  return messages.map((msg): BedrockMessage => {
    const role: 'user' | 'assistant' = msg.role === 'assistant' ? 'assistant' : 'user';
    if (typeof msg.content === 'string') {
      return { role, content: [{ text: msg.content }] };
    }
    const content: BedrockContentBlock[] = [];
    for (const block of msg.content) {
      switch (block.type) {
        case 'text':
          content.push({ text: block.text });
          break;
        case 'tool-use':
          content.push({
            toolUse: { toolUseId: block.id, name: block.name, input: block.input ?? {} },
          });
          break;
        case 'tool-result':
          content.push({
            toolResult: { toolUseId: block.toolCallId, content: [{ text: block.output }] },
          });
          break;
        case 'thinking':
          // Thinking blocks are assistant-output only; never sent back upstream.
          break;
      }
    }
    if (content.length === 0) content.push({ text: '' });
    return { role, content };
  });
}

// ---------------------------------------------------------------------------
// normalizeSystem — systemPrompt → Bedrock SystemContentBlock[]
// ---------------------------------------------------------------------------

/** Build the Converse `system` array from a resolved system prompt. */
export function normalizeSystem(
  systemPrompt: string | undefined,
): BedrockSystemBlock[] | undefined {
  if (systemPrompt === undefined || systemPrompt.length === 0) return undefined;
  return [{ text: systemPrompt }];
}

// ---------------------------------------------------------------------------
// normalizeTools — ToolDefinition[] → Bedrock Tool[]
// ---------------------------------------------------------------------------

/**
 * Convert the lib's ToolDefinition[] into Bedrock `toolConfig.tools`. The
 * `inputSchema` is forwarded as standard JSON Schema via `inputSchema.json`
 * (defaults to an empty object schema).
 */
export function normalizeTools(tools: ToolDefinition[]): BedrockTool[] {
  return tools.map((tool): BedrockTool => {
    const toolSpec: BedrockTool['toolSpec'] = {
      name: tool.name,
      inputSchema: { json: tool.inputSchema ?? { type: 'object', properties: {} } },
    };
    if (tool.description !== undefined) toolSpec.description = tool.description;
    return { toolSpec };
  });
}

function normalizeToolChoice(choice: AgentInput['toolChoice']): BedrockToolChoice | undefined {
  if (!choice) return undefined;
  // Converse has no 'none' — omit toolChoice (the model simply may not call a tool).
  if (choice === 'none') return undefined;
  if (choice === 'auto') return { auto: {} };
  return { tool: { name: choice.name } };
}

// ---------------------------------------------------------------------------
// buildToolConfig — AgentInput tools + toolChoice → Bedrock toolConfig
// ---------------------------------------------------------------------------

/** Build the Converse `toolConfig` when the input carries tools. */
export function buildToolConfig(input: AgentInput): BedrockToolConfig | undefined {
  if (!input.tools?.length) return undefined;
  const config: BedrockToolConfig = { tools: normalizeTools(input.tools) };
  const toolChoice = normalizeToolChoice(input.toolChoice);
  if (toolChoice !== undefined) config.toolChoice = toolChoice;
  return config;
}

// ---------------------------------------------------------------------------
// buildRequest — AgentInput + model → Bedrock ConverseStream request
// ---------------------------------------------------------------------------

/** Build the Converse(Stream) request body for the given input + model. */
export function buildRequest(
  input: AgentInput,
  model: string,
  systemPrompt: string | undefined,
): BedrockConverseRequest {
  const request: BedrockConverseRequest = {
    modelId: model,
    messages: normalizeMessages(input.messages),
    inferenceConfig: { maxTokens: DEFAULT_MAX_TOKENS },
  };
  const system = normalizeSystem(systemPrompt);
  if (system !== undefined) request.system = system;
  const toolConfig = buildToolConfig(input);
  if (toolConfig !== undefined) request.toolConfig = toolConfig;
  return request;
}

// ---------------------------------------------------------------------------
// mapStopReason — Bedrock StopReason → AgentInvocationResult finishReason
// ---------------------------------------------------------------------------

/**
 * Map the Converse `stopReason` string to the lib's normalized finishReason.
 *
 * end_turn / stop_sequence → stop, max_tokens → length, tool_use → tool_use,
 * content_filtered / guardrail_intervened → content_filter, the malformed /
 * context-window family → error.
 */
export function mapStopReason(
  reason: string | null | undefined,
): 'stop' | 'length' | 'tool_use' | 'content_filter' | 'aborted' | 'error' | undefined {
  if (!reason) return undefined;
  switch (reason) {
    case 'end_turn':
    case 'stop_sequence':
      return 'stop';
    case 'max_tokens':
      return 'length';
    case 'tool_use':
      return 'tool_use';
    case 'content_filtered':
    case 'guardrail_intervened':
      return 'content_filter';
    case 'malformed_model_output':
    case 'malformed_tool_use':
    case 'model_context_window_exceeded':
      return 'error';
    default:
      return 'stop';
  }
}
