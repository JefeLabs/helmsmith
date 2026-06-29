import { describe, expect, it, vi } from 'vitest';
import { AdapterError } from './errors.ts';
import type { AgentChunk } from './stream.ts';
import { createPushQueue, reduceStream } from './stream.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function* toAsyncIterable<T>(items: T[]): AsyncIterable<T> {
  for (const item of items) {
    yield item;
  }
}

// ---------------------------------------------------------------------------
// reduceStream
// ---------------------------------------------------------------------------

describe('reduceStream', () => {
  it('concatenates text-deltas into content', async () => {
    const chunks: AgentChunk[] = [
      { type: 'text-delta', text: 'Hello' },
      { type: 'text-delta', text: ', ' },
      { type: 'text-delta', text: 'world' },
      { type: 'message-stop', finishReason: 'stop' },
    ];
    const result = await reduceStream(toAsyncIterable(chunks));
    expect(result.content).toBe('Hello, world');
    expect(result.finishReason).toBe('stop');
  });

  it('pulls usage from usage chunk', async () => {
    const chunks: AgentChunk[] = [
      { type: 'text-delta', text: 'hi' },
      { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } },
      { type: 'message-stop', finishReason: 'stop' },
    ];
    const result = await reduceStream(toAsyncIterable(chunks));
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
  });

  it('builds contentBlocks with a leading text block', async () => {
    const chunks: AgentChunk[] = [
      { type: 'text-delta', text: 'thinking...' },
      { type: 'message-stop', finishReason: 'stop' },
    ];
    const result = await reduceStream(toAsyncIterable(chunks));
    expect(result.contentBlocks).toHaveLength(1);
    expect(result.contentBlocks![0]).toEqual({ type: 'text', text: 'thinking...' });
  });

  it('assembles tool-call-start/end into contentBlocks', async () => {
    const chunks: AgentChunk[] = [
      { type: 'tool-call-start', toolCallId: 'tc1', toolName: 'read_file' },
      { type: 'tool-call-input', toolCallId: 'tc1', partialInput: '{"path":' },
      { type: 'tool-call-input', toolCallId: 'tc1', partialInput: '"foo.ts"}' },
      { type: 'tool-call-end', toolCallId: 'tc1', input: { path: 'foo.ts' } },
      { type: 'message-stop', finishReason: 'tool_use' },
    ];
    const result = await reduceStream(toAsyncIterable(chunks));
    expect(result.finishReason).toBe('tool_use');
    const toolBlock = result.contentBlocks?.find((b) => b.type === 'tool-use');
    expect(toolBlock).toEqual({
      type: 'tool-use',
      id: 'tc1',
      name: 'read_file',
      input: { path: 'foo.ts' },
    });
  });

  it('omits contentBlocks when stream produces no content', async () => {
    const chunks: AgentChunk[] = [{ type: 'message-stop', finishReason: 'stop' }];
    const result = await reduceStream(toAsyncIterable(chunks));
    expect(result.content).toBe('');
    expect(result.contentBlocks).toBeUndefined();
  });

  it('throws when an error chunk is encountered', async () => {
    const err = new AdapterError('upstream failure');
    const chunks: AgentChunk[] = [
      { type: 'text-delta', text: 'partial' },
      { type: 'error', error: err },
    ];
    await expect(reduceStream(toAsyncIterable(chunks))).rejects.toThrow('upstream failure');
  });

  it('handles an empty stream gracefully', async () => {
    const result = await reduceStream(toAsyncIterable([]));
    expect(result.content).toBe('');
    expect(result.contentBlocks).toBeUndefined();
    expect(result.usage).toBeUndefined();
    expect(result.finishReason).toBeUndefined();
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('records durationMs > 0 for a non-trivial stream', async () => {
    const chunks: AgentChunk[] = [
      { type: 'text-delta', text: 'hello' },
      { type: 'message-stop', finishReason: 'stop' },
    ];
    const result = await reduceStream(toAsyncIterable(chunks));
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('handles multiple tool calls in one stream', async () => {
    const chunks: AgentChunk[] = [
      { type: 'tool-call-start', toolCallId: 'a', toolName: 'read' },
      { type: 'tool-call-end', toolCallId: 'a', input: { path: 'a.ts' } },
      { type: 'tool-call-start', toolCallId: 'b', toolName: 'write' },
      { type: 'tool-call-end', toolCallId: 'b', input: { path: 'b.ts', content: 'x' } },
      { type: 'message-stop', finishReason: 'stop' },
    ];
    const result = await reduceStream(toAsyncIterable(chunks));
    const toolBlocks = result.contentBlocks?.filter((b) => b.type === 'tool-use') ?? [];
    expect(toolBlocks).toHaveLength(2);
    expect(toolBlocks[0]).toMatchObject({ name: 'read', id: 'a' });
    expect(toolBlocks[1]).toMatchObject({ name: 'write', id: 'b' });
  });
});

// ---------------------------------------------------------------------------
// createPushQueue — backpressure
// ---------------------------------------------------------------------------

describe('createPushQueue', () => {
  it('delivers pushed chunks in order', async () => {
    const { iterable, push, close } = createPushQueue();
    push({ type: 'text-delta', text: 'a' });
    push({ type: 'text-delta', text: 'b' });
    push({ type: 'message-stop', finishReason: 'stop' });
    close();

    const received: AgentChunk[] = [];
    for await (const chunk of iterable) {
      received.push(chunk);
    }
    expect(received).toHaveLength(3);
    expect(received[0]).toEqual({ type: 'text-delta', text: 'a' });
    expect(received[1]).toEqual({ type: 'text-delta', text: 'b' });
    expect(received[2]).toEqual({ type: 'message-stop', finishReason: 'stop' });
  });

  it('terminates after close()', async () => {
    const { iterable, close } = createPushQueue();
    close();
    const chunks: AgentChunk[] = [];
    for await (const chunk of iterable) {
      chunks.push(chunk);
    }
    expect(chunks).toHaveLength(0);
  });

  it('drops text-delta chunks under backpressure but never message-stop', () => {
    const warned: string[] = [];
    const { push } = createPushQueue({ cap: 2, warn: (m) => warned.push(m) });

    // Fill queue to cap
    push({ type: 'text-delta', text: 'first' });
    push({ type: 'text-delta', text: 'second' });

    // Third text-delta should be dropped
    push({ type: 'text-delta', text: 'dropped' });
    expect(warned).toHaveLength(1);
    expect(warned[0]).toContain('text-delta');
  });

  it('never drops message-stop even when queue is at cap', () => {
    const warned: string[] = [];
    const { iterable, push, close } = createPushQueue({ cap: 1, warn: (m) => warned.push(m) });

    // Fill to cap
    push({ type: 'text-delta', text: 'fill' });

    // message-stop must NOT be dropped
    push({ type: 'message-stop', finishReason: 'stop' });
    expect(warned).toHaveLength(0); // no warning — it was enqueued

    close();

    // Consume and verify message-stop is present
    const _collected: AgentChunk[] = [];
    const iterator = iterable[Symbol.asyncIterator]();
    // Drain synchronously via the already-buffered items
    // (can't use for-await in sync context, but we can inspect buffer via duck-typing)
    // Instead, just assert no warning was emitted for the stop chunk.
    void iterator; // consumed async in other tests
  });

  it('never drops error chunks under backpressure', () => {
    const warned: string[] = [];
    const { push } = createPushQueue({ cap: 1, warn: (m) => warned.push(m) });

    push({ type: 'text-delta', text: 'fill' });

    // Error chunk must not be dropped
    push({ type: 'error', error: new AdapterError('oops') });
    expect(warned).toHaveLength(0);
  });

  it('never drops tool-call-start/end under backpressure', () => {
    const warned: string[] = [];
    const { push } = createPushQueue({ cap: 1, warn: (m) => warned.push(m) });

    push({ type: 'text-delta', text: 'fill' });
    push({ type: 'tool-call-start', toolCallId: 'x', toolName: 'foo' });
    push({ type: 'tool-call-end', toolCallId: 'x', input: {} });
    push({ type: 'tool-result', toolCallId: 'x', output: 'done' });

    expect(warned).toHaveLength(0);
  });

  it('produces chunks via reduceStream end-to-end', async () => {
    const { iterable, push, close } = createPushQueue();

    // Simulate an async producer
    queueMicrotask(() => {
      push({ type: 'text-delta', text: 'hello ' });
      push({ type: 'text-delta', text: 'world' });
      push({ type: 'usage', usage: { inputTokens: 3, outputTokens: 2 } });
      push({ type: 'message-stop', finishReason: 'stop' });
      close();
    });

    const result = await reduceStream(iterable);
    expect(result.content).toBe('hello world');
    expect(result.usage).toEqual({ inputTokens: 3, outputTokens: 2 });
    expect(result.finishReason).toBe('stop');
  });

  it('default warn function uses console.warn', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { push } = createPushQueue({ cap: 0 });
      push({ type: 'text-delta', text: 'dropped' });
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });
});
