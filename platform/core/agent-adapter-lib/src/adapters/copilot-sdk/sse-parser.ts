/**
 * sse-parser.ts — OpenAI-style SSE → AgentChunk for the copilot-sdk adapter
 * (PRD §8.4 streaming).
 *
 * Copilot's streaming chat-completions response is Server-Sent Events: a
 * sequence of `data: {json}\n\n` frames terminated by `data: [DONE]`. Each JSON
 * payload mirrors OpenAI's chunk shape:
 *   choices[0].delta.content    → text-delta
 *   choices[0].delta.tool_calls → tool-call-start / tool-call-input / -end
 *   choices[0].finish_reason    → buffered → message-stop (emitted at flush)
 *   usage                       → usage (when stream_options.include_usage)
 *
 * The parser is incremental: `push(text)` accepts arbitrary decoded byte
 * fragments and returns the AgentChunks that became complete. `flush()` emits
 * any pending tool-call-end / usage / message-stop after the stream closes.
 */

import type { TokenUsage } from '../../agent.ts';
import type { AgentChunk } from '../../stream.ts';
import { mapFinishReason } from './normalize.ts';

// ---------------------------------------------------------------------------
// OpenAI streaming chunk shapes (inline)
// ---------------------------------------------------------------------------

interface OpenAiDeltaToolCall {
  index: number;
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
}

interface OpenAiStreamChoice {
  delta?: { content?: string | null; tool_calls?: OpenAiDeltaToolCall[] };
  finish_reason?: string | null;
}

interface OpenAiStreamChunk {
  choices?: OpenAiStreamChoice[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  } | null;
}

interface InProgressToolCall {
  toolCallId: string;
  toolName: string;
  argParts: string[];
}

// ---------------------------------------------------------------------------
// SseParser
// ---------------------------------------------------------------------------

export class SseParser {
  private buffer = '';
  /** tool_calls keyed by their streaming `index`. */
  private readonly toolCalls = new Map<number, InProgressToolCall>();
  private finishReason: string | null | undefined;
  private pendingUsage: TokenUsage | undefined;
  private sawAnyChunk = false;

  /** Feed a decoded text fragment; returns chunks that became complete. */
  push(text: string): AgentChunk[] {
    this.buffer += text;
    const out: AgentChunk[] = [];

    // SSE frames are separated by a blank line (\n\n or \r\n\r\n).
    let sep = this.findSeparator();
    while (sep) {
      const frame = this.buffer.slice(0, sep.index);
      this.buffer = this.buffer.slice(sep.index + sep.length);
      this.handleFrame(frame, out);
      sep = this.findSeparator();
    }
    return out;
  }

  /** Emit any buffered tool-call-end / usage / message-stop after stream close. */
  flush(): AgentChunk[] {
    const out: AgentChunk[] = [];
    // A final frame without a trailing blank line.
    if (this.buffer.trim().length > 0) {
      this.handleFrame(this.buffer, out);
      this.buffer = '';
    }
    this.finalize(out);
    return out;
  }

  // -------------------------------------------------------------------------

  private findSeparator(): { index: number; length: number } | undefined {
    const lf = this.buffer.indexOf('\n\n');
    const crlf = this.buffer.indexOf('\r\n\r\n');
    if (crlf !== -1 && (lf === -1 || crlf < lf)) return { index: crlf, length: 4 };
    if (lf !== -1) return { index: lf, length: 2 };
    return undefined;
  }

  private handleFrame(frame: string, out: AgentChunk[]): void {
    // A frame can contain multiple `data:` lines (plus comments / event:).
    for (const rawLine of frame.split('\n')) {
      const line = rawLine.replace(/\r$/, '');
      if (!line.startsWith('data:')) continue; // ignore comments, event:, id:
      const data = line.slice('data:'.length).trim();
      if (data.length === 0) continue;
      if (data === '[DONE]') {
        continue;
      }
      let chunk: OpenAiStreamChunk;
      try {
        chunk = JSON.parse(data) as OpenAiStreamChunk;
      } catch {
        continue; // skip malformed frames defensively
      }
      this.handleChunk(chunk, out);
    }
  }

  private handleChunk(chunk: OpenAiStreamChunk, out: AgentChunk[]): void {
    this.sawAnyChunk = true;

    const choice = chunk.choices?.[0];
    if (choice) {
      const delta = choice.delta;
      if (delta?.content) {
        out.push({ type: 'text-delta', text: delta.content });
      }
      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) this.handleToolCallDelta(tc, out);
      }
      if (choice.finish_reason) {
        this.finishReason = choice.finish_reason;
        // tool_calls are complete once a finish reason arrives — emit their ends
        // in streaming order so consumers see them before message-stop.
        this.emitToolCallEnds(out);
      }
    }

    if (chunk.usage) {
      this.pendingUsage = toTokenUsage(chunk.usage);
    }
  }

  private handleToolCallDelta(tc: OpenAiDeltaToolCall, out: AgentChunk[]): void {
    let entry = this.toolCalls.get(tc.index);
    if (!entry) {
      entry = {
        toolCallId: tc.id ?? `tool_${tc.index}`,
        toolName: tc.function?.name ?? '',
        argParts: [],
      };
      this.toolCalls.set(tc.index, entry);
      out.push({ type: 'tool-call-start', toolCallId: entry.toolCallId, toolName: entry.toolName });
    }
    const args = tc.function?.arguments;
    if (args) {
      entry.argParts.push(args);
      out.push({ type: 'tool-call-input', toolCallId: entry.toolCallId, partialInput: args });
    }
  }

  private emitToolCallEnds(out: AgentChunk[]): void {
    for (const entry of this.toolCalls.values()) {
      const joined = entry.argParts.join('');
      let input: unknown = {};
      if (joined.length > 0) {
        try {
          input = JSON.parse(joined);
        } catch {
          input = joined;
        }
      }
      out.push({ type: 'tool-call-end', toolCallId: entry.toolCallId, input });
    }
    this.toolCalls.clear();
  }

  private finalize(out: AgentChunk[]): void {
    // Any tool calls not closed by a finish_reason get closed now.
    this.emitToolCallEnds(out);
    if (this.pendingUsage !== undefined) {
      out.push({ type: 'usage', usage: this.pendingUsage });
      this.pendingUsage = undefined;
    }
    if (this.sawAnyChunk) {
      out.push({
        type: 'message-stop',
        finishReason: mapFinishReason(this.finishReason) ?? 'stop',
      });
    }
  }
}

function toTokenUsage(u: NonNullable<OpenAiStreamChunk['usage']>): TokenUsage {
  return {
    inputTokens: u.prompt_tokens ?? 0,
    outputTokens: u.completion_tokens ?? 0,
  };
}

/** Convenience: parse a complete SSE string into AgentChunks (for tests). */
export function parseSse(fullText: string): AgentChunk[] {
  const parser = new SseParser();
  return [...parser.push(fullText), ...parser.flush()];
}
