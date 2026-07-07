/**
 * ClaudeCodeCliAdapter unit tests.
 *
 * Mocks node:child_process.spawn (the repo fakeChild pattern) so no real
 * `claude` subprocess runs. Covers: spawn flags + cwd=workdir + sandbox env
 * ($HOME/$TMPDIR=workdir, injected ANTHROPIC_API_KEY) + stdin stream-json,
 * invoke=reduceStream parity over a real captured transcript, broker-based
 * credential injection, MissingCredentialError, and abort → 'aborted'.
 */

import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CapabilityMismatchError } from '../../errors.ts';
import type { AdapterDeps } from '../../registry.ts';
import { getAdapterFactory } from '../../registry.ts';
import type { AgentChunk } from '../../stream.ts';

// ---------------------------------------------------------------------------
// Mock node:child_process (spawn only)
// ---------------------------------------------------------------------------

const mockSpawn = vi.fn();
vi.mock('node:child_process', () => ({ spawn: mockSpawn }));

// ---------------------------------------------------------------------------
// fakeChild — mirrors the repo child-process.test pattern, captures stdin
// ---------------------------------------------------------------------------

type FakeChild = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  stdin: { end: ReturnType<typeof vi.fn>; write: ReturnType<typeof vi.fn>; on: () => void };
  kill: ReturnType<typeof vi.fn>;
  killed: boolean;
};

function fakeChild(stdoutLines: string[] = [], exitCode: number | null = 0): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { end: vi.fn(), write: vi.fn(), on: vi.fn() };
  child.killed = false;
  child.kill = vi.fn((signal?: string) => {
    child.killed = true;
    setImmediate(() => child.emit('close', exitCode, signal ?? 'SIGTERM'));
    return true;
  });

  setImmediate(() => {
    const output = stdoutLines.join('\n') + (stdoutLines.length > 0 ? '\n' : '');
    if (output) child.stdout.emit('data', Buffer.from(output));
    setImmediate(() => {
      child.stdout.emit('close');
      child.stderr.emit('close');
      setImmediate(() => child.emit('close', exitCode));
    });
  });

  return child;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const SIMPLE = readFileSync(join(FIXTURES, 'simple-text.jsonl'), 'utf8')
  .split('\n')
  .filter((l) => l.trim().length > 0);

// /bin/sh is a real executable on macOS + Linux, so resolveBinary (which uses
// the unmocked node:fs accessSync) returns it; spawn is then mocked.
const BIN = '/bin/sh';

function makeDeps(over?: Partial<AdapterDeps>): AdapterDeps {
  return {
    workdir: '/work/dir',
    repoRoot: '/work/dir',
    commit: 'abc123',
    branch: 'main',
    ...over,
  };
}

let savedKey: string | undefined;
beforeEach(() => {
  mockSpawn.mockReset();
  savedKey = process.env.ANTHROPIC_API_KEY;
});
afterEach(() => {
  if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = savedKey;
});

// ---------------------------------------------------------------------------
// Spawn contract: flags + cwd + sandbox env + stdin
// ---------------------------------------------------------------------------

