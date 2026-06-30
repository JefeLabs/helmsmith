/**
 * normalize.ts — request/response shape mapping for the gemini-sdk adapter.
 *
 * Converts the lib's AgentInput types into `@google/genai` request shapes:
 *   - ChatMessage[]   → Gemini `contents` (Content[] with role user|model)
 *   - ToolDefinition[] → Gemini tools ([{ functionDeclarations: [...] }])
 *   - systemPrompt    → config.systemInstruction (passed verbatim by index.ts)
 *
 * Provider FinishReason → the lib's normalized finishReason.
 *
 * Pure functions — no I/O. SDK shapes are inlined to keep the mapping portable
 * and avoid deep SDK type imports (the SDK is an optional peer dependency).
 */

import type { ChatMessage, ContentBlock, ToolDefinition } from '../../agent.ts';

// ---------------------------------------------------------------------------
// Gemini (@google/genai) shape aliases (inline — no SDK dependency)
// ---------------------------------------------------------------------------

/** Gemini `Part` — text, a predicted functionCall, or a functionResponse. */
export interface GeminiPart {
  text?: string;
  functionCall?: { id?: string; name?: string; args?: Record<string, unknown> };
  functionResponse?: { id?: string; name?: string; response: Record<string, unknown> };
}

/** Gemini `Content` — one message; role is 'user' or 'model'. */
export interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

/** Gemini `FunctionDeclaration` — JSON-Schema-described callable function. */
export interface GeminiFunctionDeclaration {
  name: string;
  description?: string;
  /** Standard JSON Schema (mutually exclusive with the SDK's `parameters`). */
  parametersJsonSchema?: Record<string, unknown>;
}

/** Gemini `Tool` — a function-declarations bundle. */
export interface GeminiTool {
  functionDeclarations: GeminiFunctionDeclaration[];
}

/** Gemini `ToolConfig` — controls how/whether the model calls functions. */
export interface GeminiToolConfig {
  functionCallingConfig: {
    mode: 'AUTO' | 'ANY' | 'NONE';
    allowedFunctionNames?: string[];
  };
}

// ---------------------------------------------------------------------------
// normalizeContents — ChatMessage[] → Gemini Content[]
// ---------------------------------------------------------------------------

/**
 * Convert the lib's ChatMessage array into Gemini `contents`.
 *
 * Role mapping: 'assistant' → 'model'; 'user' and 'tool' → 'user' (Gemini sends
 * functionResponse parts back in a user-role turn).
 * ContentBlock mapping:
 *   - text        → { text }
 *   - tool-use    → { functionCall: { id, name, args } }
 *   - tool-result → { functionResponse: { id, response: { output } } }
 *   - thinking    → skipped (assistant-only output; never re-sent)
 *
 * String content becomes a single text part. A message that maps to zero parts
 * (e.g. only thinking) gets a single empty text part so the request stays valid.
 */
export function normalizeContents(messages: ChatMessage[]): GeminiContent[] {
  return messages.map((msg): GeminiContent => {
    const role: 'user' | 'model' = msg.role === 'assistant' ? 'model' : 'user';
    if (typeof msg.content === 'string') {
      return { role, parts: [{ text: msg.content }] };
    }
    const parts: GeminiPart[] = [];
    for (const block of msg.content) {
      const mapped = normalizeContentBlock(block);
      if (mapped !== null) parts.push(mapped);
    }
    if (parts.length === 0) parts.push({ text: '' });
    return { role, parts };
  });
}

function normalizeContentBlock(block: ContentBlock): GeminiPart | null {
  switch (block.type) {
    case 'text':
      return { text: block.text };
    case 'tool-use':
      return {
        functionCall: {
          ...(block.id ? { id: block.id } : {}),
          name: block.name,
          args: (block.input as Record<string, unknown>) ?? {},
        },
      };
    case 'tool-result':
      return {
        functionResponse: {
          ...(block.toolCallId ? { id: block.toolCallId } : {}),
          response: { output: block.output },
        },
      };
    case 'thinking':
      // Thinking blocks are assistant-output only; never sent back to the API.
      return null;
  }
}

// ---------------------------------------------------------------------------
// normalizeTools — ToolDefinition[] → Gemini Tool[]
// ---------------------------------------------------------------------------

/**
 * Convert the lib's ToolDefinition[] into a single Gemini `tools` entry holding
 * all function declarations. The `inputSchema` is forwarded as standard JSON
 * Schema via `parametersJsonSchema` (defaults to an empty object schema).
 */
export function normalizeTools(tools: ToolDefinition[]): GeminiTool[] {
  return [
    {
      functionDeclarations: tools.map((tool): GeminiFunctionDeclaration => {
        const decl: GeminiFunctionDeclaration = {
          name: tool.name,
          parametersJsonSchema: tool.inputSchema ?? { type: 'object', properties: {} },
        };
        if (tool.description !== undefined) decl.description = tool.description;
        return decl;
      }),
    },
  ];
}

// ---------------------------------------------------------------------------
// normalizeToolChoice — AgentInput.toolChoice → Gemini toolConfig
// ---------------------------------------------------------------------------

/**
 * Map the lib's `toolChoice` into Gemini's `toolConfig.functionCallingConfig`:
 *   - 'auto'   → mode AUTO (the model decides whether to call a function);
 *   - 'none'   → mode NONE (never call a function);
 *   - { name } → mode ANY + allowedFunctionNames:[name] (force that function).
 */
export function normalizeToolChoice(choice: 'auto' | 'none' | { name: string }): GeminiToolConfig {
  if (choice === 'auto') return { functionCallingConfig: { mode: 'AUTO' } };
  if (choice === 'none') return { functionCallingConfig: { mode: 'NONE' } };
  return { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: [choice.name] } };
}

// ---------------------------------------------------------------------------
// mapFinishReason — Gemini FinishReason → AgentInvocationResult finishReason
// ---------------------------------------------------------------------------

/**
 * Map the Gemini `FinishReason` enum string to the lib's normalized finishReason.
 *
 * STOP → stop, MAX_TOKENS → length, the safety/recitation family →
 * content_filter, malformed/unexpected tool calls + OTHER → error.
 */
export function mapFinishReason(
  reason: string | null | undefined,
): 'stop' | 'length' | 'tool_use' | 'content_filter' | 'aborted' | 'error' | undefined {
  if (!reason) return undefined;
  switch (reason) {
    case 'STOP':
      return 'stop';
    case 'MAX_TOKENS':
      return 'length';
    case 'SAFETY':
    case 'RECITATION':
    case 'LANGUAGE':
    case 'BLOCKLIST':
    case 'PROHIBITED_CONTENT':
    case 'SPII':
    case 'IMAGE_SAFETY':
    case 'IMAGE_PROHIBITED_CONTENT':
    case 'IMAGE_RECITATION':
      return 'content_filter';
    case 'MALFORMED_FUNCTION_CALL':
    case 'UNEXPECTED_TOOL_CALL':
    case 'OTHER':
      return 'error';
    default:
      // Unknown/future finish reasons must not be masked as a clean stop.
      return 'error';
  }
}
