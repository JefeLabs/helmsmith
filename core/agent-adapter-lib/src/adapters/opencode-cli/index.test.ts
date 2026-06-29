/**
 * OpenCodeCliAdapter unit tests.
 *
 * Mocks node:child_process.spawn (the repo fakeChild pattern) so no real
 * `opencode` subprocess runs. Covers: spawn flags + cwd=workdir + sandbox env
 * ($HOME/$TMPDIR=workdir, XDG_CONFIG_HOME, OPENCODE_DISABLE_MCP, injected
 * provider key) + prompt positional, invoke=reduceStream parity over a real
 * captured transcript, broker-based credential injection, MissingCredentialError,
 * unsupported-provider ConfigError, the local-endpoint + --attach modes, and
 * abort → 'aborted'.
 */

import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigError } from '../../errors.ts';
import type { AdapterDeps } from '../../registry.ts';
import { getAdapterFactory } from '../../registry.ts';
import type { AgentChunk } from '../../stream.ts';

const mockSpawn = vi.fn();
vi.mock('node:child_process', () => ({ spawn: mockSpawn }));

// ---------------------------------------------------------------------------
// fakeChild — mirrors the repo child-process.test pattern
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

// /bin/sh is a real executable, so resolveBinary returns it; spawn is mocked.
const BIN = '/bin/sh';

function makeDeps(over?: Partial<AdapterDeps>): AdapterDeps {
  return { workdir: '/work/dir', repoRoot: '/work/dir', commit: 'abc123', branch: 'main', ...over };
}

