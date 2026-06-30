/**
 * CodexCliAdapter unit tests.
 *
 * Mocks node:child_process.spawn (the repo fakeChild pattern) so no real
 * `codex` subprocess runs. Covers: spawn flags + cwd=workdir + sandbox env
 * ($HOME/$TMPDIR=workdir, injected OPENAI_API_KEY) + MCP suppression
 * (--ignore-user-config) + the positional prompt + closed stdin,
 * invoke=reduceStream parity over the fixture transcript, broker-based
 * credential injection, MissingCredentialError, abort → 'aborted'.
 */

import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdapterDeps } from '../../registry.ts';
import { getAdapterFactory } from '../../registry.ts';
import type { AgentChunk } from '../../stream.ts';

const mockSpawn = vi.fn();
vi.mock('node:child_process', () => ({ spawn: mockSpawn }));

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

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const SIMPLE = readFileSync(join(FIXTURES, 'simple-text.jsonl'), 'utf8')
  .split('\n')
  .filter((l) => l.trim().length > 0);

const BIN = '/bin/sh';

function makeDeps(over?: Partial<AdapterDeps>): AdapterDeps {
  return { workdir: '/work/dir', repoRoot: '/work/dir', commit: 'abc123', branch: 'main', ...over };
}

let savedKey: string | undefined;
beforeEach(() => {
  mockSpawn.mockReset();
  savedKey = process.env.OPENAI_API_KEY;
});
afterEach(() => {
  if (savedKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = savedKey;
});

// ---------------------------------------------------------------------------
// Spawn contract
// ---------------------------------------------------------------------------

describe('CodexCliAdapter — spawn contract', () => {
  it('spawns codex exec with --json flags, cwd, sandbox env, MCP suppression, prompt', async () => {
    let child!: ReturnType<typeof fakeChild>;
    mockSpawn.mockImplementation(() => {
      child = fakeChild(SIMPLE);
      return child;
    });
    const { CodexCliAdapter } = await import('./index.ts');

    const adapter = new CodexCliAdapter(
      { type: 'codex-cli', model: 'gpt-5-codex', binaryPath: BIN },
      makeDeps(),
      'sk-openai-test',
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
      'exec',
      '--json',
      '--sandbox',
      'workspace-write',
      '--skip-git-repo-check',
      '--ignore-user-config',
      '--color',
      'never',
      '--model',
      'gpt-5-codex',
      'ping',
    ]);
    expect(options.cwd).toBe('/work/dir');
    expect(options.env.HOME).toBe('/work/dir');
    expect(options.env.TMPDIR).toBe('/work/dir');
    expect(options.env.OPENAI_API_KEY).toBe('sk-openai-test');

    // stdin closed (EOF) without writing — codex exec would otherwise block on stdin.
    expect(child.stdin.write).not.toHaveBeenCalled();
    expect(child.stdin.end).toHaveBeenCalled();
  });

  it('folds the system prompt into the positional prompt', async () => {
    mockSpawn.mockImplementation(() => fakeChild(SIMPLE));
    const { CodexCliAdapter } = await import('./index.ts');
    const adapter = new CodexCliAdapter(
      { type: 'codex-cli', model: 'gpt-5-codex', binaryPath: BIN, systemPrompt: 'You are terse.' },
      makeDeps(),
      'k',
    );
    for await (const _ of adapter.stream({ messages: [{ role: 'user', content: 'hi' }] })) {
      /* drain */
    }
    const args = mockSpawn.mock.calls[0][1] as string[];
    expect(args.at(-1)).toBe('You are terse.\n\nhi');
  });
});

// ---------------------------------------------------------------------------
// invoke = reduceStream(stream) parity
// ---------------------------------------------------------------------------