describe('ClaudeCodeCliAdapter — spawn contract', () => {
  it('spawns claude with stream-json flags, cwd=workdir, sandbox env, and stdin', async () => {
    // Create the child lazily inside the spawn mock so its event listeners are
    // attached synchronously before fakeChild's setImmediate emits fire.
    let child!: ReturnType<typeof fakeChild>;
    mockSpawn.mockImplementation(() => {
      child = fakeChild(SIMPLE);
      return child;
    });
    const { ClaudeCodeCliAdapter } = await import('./index.ts');

    const adapter = new ClaudeCodeCliAdapter(
      { type: 'claude-code-cli', model: 'claude-sonnet-4-6', binaryPath: BIN },
      makeDeps(),
      'sk-test-key',
    );

    const chunks: AgentChunk[] = [];
    for await (const c of adapter.stream({ messages: [{ role: 'user', content: 'ping' }] })) {
      chunks.push(c);
    }

    expect(mockSpawn).toHaveBeenCalledTimes(1);
    const [binary, args, options] = mockSpawn.mock.calls[0] as [
      string,
      string[],
      { cwd: string; env: NodeJS.ProcessEnv },
    ];

    expect(binary).toBe(BIN);
    expect(args).toEqual([
      '--print',
      '--output-format',
      'stream-json',
      '--input-format',
      'stream-json',
      '--verbose',
      '--model',
      'claude-sonnet-4-6',
    ]);
    expect(options.cwd).toBe('/work/dir');
    // Sandbox: $HOME + $TMPDIR redirected to workdir; ANTHROPIC_API_KEY injected.
    expect(options.env.HOME).toBe('/work/dir');
    expect(options.env.TMPDIR).toBe('/work/dir');
    expect(options.env.ANTHROPIC_API_KEY).toBe('sk-test-key');

    // stdin received the conversation as stream-json then closed (EOF).
    expect(child.stdin.write).toHaveBeenCalledTimes(1);
    const written = child.stdin.write.mock.calls[0][0] as string;
    expect(JSON.parse(written.trim())).toEqual({
      type: 'user',
      message: { role: 'user', content: 'ping' },
    });
    expect(child.stdin.end).toHaveBeenCalled();
  });

  it('appends --system-prompt when the spec sets one', async () => {
    mockSpawn.mockImplementation(() => fakeChild(SIMPLE));
    const { ClaudeCodeCliAdapter } = await import('./index.ts');
    const adapter = new ClaudeCodeCliAdapter(
      {
        type: 'claude-code-cli',
        model: 'claude-sonnet-4-6',
        binaryPath: BIN,
        systemPrompt: 'You review code.',
      },
      makeDeps(),
      'sk-test-key',
    );
    for await (const _ of adapter.stream({ messages: [{ role: 'user', content: 'hi' }] })) {
      /* drain */
    }
    const args = mockSpawn.mock.calls[0][1] as string[];
    expect(args[args.indexOf('--system-prompt') + 1]).toBe('You review code.');
  });
});

// ---------------------------------------------------------------------------
// invoke = reduceStream(stream) parity over the real transcript
// ---------------------------------------------------------------------------