let savedAnthropic: string | undefined;
let savedOpenai: string | undefined;
beforeEach(() => {
  mockSpawn.mockReset();
  savedAnthropic = process.env.ANTHROPIC_API_KEY;
  savedOpenai = process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.OPENAI_API_KEY;
});
afterEach(() => {
  if (savedAnthropic === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = savedAnthropic;
  if (savedOpenai === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = savedOpenai;
});

// ---------------------------------------------------------------------------
// Spawn contract: flags + cwd + sandbox env + prompt positional
// ---------------------------------------------------------------------------

describe('OpenCodeCliAdapter — spawn contract', () => {
  it('spawns opencode run --format json with cwd=workdir, sandbox env, and prompt positional', async () => {
    mockSpawn.mockImplementation(() => fakeChild(SIMPLE));
    const { OpenCodeCliAdapter } = await import('./index.ts');

    const adapter = new OpenCodeCliAdapter(
      { type: 'opencode-cli', model: 'anthropic/claude-opus-4-7', binaryPath: BIN },
      makeDeps(),
      'sk-test-key',
    );

    for await (const _ of adapter.stream({ messages: [{ role: 'user', content: 'ping' }] })) {
      /* drain */
    }

    expect(mockSpawn).toHaveBeenCalledTimes(1);
    const [binary, args, options] = mockSpawn.mock.calls[0] as [
      string,
      string[],
      { cwd: string; env: NodeJS.ProcessEnv },
    ];

    expect(binary).toBe(BIN);
    expect(args).toEqual([
      'run',
      '--format',
      'json',
      '--pure',
      '--thinking',
      '--model',
      'anthropic/claude-opus-4-7',
      'ping',
    ]);
    expect(options.cwd).toBe('/work/dir');
    expect(options.env.HOME).toBe('/work/dir');
    expect(options.env.TMPDIR).toBe('/work/dir');
    expect(options.env.OPENCODE_DISABLE_MCP).toBe('1');
    expect(typeof options.env.XDG_CONFIG_HOME).toBe('string');
    expect(options.env.ANTHROPIC_API_KEY).toBe('sk-test-key');
  });

  it('prepends the system prompt to the positional prompt', async () => {
    mockSpawn.mockImplementation(() => fakeChild(SIMPLE));
    const { OpenCodeCliAdapter } = await import('./index.ts');
    const adapter = new OpenCodeCliAdapter(
      {
        type: 'opencode-cli',
        model: 'anthropic/claude-opus-4-7',
        binaryPath: BIN,
        systemPrompt: 'You review code.',
      },
      makeDeps(),
      'sk',
    );
    for await (const _ of adapter.stream({ messages: [{ role: 'user', content: 'hi' }] })) {
      /* drain */
    }
    const args = mockSpawn.mock.calls[0][1] as string[];
    expect(args.at(-1)).toBe('You review code.\n\nhi');
  });
});

// ---------------------------------------------------------------------------
// invoke = reduceStream(stream) parity over the real transcript
// ---------------------------------------------------------------------------

describe('OpenCodeCliAdapter — invoke/stream parity', () => {
  it('stream() yields text + usage + message-stop from a real transcript', async () => {
    mockSpawn.mockImplementation(() => fakeChild(SIMPLE));
    const { OpenCodeCliAdapter } = await import('./index.ts');
    const adapter = new OpenCodeCliAdapter(
      { type: 'opencode-cli', model: 'anthropic/m', binaryPath: BIN },
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
        usage: { inputTokens: 6226, outputTokens: 7, cacheReadTokens: 0, cacheWriteTokens: 0 },
      },
      { type: 'message-stop', finishReason: 'stop' },
    ]);
  });

  it('invoke() reduces the same stream to content="pong"', async () => {
    mockSpawn.mockImplementation(() => fakeChild(SIMPLE));
    const { OpenCodeCliAdapter } = await import('./index.ts');
    const adapter = new OpenCodeCliAdapter(
      { type: 'opencode-cli', model: 'anthropic/m', binaryPath: BIN },
      makeDeps(),
      'sk',
    );
    const result = await adapter.invoke({ messages: [{ role: 'user', content: 'ping' }] });
    expect(result.content).toBe('pong');
    expect(result.finishReason).toBe('stop');
    expect(result.usage?.outputTokens).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// Local-endpoint + attach modes (ported from the old flat adapter)
// ---------------------------------------------------------------------------

describe('OpenCodeCliAdapter — local-endpoint mode', () => {
  it('skips credential injection and prefixes the local provider id', async () => {
    mockSpawn.mockImplementation(() => fakeChild(SIMPLE));
    const { OpenCodeCliAdapter } = await import('./index.ts');
    // No apiKey, no broker — local mode needs neither.
    const adapter = new OpenCodeCliAdapter(
      {
        type: 'opencode-cli',
        model: 'qwen3-coder',
        binaryPath: BIN,
        endpoint: 'http://agent-llm:8080/v1',
      },
      makeDeps(),
      'no-auth-required',
    );
    for await (const _ of adapter.stream({ messages: [{ role: 'user', content: 'hi' }] })) {
      /* drain */
    }
    const args = mockSpawn.mock.calls[0][1] as string[];
    expect(args[args.indexOf('--model') + 1]).toBe('local/qwen3-coder');
    const env = (mockSpawn.mock.calls[0][2] as { env: NodeJS.ProcessEnv }).env;
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.OPENAI_API_KEY).toBeUndefined();
  });
});

describe('OpenCodeCliAdapter — attach mode', () => {
  it('adds --attach <url> and --dir <workdir>', async () => {
    mockSpawn.mockImplementation(() => fakeChild(SIMPLE));
    const { OpenCodeCliAdapter } = await import('./index.ts');
    const adapter = new OpenCodeCliAdapter(
      {
        type: 'opencode-cli',
        model: 'anthropic/m',
        binaryPath: BIN,
        serverUrl: 'http://localhost:4096',
      },
      makeDeps(),
      'sk',
    );
    for await (const _ of adapter.stream({ messages: [{ role: 'user', content: 'hi' }] })) {
      /* drain */
    }
    const args = mockSpawn.mock.calls[0][1] as string[];
    expect(args[args.indexOf('--attach') + 1]).toBe('http://localhost:4096');
    expect(args[args.indexOf('--dir') + 1]).toBe('/work/dir');
  });
});

// ---------------------------------------------------------------------------
// Abort
// ---------------------------------------------------------------------------

describe('OpenCodeCliAdapter — abort', () => {
  it('sends SIGTERM and ends with finishReason "aborted" when pre-aborted', async () => {
    let child!: ReturnType<typeof fakeChild>;
    mockSpawn.mockImplementation(() => {
      child = fakeChild([], null);
      return child;
    });
    const { OpenCodeCliAdapter } = await import('./index.ts');
    const adapter = new OpenCodeCliAdapter(
      { type: 'opencode-cli', model: 'anthropic/m', binaryPath: BIN },
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

describe('OpenCodeCliAdapter — auth', () => {
  it('factory throws MissingCredentialError when no key and no broker', async () => {
    await import('./index.ts'); // ensure self-registration ran
    const factory = getAdapterFactory('opencode-cli');
    expect(factory).toBeDefined();
    expect(() =>
      factory?.factory({ type: 'opencode-cli', model: 'anthropic/m' }, makeDeps()),
    ).toThrow(/API key/);
  });

  it('injects the broker-resolved key as the provider env var (openai → OPENAI_API_KEY)', async () => {
    mockSpawn.mockImplementation(() => fakeChild(SIMPLE));
    await import('./index.ts');

    const factory = getAdapterFactory('opencode-cli');
    const broker = { getCredential: vi.fn(async () => ({ apiKey: 'sk-from-broker' })) };
    const adapter = factory?.factory(
      { type: 'opencode-cli', model: 'openai/gpt-5.4', binaryPath: BIN },
      makeDeps({ credentialBroker: broker }),
    );

    for await (const _ of adapter!.stream({ messages: [{ role: 'user', content: 'hi' }] })) {
      /* drain */
    }
    expect(broker.getCredential).toHaveBeenCalledWith('openai');
    const env = (mockSpawn.mock.calls[0][2] as { env: NodeJS.ProcessEnv }).env;
    expect(env.OPENAI_API_KEY).toBe('sk-from-broker');
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it('throws ConfigError at construction for an unsupported sandboxed provider', async () => {
    const { OpenCodeCliAdapter } = await import('./index.ts');
    expect(
      () =>
        new OpenCodeCliAdapter(
          { type: 'opencode-cli', model: 'github-copilot/gpt-5.3-codex', binaryPath: BIN },
          makeDeps(),
          'sk',
        ),
    ).toThrow(ConfigError);
  });
});

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------

describe('OpenCodeCliAdapter — capabilities', () => {
  it('reports the opencode-cli capability matrix', async () => {
    const { OpenCodeCliAdapter } = await import('./index.ts');
    const adapter = new OpenCodeCliAdapter(
      { type: 'opencode-cli', model: 'anthropic/m', binaryPath: BIN },
      makeDeps(),
      'sk',
    );
    expect(adapter.type).toBe('opencode-cli');
    expect(adapter.capabilities.supportsStreaming).toBe(true);
    expect(adapter.capabilities.supportsToolUse).toBe(true);
    expect(adapter.capabilities.supportsJsonMode).toBe(false);
  });
});
