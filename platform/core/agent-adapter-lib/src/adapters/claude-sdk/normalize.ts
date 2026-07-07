/**
 * normalize.ts — request/response shape mapping for the claude-sdk adapter.
 *
 * Converts the lib's AgentInput types into Anthropic SDK request shapes.
 * Does NOT import anything from @anthropic-ai/sdk types directly to keep
 * the shape mapping pure; SDK types are inlined as inline interfaces where
 * needed, or the SDK types are imported explicitly for the return value.
 */

import type { ChatMessage, ContentBlock, ToolDefinition } from '../../agent.ts';

// ---------------------------------------------------------------------------
// Anthropic SDK shape aliases (inline — avoids deep SDK import paths)
// ---------------------------------------------------------------------------

/** Anthropic SDK TextBlockParam (inline for portability) */
interface SdkTextBlock {
  type: 'text';
  text: string;
}

/** Anthropic SDK ToolUseBlockParam (inline) */
interface SdkToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: unknown;
}

/** Anthropic SDK ToolResultBlockParam (inline) */
interface SdkToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content?: string;
}

/** Anthropic SDK ImageBlockParam (inline, placeholder for future support) */
interface SdkImageBlock {
  type: 'image';
  source: {
    type: 'base64';
    media_type: string;
    data: string;
  };
}

type SdkContentBlock = SdkTextBlock | SdkToolUseBlock | SdkToolResultBlock | SdkImageBlock;

/** Anthropic SDK MessageParam */
export interface SdkMessageParam {
  role: 'user' | 'assistant';
  content: string | SdkContentBlock[];
}

/** Anthropic SDK Tool */
export interface SdkTool {
  name: string;
  description?: string;
  input_schema: {
    type: 'object';
    properties?: Record<string, unknown>;
    required?: string[];
    [key: string]: unknown;
  };
}

// ---------------------------------------------------------------------------
// normalizeMessages — ChatMessage[] → SdkMessageParam[]
// ---------------------------------------------------------------------------

/**
 * Convert the lib's ChatMessage array into Anthropic SDK MessageParam format.
 *
 * Role mapping: 'assistant' → 'assistant'; 'user' and 'tool' → 'user' (Anthropic
 * has no dedicated tool role — tool results ride back in a user-role message).
 *
 * ContentBlock mapping:
 *   - text        → { type: 'text', text }
 *   - tool-use    → { type: 'tool_use', id, name, input }
 *   - tool-result → { type: 'tool_result', tool_use_id, content }
 *   - thinking    → skipped (thinking is assistant output; not re-sent to API)
 *
 * String content passes through unchanged (SDK accepts string directly).
 */
export function normalizeMessages(messages: ChatMessage[]): SdkMessageParam[] {
  return messages.map((msg): SdkMessageParam => {
    const role: SdkMessageParam['role'] = msg.role === 'assistant' ? 'assistant' : 'user';
    if (typeof msg.content === 'string') {
      return { role, content: msg.content };
    }
    const sdkBlocks: SdkContentBlock[] = [];
    for (const block of msg.content) {
      const mapped = normalizeContentBlock(block);
      if (mapped !== null) sdkBlocks.push(mapped);
    }
    // If all blocks were filtered (e.g., only thinking blocks), fall back to empty text
    // so the SDK receives a valid message.
    if (sdkBlocks.length === 0) {
      return { role, content: '' };
    }
    return { role, content: sdkBlocks };
  });
}

function normalizeContentBlock(block: ContentBlock): SdkContentBlock | null {
  switch (block.type) {
    case 'text':
      return { type: 'text', text: block.text };
    case 'tool-use':
      return { type: 'tool_use', id: block.id, name: block.name, input: block.input };
    case 'tool-result':
      return { type: 'tool_result', tool_use_id: block.toolCallId, content: block.output };
    case 'thinking':
      // Thinking blocks are assistant-output only; never sent back to the API.
      return null;
  }
}

// ---------------------------------------------------------------------------
// normalizeTools — ToolDefinition[] → SdkTool[]
// ---------------------------------------------------------------------------

/**
 * Convert the lib's ToolDefinition array into Anthropic SDK Tool format.
 *
 * The inputSchema is treated as a JSON Schema object. If absent, defaults
 * to an empty object schema.
 */
export function normalizeTools(tools: ToolDefinition[]): SdkTool[] {
  return tools.map(
    (tool): SdkTool => ({
      name: tool.name,
      ...(tool.description !== undefined ? { description: tool.description } : {}),
      input_schema: {
        type: 'object',
        ...(tool.inputSchema ?? {}),
      },
    }),
  );
}

// ---------------------------------------------------------------------------
// mapStopReason — SDK stop_reason → AgentInvocationResult finishReason
// ---------------------------------------------------------------------------

/**
 * Map the Anthropic SDK's stop_reason string to our normalized finishReason.
 */
export function mapStopReason(
  stopReason: string | null | undefined,
): 'stop' | 'length' | 'tool_use' | 'content_filter' | 'aborted' | 'error' | undefined {
  if (!stopReason) return undefined;
  switch (stopReason) {
    case 'end_turn':
      return 'stop';
    case 'max_tokens':
      return 'length';
    case 'tool_use':
      return 'tool_use';
    case 'stop_sequence':
      return 'stop';
    default:
      return 'error';
  }
}
