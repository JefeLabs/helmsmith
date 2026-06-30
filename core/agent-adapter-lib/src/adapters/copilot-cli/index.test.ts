/**
 * CopilotCliAdapter unit tests.
 *
 * Mocks node:child_process.spawn (the repo fakeChild pattern) so no real
 * `copilot` runs. Covers: spawn argv (standalone `copilot -p … --allow-all-tools
 * --add-dir <workdir>` shape) + cwd + sandbox env ($HOME/$TMPDIR=workdir,
 * injected COPILOT_GITHUB_TOKEN/GH_TOKEN/GITHUB_TOKEN); the single synthetic
 * text-delta + message-stop (text print mode, no streaming); autonomous caps
 * (supportsToolUse:true, toolUseMode:'autonomous'); abort → 'aborted';
 * broker-based token injection; MissingCredentialError.
 */

import { EventEmitter } from 'node:events';
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

// /bin/sh is a real executable, so resolveBinary returns it; spawn is mocked.
const BIN = '/bin/sh';

function makeDeps(over?: Partial<AdapterDeps>): AdapterDeps {
  return { workdir: '/work/dir', repoRoot: '/work/dir', commit: 'abc', branch: 'main', ...over };
}

let savedCopilot: string | undefined;
let savedGh: string | undefined;
let savedGithub: string | undefined;
beforeEach(() => {
  mockSpawn.mockReset();
  savedCopilot = process.env.COPILOT_GITHUB_TOKEN;
  savedGh = process.env.GH_TOKEN;
  savedGithub = process.env.GITHUB_TOKEN;
  delete process.env.COPILOT_GITHUB_TOKEN;
  delete process.env.GH_TOKEN;
  delete process.env.GITHUB_TOKEN;
});
afterEach(() => {
  if (savedCopilot === undefined) delete process.env.COPILOT_GITHUB_TOKEN;
  else process.env.COPILOT_GITHUB_TOKEN = savedCopilot;
  if (savedGh === undefined) delete process.env.GH_TOKEN;
  else process.env.GH_TOKEN = savedGh;
  if (savedGithub === undefined) delete process.env.GITHUB_TOKEN;
  else process.env.GITHUB_TOKEN = savedGithub;
});

// ---------------------------------------------------------------------------
// Spawn contract
// ---------------------------------------------------------------------------

describe('CopilotCliAdapter — spawn contract', () => {
  it('spawns `copilot -p … --allow-all-tools --add-dir <workdir>` with cwd + sandbox env', async () => {
    mockSpawn.mockImplementation(() => fakeChild(['answer']));
    const { CopilotCliAdapter } = await import('./index.ts');

    const adapter = new CopilotCliAdapter(
      { type: 'copilot-cli', model: 'gpt-4o', binaryPath: BIN },
      makeDeps(),
      'gho_test_token',
    );

    for await (const _ of adapter.stream({ messages: [{ role: 'user', content: 'list files' }] })) {
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
      '-p',
      'list files',
      '--allow-all-tools',
      '--add-dir',
      '/work/dir',
      '--no-color',
      '--silent',
      '--model',
      'gpt-4o',
    ]);
    expect(options.cwd).toBe('/work/dir');
    expect(options.env.HOME).toBe('/work/dir');
    expect(options.env.TMPDIR).toBe('/work/dir');
    expect(options.env.COPILOT_GITHUB_TOKEN).toBe('gho_test_token');
    expect(options.env.GH_TOKEN).toBe('gho_test_token');
    expect(options.env.GITHUB_TOKEN).toBe('gho_test_token');
  });
});

// ---------------------------------------------------------------------------
// Single synthetic chunk (text print mode, no streaming)
// ---------------------------------------------------------------------------

describe('CopilotCliAdapter — single-block output', () => {
  it('emits ONE synthetic text-delta + message-stop from the buffered stdout', async () => {
    mockSpawn.mockImplementation(() => fakeChild(['line one', 'line two']));
    const { CopilotCliAdapter } = await import('./index.ts');
    const adapter = new CopilotCliAdapter(
      { type: 'copilot-cli', model: 'm', binaryPath: BIN },
      makeDeps(),
      'tok',
    );
    const chunks: AgentChunk[] = [];
    for await (const c of adapter.stream({ messages: [{ role: 'user', content: 'q' }] })) {
      chunks.push(c);
    }
    expect(chunks).toEqual<AgentChunk[]>([
      { type: 'text-delta', text: 'line one\nline two' },
      { type: 'message-stop', finishReason: 'stop' },
    ]);
  });

  it('invoke() reduces to the buffered content', async () => {
    mockSpawn.mockImplementation(() => fakeChild(['the answer']));
    const { CopilotCliAdapter } = await import('./index.ts');
    const adapter = new CopilotCliAdapter(
      { type: 'copilot-cli', model: 'm', binaryPath: BIN },
      makeDeps(),
      'tok',
    );
    const result = await adapter.invoke({ messages: [{ role: 'user', content: 'q' }] });
    expect(result.content).toBe('the answer');
    expect(result.finishReason).toBe('stop');
  });
});