describe('ClaudeCodeCliAdapter — invoke/stream parity', () => {
  it('stream() yields text + usage + message-stop from a real transcript', async () => {
    mockSpawn.mockImplementation(() => fakeChild(SIMPLE));
    const { ClaudeCodeCliAdapter } = await import('./index.ts');
    const adapter = new ClaudeCodeCliAdapter(
      { type: 'claude-code-cli', model: 'm', binaryPath: BIN },
      makeDeps(),
      'sk',
    );
    const chunks: AgentChunk[] = [];
    for await (const c of adapter.stream({ messages: [{ role: 'user', content: 'ping' }] })) {
      chunks.push(c);
    }
    expect(chunks).toEqual([
      { type: 'text-delta', text: 'pong' },
      {
        type: 'usage',
        usage: { inputTokens: 3, outputTokens: 5, cacheReadTokens: 16094, cacheWriteTokens: 10144 },
      },
      { type: 'message-stop', finishReason: 'stop' },
    ]);
  });

  it('invoke() reduces the same stream to content="pong"', async () => {
    mockSpawn.mockImplementation(() => fakeChild(SIMPLE));
    const { ClaudeCodeCliAdapter } = await import('./index.ts');
    const adapter = new ClaudeCodeCliAdapter(
      { type: 'claude-code-cli', model: 'm', binaryPath: BIN },
      makeDeps(),
      'sk',
    );
    const result = await adapter.invoke({ messages: [{ role: 'user', content: 'ping' }] });
    expect(result.content).toBe('pong');
    expect(result.finishReason).toBe('stop');
    expect(result.usage?.outputTokens).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Abort
// ---------------------------------------------------------------------------

describe('ClaudeCodeCliAdapter — abort', () => {
  it('sends SIGTERM and ends with finishReason "aborted" when pre-aborted', async () => {
    let child!: ReturnType<typeof fakeChild>;
    mockSpawn.mockImplementation(() => {
      child = fakeChild([], null);
      return child;
    });
    const { ClaudeCodeCliAdapter } = await import('./index.ts');
    const adapter = new ClaudeCodeCliAdapter(
      { type: 'claude-code-cli', model: 'm', binaryPath: BIN },
      makeDeps(),
      'sk',
    );

    const ctrl = new AbortController();
    ctrl.abort();

    const chunks: AgentChunk[] = [];
    for await (const c of adapter.stream(
      { messages: [{ role: 'user', content: 'hi' }] },
      { signal: ctrl.signal },
    )) {
      chunks.push(c);
    }

    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(chunks.at(-1)).toEqual({ type: 'message-stop', finishReason: 'aborted' });
  });
});

// ---------------------------------------------------------------------------
// Credential resolution via the registered factory
// ---------------------------------------------------------------------------

describe('ClaudeCodeCliAdapter — auth', () => {
  it('factory throws MissingCredentialError when no key and no broker', async () => {
    await import('./index.ts'); // ensure self-registration ran
    delete process.env.ANTHROPIC_API_KEY;
    const factory = getAdapterFactory('claude-code-cli');
    expect(factory).toBeDefined();
    expect(() => factory?.factory({ type: 'claude-code-cli', model: 'm' }, makeDeps())).toThrow(
      /Anthropic API key/,
    );
  });

  it('injects the broker-resolved key as ANTHROPIC_API_KEY into the child env', async () => {
    mockSpawn.mockImplementation(() => fakeChild(SIMPLE));
    await import('./index.ts');
    delete process.env.ANTHROPIC_API_KEY;

    const factory = getAdapterFactory('claude-code-cli');
    const broker = { getCredential: vi.fn(async () => ({ apiKey: 'sk-from-broker' })) };
    const adapter = factory?.factory(
      { type: 'claude-code-cli', model: 'm', binaryPath: BIN },
      makeDeps({ credentialBroker: broker }),
    );

    for await (const _ of adapter!.stream({ messages: [{ role: 'user', content: 'hi' }] })) {
      /* drain */
    }
    expect(broker.getCredential).toHaveBeenCalledWith('anthropic');
    const options = mockSpawn.mock.calls[0][2] as { env: NodeJS.ProcessEnv };
    expect(options.env.ANTHROPIC_API_KEY).toBe('sk-from-broker');
  });
});

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------

describe('ClaudeCodeCliAdapter — capabilities', () => {
  it('reports the claude-code-cli capability matrix', async () => {
    mockSpawn.mockImplementation(() => fakeChild(SIMPLE));
    const { ClaudeCodeCliAdapter } = await import('./index.ts');
    const adapter = new ClaudeCodeCliAdapter(
      { type: 'claude-code-cli', model: 'm', binaryPath: BIN },
      makeDeps(),
      'sk',
    );
    expect(adapter.type).toBe('claude-code-cli');
    expect(adapter.capabilities.supportsStreaming).toBe(true);
    expect(adapter.capabilities.supportsToolUse).toBe(true);
    expect(adapter.capabilities.supportsJsonMode).toBe(false);
    expect(adapter.capabilities.supportsSessionResume).toBe(false);
  });
});

describe('ClaudeCodeCliAdapter — custom tools reject', () => {
  it('rejects host-injected custom tools with CapabilityMismatchError (autonomous CLI)', async () => {
    const { ClaudeCodeCliAdapter } = await import('./index.ts');
    const adapter = new ClaudeCodeCliAdapter(
      { type: 'claude-code-cli', model: 'm', binaryPath: BIN },
      makeDeps(),
      'sk',
    );
    await expect(
      adapter.invoke({ messages: [{ role: 'user', content: 'hi' }], tools: [{ name: 'f' }] }),
    ).rejects.toBeInstanceOf(CapabilityMismatchError);
    // No subprocess should be spawned — the reject is fail-fast.
    expect(mockSpawn).not.toHaveBeenCalled();
  });
});