describe('CodexCliAdapter — invoke/stream parity', () => {
  it('stream() yields text + usage + message-stop from the fixture', async () => {
    mockSpawn.mockImplementation(() => fakeChild(SIMPLE));
    const { CodexCliAdapter } = await import('./index.ts');
    const adapter = new CodexCliAdapter(
      { type: 'codex-cli', model: 'm', binaryPath: BIN },
      makeDeps(),
      'k',
    );
    const chunks: AgentChunk[] = [];
    for await (const c of adapter.stream({ messages: [{ role: 'user', content: 'ping' }] })) {
      chunks.push(c);
    }
    expect(chunks).toEqual([
      { type: 'text-delta', text: 'pong' },
      { type: 'usage', usage: { inputTokens: 12, outputTokens: 3, cacheReadTokens: 4 } },
      { type: 'message-stop', finishReason: 'stop' },
    ]);
  });

  it('invoke() reduces to content="pong"', async () => {
    mockSpawn.mockImplementation(() => fakeChild(SIMPLE));
    const { CodexCliAdapter } = await import('./index.ts');
    const adapter = new CodexCliAdapter(
      { type: 'codex-cli', model: 'm', binaryPath: BIN },
      makeDeps(),
      'k',
    );
    const result = await adapter.invoke({ messages: [{ role: 'user', content: 'ping' }] });
    expect(result.content).toBe('pong');
    expect(result.finishReason).toBe('stop');
    expect(result.usage?.outputTokens).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Abort
// ---------------------------------------------------------------------------

describe('CodexCliAdapter — abort', () => {
  it('sends SIGTERM and ends with finishReason "aborted" when pre-aborted', async () => {
    let child!: ReturnType<typeof fakeChild>;
    mockSpawn.mockImplementation(() => {
      child = fakeChild([], null);
      return child;
    });
    const { CodexCliAdapter } = await import('./index.ts');
    const adapter = new CodexCliAdapter(
      { type: 'codex-cli', model: 'm', binaryPath: BIN },
      makeDeps(),
      'k',
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
// Auth via the registered factory
// ---------------------------------------------------------------------------

describe('CodexCliAdapter — auth', () => {
  it('factory throws MissingCredentialError when no key and no broker', async () => {
    await import('./index.ts');
    delete process.env.OPENAI_API_KEY;
    const factory = getAdapterFactory('codex-cli');
    expect(factory).toBeDefined();
    expect(() => factory?.factory({ type: 'codex-cli', model: 'm' }, makeDeps())).toThrow(
      /OpenAI API key/,
    );
  });

  it('injects the broker-resolved key as OPENAI_API_KEY into the child env', async () => {
    mockSpawn.mockImplementation(() => fakeChild(SIMPLE));
    await import('./index.ts');
    delete process.env.OPENAI_API_KEY;

    const factory = getAdapterFactory('codex-cli');
    const broker = { getCredential: vi.fn(async () => ({ apiKey: 'sk-from-broker' })) };
    const adapter = factory?.factory(
      { type: 'codex-cli', model: 'm', binaryPath: BIN },
      makeDeps({ credentialBroker: broker }),
    );

    for await (const _ of adapter!.stream({ messages: [{ role: 'user', content: 'hi' }] })) {
      /* drain */
    }
    expect(broker.getCredential).toHaveBeenCalledWith('openai');
    const options = mockSpawn.mock.calls[0][2] as { env: NodeJS.ProcessEnv };
    expect(options.env.OPENAI_API_KEY).toBe('sk-from-broker');
  });
});

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------

describe('CodexCliAdapter — capabilities', () => {
  it('reports the codex-cli capability matrix', async () => {
    mockSpawn.mockImplementation(() => fakeChild(SIMPLE));
    const { CodexCliAdapter } = await import('./index.ts');
    const adapter = new CodexCliAdapter(
      { type: 'codex-cli', model: 'm', binaryPath: BIN },
      makeDeps(),
      'k',
    );
    expect(adapter.type).toBe('codex-cli');
    expect(adapter.capabilities.reportsUsage).toBe(true);
    expect(adapter.capabilities.supportsStreaming).toBe(true);
    expect(adapter.capabilities.supportsToolUse).toBe(true);
    expect(adapter.capabilities.supportsExtendedThinking).toBe(true);
    expect(adapter.capabilities.supportsJsonMode).toBe(false);
  });
});
