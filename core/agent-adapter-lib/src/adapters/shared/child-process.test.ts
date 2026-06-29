import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BinaryNotFoundError, ProviderError } from '../../errors.ts';

// ---------------------------------------------------------------------------
// Mock node:child_process
// ---------------------------------------------------------------------------

const mockSpawn = vi.fn();

vi.mock('node:child_process', () => ({
  spawn: mockSpawn,
}));

// ---------------------------------------------------------------------------
// fakeChild — mirrors the surface of node:child_process.ChildProcess
// ---------------------------------------------------------------------------

type FakeChild = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  stdin: { end: ReturnType<typeof vi.fn>; write: ReturnType<typeof vi.fn> };
  kill: ReturnType<typeof vi.fn>;
  killed: boolean;
};

function fakeChild(
  stdoutLines: string[] = [],
  exitCode: number | null = 0,
  killBehaviour: 'immediate' | 'ignore' = 'immediate',
): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { end: vi.fn(), write: vi.fn() };
  child.killed = false;

  child.kill = vi.fn((signal?: string) => {
    child.killed = true;
    if (killBehaviour === 'immediate') {
      setImmediate(() => child.emit('close', null, signal ?? 'SIGTERM'));
    }
    // 'ignore' simulates a process that ignores SIGTERM (tests SIGKILL path)
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

function fakeChildWithStderr(stderrText: string, exitCode: number): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { end: vi.fn(), write: vi.fn() };
  child.killed = false;
  child.kill = vi.fn(() => {
    child.killed = true;
    return true;
  });

  setImmediate(() => {
    child.stderr.emit('data', Buffer.from(stderrText));
    setImmediate(() => {
      child.stdout.emit('close');
      child.stderr.emit('close');
      setImmediate(() => child.emit('close', exitCode));
    });
  });

  return child;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('resolveBinary', () => {
  beforeEach(() => {
    mockSpawn.mockReset();
  });

  it('returns the given binaryPath when it is executable', async () => {
    const { resolveBinary } = await import('./child-process.ts');
    // Use a real executable that exists in this environment (macOS + Linux)
    const result = resolveBinary('sh', '/bin/sh');
    expect(result).toBe('/bin/sh');
  });

  it('throws BinaryNotFoundError for a non-existent binaryPath', async () => {
    const { resolveBinary } = await import('./child-process.ts');
    expect(() => resolveBinary('/nonexistent/does-not-exist')).toThrow(BinaryNotFoundError);
  });

  it('resolves a tool name via PATH (e.g. "git")', async () => {
    const { resolveBinary } = await import('./child-process.ts');
    // git is available in all dev environments; if not found the test errors clearly
    const result = resolveBinary('git');
    expect(result).toContain('git');
    expect(result.startsWith('/')).toBe(true);
  });

  it('throws BinaryNotFoundError for an unknown tool name', async () => {
    const { resolveBinary } = await import('./child-process.ts');
    expect(() => resolveBinary('__nonexistent_agent_binary__')).toThrow(BinaryNotFoundError);
    expect(() => resolveBinary('__nonexistent_agent_binary__')).toThrow(
      /__nonexistent_agent_binary__/,
    );
  });

  it('BinaryNotFoundError message includes PATH hint', async () => {
    const { resolveBinary } = await import('./child-process.ts');
    let thrown: Error | undefined;
    try {
      resolveBinary('__no_such_binary__');
    } catch (err) {
      thrown = err as Error;
    }
    expect(thrown).toBeInstanceOf(BinaryNotFoundError);
    expect(thrown!.message).toMatch(/PATH|binaryPath/i);
  });
});

describe('spawnAgentProcess', () => {
  beforeEach(() => {
    mockSpawn.mockReset();
  });

  it('streams stdout lines to the stdout iterable', async () => {
    mockSpawn.mockImplementation(() => fakeChild(['line one', 'line two', 'line three']));
    const { spawnAgentProcess } = await import('./child-process.ts');

    const handle = spawnAgentProcess({
      binary: 'fake-bin',
      args: ['--run'],
      cwd: '/tmp',
    });

    const lines: string[] = [];
    for await (const line of handle.stdout) {
      lines.push(line);
    }

    expect(lines).toEqual(['line one', 'line two', 'line three']);
  });

  it('done resolves on exit code 0', async () => {
    mockSpawn.mockImplementation(() => fakeChild(['ok'], 0));
    const { spawnAgentProcess } = await import('./child-process.ts');

    const handle = spawnAgentProcess({ binary: 'fake', args: [], cwd: '/tmp' });
    // consume stdout so close fires
    for await (const _ of handle.stdout) {
      /* drain */
    }
    await expect(handle.done).resolves.toBeUndefined();
  });

  it('done rejects with ProviderError on non-zero exit code', async () => {
    mockSpawn.mockImplementation(() => fakeChildWithStderr('fatal error occurred', 1));
    const { spawnAgentProcess } = await import('./child-process.ts');

    const handle = spawnAgentProcess({ binary: 'fake', args: [], cwd: '/tmp' });
    for await (const _ of handle.stdout) {
      /* drain */
    }
    await expect(handle.done).rejects.toThrow(ProviderError);
  });

  it('ProviderError message includes the exit code', async () => {
    mockSpawn.mockImplementation(() => fakeChildWithStderr('something went wrong', 42));
    const { spawnAgentProcess } = await import('./child-process.ts');

    const handle = spawnAgentProcess({ binary: 'mybinary', args: [], cwd: '/tmp' });
    for await (const _ of handle.stdout) {
      /* drain */
    }

    let err: Error | undefined;
    try {
      await handle.done;
    } catch (e) {
      err = e as Error;
    }
    expect(err).toBeInstanceOf(ProviderError);
    expect(err!.message).toContain('42');
  });

  it('ProviderError message includes last stderr content', async () => {
    mockSpawn.mockImplementation(() => fakeChildWithStderr('the real reason', 1));
    const { spawnAgentProcess } = await import('./child-process.ts');

    const handle = spawnAgentProcess({ binary: 'fake', args: [], cwd: '/tmp' });
    for await (const _ of handle.stdout) {
      /* drain */
    }

    let err: Error | undefined;
    try {
      await handle.done;
    } catch (e) {
      err = e as Error;
    }
    expect(err!.message).toContain('the real reason');
  });

  it('abort() sends SIGTERM to the child process', async () => {
    const child = fakeChild(['slow'], null); // won't auto-close
    mockSpawn.mockImplementation(() => child);
    const { spawnAgentProcess } = await import('./child-process.ts');

    const handle = spawnAgentProcess({ binary: 'fake', args: [], cwd: '/tmp' });
    // Let the stdout data emit
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    handle.abort();
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('abort() is idempotent (safe to call multiple times)', async () => {
    const child = fakeChild([], 0);
    mockSpawn.mockImplementation(() => child);
    const { spawnAgentProcess } = await import('./child-process.ts');

    const handle = spawnAgentProcess({ binary: 'fake', args: [], cwd: '/tmp' });
    handle.abort();
    handle.abort();
    handle.abort();

    // kill called once (first abort); subsequent calls are no-ops
    expect(child.kill).toHaveBeenCalledOnce();
  });

  it('done resolves (not rejects) after abort()', async () => {
    const child = fakeChild(['partial'], 0);
    mockSpawn.mockImplementation(() => child);
    const { spawnAgentProcess } = await import('./child-process.ts');

    const handle = spawnAgentProcess({ binary: 'fake', args: [], cwd: '/tmp' });
    for await (const _ of handle.stdout) {
      /* drain */
    }
    handle.abort();

    // After abort, done should resolve (aborted = finishReason: 'aborted' upstream)
    await expect(handle.done).resolves.toBeUndefined();
  });

  it('respects AbortSignal when already aborted', async () => {
    const child = fakeChild([], 0);
    mockSpawn.mockImplementation(() => child);
    const { spawnAgentProcess } = await import('./child-process.ts');

    const ctrl = new AbortController();
    ctrl.abort(); // pre-aborted

    spawnAgentProcess({ binary: 'fake', args: [], cwd: '/tmp', signal: ctrl.signal });

    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('respects AbortSignal abort event after spawn', async () => {
    const child = fakeChild(['work...'], 0);
    mockSpawn.mockImplementation(() => child);
    const { spawnAgentProcess } = await import('./child-process.ts');

    const ctrl = new AbortController();
    spawnAgentProcess({ binary: 'fake', args: [], cwd: '/tmp', signal: ctrl.signal });

    // Not aborted yet
    expect(child.kill).not.toHaveBeenCalled();

    ctrl.abort();
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('passes cwd and env to spawn', async () => {
    const child = fakeChild([], 0);
    mockSpawn.mockImplementation(() => child);
    const { spawnAgentProcess } = await import('./child-process.ts');

    const env = { MY_KEY: 'my-value', PATH: process.env.PATH ?? '' };
    spawnAgentProcess({ binary: 'fake', args: ['--arg'], cwd: '/my/workdir', env });

    expect(mockSpawn).toHaveBeenCalledWith('fake', ['--arg'], {
      cwd: '/my/workdir',
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  });

  it('uses process.env when no env is provided', async () => {
    const child = fakeChild([], 0);
    mockSpawn.mockImplementation(() => child);
    const { spawnAgentProcess } = await import('./child-process.ts');

    spawnAgentProcess({ binary: 'fake', args: [], cwd: '/tmp' });

    const callArgs = mockSpawn.mock.calls[0] as [string, string[], { env: NodeJS.ProcessEnv }];
    expect(callArgs[2].env).toBe(process.env);
  });

  it('done rejects with BinaryNotFoundError on spawn error', async () => {
    const child = new EventEmitter() as FakeChild;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.stdin = { end: vi.fn(), write: vi.fn() };
    child.kill = vi.fn();
    child.killed = false;
    // Simulate spawn failure (ENOENT)
    setImmediate(() => child.emit('error', Object.assign(new Error('ENOENT'), { code: 'ENOENT' })));
    mockSpawn.mockImplementation(() => child);

    const { spawnAgentProcess } = await import('./child-process.ts');
    const handle = spawnAgentProcess({ binary: 'no-such-bin', args: [], cwd: '/tmp' });

    await expect(handle.done).rejects.toThrow(BinaryNotFoundError);
  });
});
