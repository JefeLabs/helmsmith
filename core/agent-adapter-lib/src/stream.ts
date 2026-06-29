/**
 * AgentChunk union + stream reduction (PRD §7 chunk taxonomy, §10).
 *
 * Three responsibilities:
 *   1. AgentChunk — the normalized event union every adapter emits.
 *   2. reduceStream — accumulates an AsyncIterable<AgentChunk> into a full
 *      AgentInvocationResult (how invoke() is implemented from stream()).
 *   3. createPushQueue — a backpressure-aware push-driven AsyncIterable (cap
 *      1000, drops text-deltas under pressure, never drops tool/stop/error).
 */

import type { AgentInvocationResult, ContentBlock, TokenUsage } from './agent.ts';
import type { AdapterError } from './errors.ts';

// ---------------------------------------------------------------------------
// AgentChunk union (PRD §7)
// ---------------------------------------------------------------------------

export type AgentChunk =
  | { type: 'text-delta'; text: string }
  | { type: 'thinking-delta'; text: string }
  | { type: 'tool-call-start'; toolCallId: string; toolName: string }
  | { type: 'tool-call-input'; toolCallId: string; partialInput: string }
  | { type: 'tool-call-end'; toolCallId: string; input: unknown }
  | { type: 'tool-result'; toolCallId: string; output: unknown }
  | { type: 'message-stop'; finishReason: AgentInvocationResult['finishReason'] }
  | { type: 'usage'; usage: TokenUsage }
  | { type: 'error'; error: AdapterError };

// ---------------------------------------------------------------------------
// reduceStream — stream → AgentInvocationResult (PRD §10)
// ---------------------------------------------------------------------------

/** Chunk types that are never dropped under backpressure. */
const NEVER_DROP: ReadonlySet<AgentChunk['type']> = new Set([
  'tool-call-start',
  'tool-call-input',
  'tool-call-end',
  'tool-result',
  'message-stop',
  'usage',
  'error',
]);

interface InProgressToolCall {
  name: string;
  inputParts: string[];
}

/**
 * Accumulate an async stream of AgentChunk into an AgentInvocationResult.
 * This is the canonical implementation of `invoke` from `stream`:
 *   - text-deltas → `content` (concatenated)
 *   - tool-call-start/end → `contentBlocks` (tool-use blocks)
 *   - message-stop → `finishReason`
 *   - usage → `usage`
 *   - error chunk → throws the embedded AdapterError
 *
 * Guarantees: `invoke` and `stream` produce identical end-states for the
 * same input (PRD §10 parity requirement).
 */
export async function reduceStream(
  chunks: AsyncIterable<AgentChunk>,
): Promise<AgentInvocationResult> {
  const start = Date.now();
  let content = '';
  const contentBlocks: ContentBlock[] = [];
  let usage: TokenUsage | undefined;
  let finishReason: AgentInvocationResult['finishReason'];

  const inProgress = new Map<string, InProgressToolCall>();

  for await (const chunk of chunks) {
    switch (chunk.type) {
      case 'text-delta':
        content += chunk.text;
        break;

      case 'thinking-delta':
        // Tracked in the stream but not concatenated into text content.
        break;

      case 'tool-call-start':
        inProgress.set(chunk.toolCallId, { name: chunk.toolName, inputParts: [] });
        break;

      case 'tool-call-input': {
        const tc = inProgress.get(chunk.toolCallId);
        if (tc) tc.inputParts.push(chunk.partialInput);
        break;
      }

      case 'tool-call-end': {
        const tc = inProgress.get(chunk.toolCallId);
        if (tc) {
          contentBlocks.push({
            type: 'tool-use',
            id: chunk.toolCallId,
            name: tc.name,
            input: chunk.input,
          });
          inProgress.delete(chunk.toolCallId);
        }
        break;
      }

      case 'tool-result':
        // Tool results are surfaced for observability; not accumulated into
        // contentBlocks (those belong to the following assistant turn).
        break;

      case 'usage':
        usage = chunk.usage;
        break;

      case 'message-stop':
        finishReason = chunk.finishReason;
        break;

      case 'error':
        throw chunk.error;
    }
  }

  if (content) {
    contentBlocks.unshift({ type: 'text', text: content });
  }

  return {
    content,
    ...(contentBlocks.length > 0 ? { contentBlocks } : {}),
    ...(usage !== undefined ? { usage } : {}),
    ...(finishReason !== undefined ? { finishReason } : {}),
    durationMs: Date.now() - start,
  };
}

// ---------------------------------------------------------------------------
// createPushQueue — backpressure-aware AsyncIterable factory (PRD §10)
// ---------------------------------------------------------------------------

export interface PushQueueHandle {
  /** The iterable side — pass to consumers. */
  iterable: AsyncIterable<AgentChunk>;
  /** Producer pushes chunks here. Drops text-delta under backpressure. */
  push(chunk: AgentChunk): void;
  /** Signal end-of-stream to the consumer. */
  close(): void;
}

/**
 * Create a push-driven AsyncIterable with backpressure protection.
 *
 * Cap defaults to 1000. When the buffer is full:
 *   - text-delta and thinking-delta chunks are dropped with a warning.
 *   - All other chunk types (tool-call-*, message-stop, usage, error) are
 *     NEVER dropped — they are always enqueued regardless of buffer size.
 */
export function createPushQueue(opts?: {
  cap?: number;
  warn?: (msg: string) => void;
}): PushQueueHandle {
  const cap = opts?.cap ?? 1000;
  const warn = opts?.warn ?? ((m: string) => console.warn(m));

  const buffer: AgentChunk[] = [];
  let waitResolve: (() => void) | null = null;
  let closed = false;

  const iterable: AsyncIterable<AgentChunk> = {
    [Symbol.asyncIterator]() {
      return {
        async next(): Promise<IteratorResult<AgentChunk>> {
          // eslint-disable-next-line no-constant-condition
          while (true) {
            if (buffer.length > 0) {
              return { value: buffer.shift()!, done: false };
            }
            if (closed) {
              return { value: undefined as unknown as AgentChunk, done: true };
            }
            await new Promise<void>((resolve) => {
              waitResolve = resolve;
            });
          }
        },
      };
    },
  };

  function push(chunk: AgentChunk): void {
    if (closed) return;
    if (buffer.length >= cap && !NEVER_DROP.has(chunk.type)) {
      warn(`[agent-adapter] backpressure: dropping ${chunk.type} chunk (queue at ${cap})`);
      return;
    }
    buffer.push(chunk);
    if (waitResolve) {
      const r = waitResolve;
      waitResolve = null;
      r();
    }
  }

  function close(): void {
    closed = true;
    if (waitResolve) {
      const r = waitResolve;
      waitResolve = null;
      r();
    }
  }

  return { iterable, push, close };
}