// ---------------------------------------------------------------------------
// Autonomous capability + abort
// ---------------------------------------------------------------------------

describe('CopilotCliAdapter — autonomous capability + abort', () => {
  it('rejects host-injected custom tools with CapabilityMismatchError (autonomous CLI)', async () => {
    mockSpawn.mockImplementation(() => fakeChild(['x']));
    const { CopilotCliAdapter } = await import('./index.ts');
    const adapter = new CopilotCliAdapter(
      { type: 'copilot-cli', model: 'm', binaryPath: BIN },
      makeDeps(),
      'tok',
    );
    await expect(
      adapter.invoke({ messages: [{ role: 'user', content: 'q' }], tools: [{ name: 'f' }] }),
    ).rejects.toBeInstanceOf(CapabilityMismatchError);
    // No subprocess should be spawned — the reject is fail-fast.
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it('reports autonomous tool use, no streaming, no usage', async () => {
    mockSpawn.mockImplementation(() => fakeChild(['x']));
    const { CopilotCliAdapter } = await import('./index.ts');
    const adapter = new CopilotCliAdapter(
      { type: 'copilot-cli', model: 'm', binaryPath: BIN },
      makeDeps(),
      'tok',
    );
    expect(adapter.capabilities.supportsStreaming).toBe(false);
    expect(adapter.capabilities.supportsToolUse).toBe(true);
    expect(adapter.capabilities.toolUseMode).toBe('autonomous');
    expect(adapter.capabilities.reportsUsage).toBe(false);
  });

  it('ends with finishReason "aborted" when pre-aborted', async () => {
    let child!: ReturnType<typeof fakeChild>;
    mockSpawn.mockImplementation(() => {
      child = fakeChild([], null);
      return child;
    });
    const { CopilotCliAdapter } = await import('./index.ts');
    const adapter = new CopilotCliAdapter(
      { type: 'copilot-cli', model: 'm', binaryPath: BIN },
      makeDeps(),
      'tok',
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
// Auth (token) via the registered factory
// ---------------------------------------------------------------------------

describe('CopilotCliAdapter — auth', () => {
  it('factory throws MissingCredentialError when no token and no broker', async () => {
    await import('./index.ts');
    const factory = getAdapterFactory('copilot-cli');
    expect(factory).toBeDefined();
    expect(() => factory?.factory({ type: 'copilot-cli', model: 'm' }, makeDeps())).toThrow(
      /GitHub token/,
    );
  });

  it('injects the broker-resolved github token into the child env', async () => {
    mockSpawn.mockImplementation(() => fakeChild(['ok']));
    await import('./index.ts');
    const factory = getAdapterFactory('copilot-cli');
    const broker = { getCredential: vi.fn(async () => ({ apiKey: 'gho_from_broker' })) };
    const adapter = factory?.factory(
      { type: 'copilot-cli', model: 'm', binaryPath: BIN },
      makeDeps({ credentialBroker: broker }),
    );
    for await (const _ of adapter!.stream({ messages: [{ role: 'user', content: 'hi' }] })) {
      /* drain */
    }
    expect(broker.getCredential).toHaveBeenCalledWith('github');
    const options = mockSpawn.mock.calls[0][2] as { env: NodeJS.ProcessEnv };
    expect(options.env.COPILOT_GITHUB_TOKEN).toBe('gho_from_broker');
    expect(options.env.GH_TOKEN).toBe('gho_from_broker');
  });

  it('reads COPILOT_GITHUB_TOKEN from spec.env when present', async () => {
    mockSpawn.mockImplementation(() => fakeChild(['ok']));
    await import('./index.ts');
    const factory = getAdapterFactory('copilot-cli');
    const adapter = factory?.factory(
      {
        type: 'copilot-cli',
        model: 'm',
        binaryPath: BIN,
        env: { COPILOT_GITHUB_TOKEN: 'tok_from_spec' },
      },
      makeDeps(),
    );
    for await (const _ of adapter!.stream({ messages: [{ role: 'user', content: 'hi' }] })) {
      /* drain */
    }
    const options = mockSpawn.mock.calls[0][2] as { env: NodeJS.ProcessEnv };
    expect(options.env.COPILOT_GITHUB_TOKEN).toBe('tok_from_spec');
  });
});
