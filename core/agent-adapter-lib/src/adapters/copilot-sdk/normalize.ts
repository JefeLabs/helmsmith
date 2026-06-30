/**
 * normalize.ts — AgentInput ↔ OpenAI (chat/completions) shape mapping for the
 * copilot-sdk adapter (PRD §8.4).
 *
 * Copilot's endpoint is OpenAI-compatible, so this maps the lib's normalized
 * AgentInput into an OpenAI request body and maps OpenAI finish reasons back
 * into the lib's finishReason. Pure functions — no I/O, no fetch.
 */

import type {
  AgentInput,
  AgentInvocationResult,
  ChatMessage,
  ToolDefinition,
} from '../../agent.ts';

// ---------------------------------------------------------------------------
// OpenAI request shapes (inline — no SDK dependency)
// ---------------------------------------------------------------------------

interface OpenAiToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface OpenAiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | null;
  tool_calls?: OpenAiToolCall[];
}

interface OpenAiTool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
}

type OpenAiToolChoice = 'auto' | 'none' | { type: 'function'; function: { name: string } };

export interface OpenAiRequestBody {
  model: string;
  messages: OpenAiMessage[];
  stream: boolean;
  stream_options?: { include_usage: boolean };
  tools?: OpenAiTool[];
  tool_choice?: OpenAiToolChoice;
}

// ---------------------------------------------------------------------------
// normalizeMessages — (systemPrompt + ChatMessage[]) → OpenAiMessage[]
// ---------------------------------------------------------------------------

/**
 * Build the OpenAI `messages` array. A resolved system prompt (input overrides
 * spec) is prepended as a `system` message.
 *
 * ContentBlock mapping:
 *   - text       → concatenated into the message `content` string
 *   - tool-use   → assistant `tool_calls` entry (OpenAI function-calling shape)
 *   - thinking   → skipped (assistant-only output; never re-sent)
 */
export function normalizeMessages(messages: ChatMessage[], systemPrompt?: string): OpenAiMessage[] {
  const out: OpenAiMessage[] = [];
  if (systemPrompt !== undefined && systemPrompt.length > 0) {
    out.push({ role: 'system', content: systemPrompt });
  }
  for (const msg of messages) {
    out.push(normalizeMessage(msg));
  }
  return out;
}

function normalizeMessage(msg: ChatMessage): OpenAiMessage {
  if (typeof msg.content === 'string') {
    return { role: msg.role, content: msg.content };
  }

  let text = '';
  const toolCalls: OpenAiToolCall[] = [];
  for (const block of msg.content) {
    switch (block.type) {
      case 'text':
        text += block.text;
        break;
      case 'tool-use':
        toolCalls.push({
          id: block.id,
          type: 'function',
          function: { name: block.name, arguments: JSON.stringify(block.input ?? {}) },
        });
        break;
      case 'thinking':
        // Thinking blocks are assistant-output only; never sent back upstream.
        break;
    }
  }

  const message: OpenAiMessage = {
    role: msg.role,
    content: text.length > 0 ? text : null,
  };
  if (toolCalls.length > 0) message.tool_calls = toolCalls;
  return message;
}

// ---------------------------------------------------------------------------
// normalizeTools — ToolDefinition[] → OpenAiTool[]
// ---------------------------------------------------------------------------

/** Convert the lib's ToolDefinition[] into OpenAI function-tool definitions. */
export function normalizeTools(tools: ToolDefinition[]): OpenAiTool[] {
  return tools.map((tool): OpenAiTool => {
    const fn: OpenAiTool['function'] = {
      name: tool.name,
      parameters: tool.inputSchema ?? { type: 'object', properties: {} },
    };
    if (tool.description !== undefined) fn.description = tool.description;
    return { type: 'function', function: fn };
  });
}

function normalizeToolChoice(choice: AgentInput['toolChoice']): OpenAiToolChoice | undefined {
  if (!choice) return undefined;
  if (choice === 'auto') return 'auto';
  if (choice === 'none') return 'none';
  return { type: 'function', function: { name: choice.name } };
}

// ---------------------------------------------------------------------------
// buildRequestBody — AgentInput + model → OpenAI request body
// ---------------------------------------------------------------------------

/**
 * Build the OpenAI chat-completions request body. `stream` is always true in
 * practice (the adapter streams under the hood and reduces for invoke), but it
 * is a parameter so callers/tests can build either shape. When streaming,
 * `stream_options.include_usage` is set so Copilot returns the usage block.
 */
export function buildRequestBody(
  input: AgentInput,
  model: string,
  systemPrompt: string | undefined,
  stream: boolean,
): OpenAiRequestBody {
  const body: OpenAiRequestBody = {
    model,
    messages: normalizeMessages(input.messages, systemPrompt),
    stream,
  };
  if (stream) body.stream_options = { include_usage: true };
  if (input.tools?.length) body.tools = normalizeTools(input.tools);
  const toolChoice = normalizeToolChoice(input.toolChoice);
  if (toolChoice !== undefined) body.tool_choice = toolChoice;
  return body;
}

// ---------------------------------------------------------------------------
// mapFinishReason — OpenAI finish_reason → AgentInvocationResult finishReason
// ---------------------------------------------------------------------------

/** Map an OpenAI `finish_reason` to the lib's normalized finishReason. */
export function mapFinishReason(
  reason: string | null | undefined,
): AgentInvocationResult['finishReason'] | undefined {
  if (!reason) return undefined;
  switch (reason) {
    case 'stop':
      return 'stop';
    case 'length':
      return 'length';
    case 'tool_calls':
    case 'function_call':
      return 'tool_use';
    case 'content_filter':
      return 'content_filter';
    default:
      return 'stop';
  }
}
