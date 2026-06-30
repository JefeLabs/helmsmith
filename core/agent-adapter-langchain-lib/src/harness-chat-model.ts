/**
 * HarnessChatModel — LangChain `BaseChatModel` that delegates to a platform
 * `AgentAdapter` (the NEW `@helmsmith/agent-adapter` surface).
 *
 * Lives in @helmsmith/agent-adapter-langchain so the @langchain/* dependency
 * stays OUT of the platform adapter library. When LangGraph runs inside
 * harness-server (coordinators) or harness-pipeline (sophisticated user
 * agents), graph nodes that need an LLM call go through the same adapter the
 * rest of the harness uses — so auth comes from the broker and model selection
 * respects the host's wiring.
 *
 * This wrapper makes the adapter LangChain-shaped: a `SimpleChatModel` subclass
 * any LangGraph node can `.invoke([HumanMessage(...)])` on. Internally it
 * flattens LangChain's multi-message conversation into an `AgentInput`; the
 * response text comes back from `AgentInvocationResult.content`.
 *
 * Changes from the pre-cut (old-surface) version:
 *   - `_call` now builds an `AgentInput` and reads `result.content` (was
 *     `adapter.invoke({ system, user })` → string).
 *   - `createHarnessChatModel` now constructs the adapter via the new
 *     `createAgent(CreateAgentArgs)` factory (the old `bindingToAdapter` path is
 *     gone). Callers that already hold an adapter use `new HarnessChatModel({
 *     adapter })` directly.
 *
 * Message flattening rules (unchanged):
 *   - All SystemMessages join with `\n\n` → `systemPrompt`.
 *   - HumanMessage / AIMessage / ToolMessage join with role labels
 *     ("User: …", "Assistant: …", "Tool: …") → a single user message.
 *   - A lone HumanMessage with no labels → its bare content as the user message.
 *
 * What this v1 does NOT do (deferred): streaming (`_streamResponseChunks`) and
 * native tool/function calling (SimpleChatModel returns plain text).
 */

import {
  type AgentAdapter,
  type AgentInput,
  type CreateAgentArgs,
  createAgent,
} from '@helmsmith/agent-adapter';
import {
  type BaseChatModelParams,
  SimpleChatModel,
} from '@langchain/core/language_models/chat_models';
import type { BaseMessage, MessageContent } from '@langchain/core/messages';

export interface HarnessChatModelOptions extends BaseChatModelParams {
  /** The AgentAdapter to delegate calls to (e.g. one built via `createAgent`). */
  adapter: AgentAdapter;
}

export class HarnessChatModel extends SimpleChatModel {
  private readonly adapter: AgentAdapter;

  constructor(options: HarnessChatModelOptions) {
    super(options);
    this.adapter = options.adapter;
  }

  _llmType(): string {
    return 'harness-chat-model';
  }

  /** SimpleChatModel asks for a string response; flatten messages → AgentInput,
   *  call adapter.invoke, return the result's content. */
  async _call(messages: BaseMessage[]): Promise<string> {
    const input = flattenMessages(messages);
    const result = await this.adapter.invoke(input);
    return result.content;
  }
}

/**
 * Build a HarnessChatModel by constructing the underlying adapter via the new
 * `createAgent` factory. Convenience for callers that have an `AgentSpec` (+ a
 * workdir / broker) and just want a LangChain-shaped model to plug into a graph.
 */
export interface CreateHarnessChatModelOptions extends CreateAgentArgs, BaseChatModelParams {}

export function createHarnessChatModel(opts: CreateHarnessChatModelOptions): HarnessChatModel {
  const { spec, workdir, credentialBroker, logger, signal, ...chatParams } = opts;
  const adapter = createAgent({ spec, workdir, credentialBroker, logger, signal });
  return new HarnessChatModel({ adapter, ...chatParams });
}

// ─── helpers ──────────────────────────────────────────────────────────────

/**
 * Flatten a LangChain message array into an `AgentInput`.
 *
 * Single-HumanMessage shortcut: when there's exactly one message and it's a
 * HumanMessage, return its bare content as the user message with no role label.
 * Multi-message: SystemMessages join into `systemPrompt`; everything else joins
 * with role labels into a single user message so the model sees who said what.
 */
function flattenMessages(messages: BaseMessage[]): AgentInput {
  if (messages.length === 1 && messages[0]!.getType() === 'human') {
    return { messages: [{ role: 'user', content: stringifyContent(messages[0]!.content) }] };
  }

  const systems: string[] = [];
  const others: string[] = [];
  for (const msg of messages) {
    const type = msg.getType();
    const content = stringifyContent(msg.content);
    if (type === 'system') {
      systems.push(content);
      continue;
    }
    const label =
      type === 'human'
        ? 'User'
        : type === 'ai'
          ? 'Assistant'
          : type === 'tool'
            ? 'Tool'
            : type === 'function'
              ? 'Function'
              : type;
    others.push(`${label}: ${content}`);
  }

  const input: AgentInput = {
    messages: [{ role: 'user', content: others.join('\n\n') }],
  };
  if (systems.length > 0) input.systemPrompt = systems.join('\n\n');
  return input;
}

/** LangChain MessageContent can be a string or an array of content parts
 *  (text/image/etc.). Adapters take strings, so flatten content-parts by
 *  joining text parts and JSON-stringifying any non-text. */
function stringifyContent(content: MessageContent): string {
  if (typeof content === 'string') return content;
  return content
    .map((part) => {
      if (typeof part === 'string') return part;
      if ('text' in part && typeof part.text === 'string') return part.text;
      return JSON.stringify(part);
    })
    .join('\n');
}
