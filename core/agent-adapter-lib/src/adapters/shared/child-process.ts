/**
 * CLI subprocess lifecycle utilities (PRD §9).
 *
 * Used by all CLI adapters (claude-code-cli, opencode-cli, copilot-cli,
 * copilot-agent-cli) in Phases C–D′. Phase A ships the utility + unit tests.
 *
 * Responsibilities:
 *   - resolveBinary:    find the CLI binary on PATH or at an explicit path.
 *   - spawnAgentProcess: spawn, wire stdio, handle abort/timeout, map exit codes.
 */

import { spawn } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { join } from 'node:path';
import { BinaryNotFoundError, ProviderError } from '../../errors.ts';

// ---------------------------------------------------------------------------
// resolveBinary (PRD §9 "Resolve binary via spec.binaryPath || which(toolName)")
// ---------------------------------------------------------------------------

/**
 * Resolve the full path to a CLI binary.
 *
 * If binaryPath is provided, verify it is executable and return it.
 * Otherwise search PATH entries sequentially.
 *
 * Throws BinaryNotFoundError with an install hint when the binary is absent.
 */
export function resolveBinary(toolName: string, binaryPath?: string): string {
  if (binaryPath) {
    try {
      accessSync(binaryPath, constants.X_OK);
      return binaryPath;
    } catch (err) {
      throw new BinaryNotFoundError(
        `Binary not found or not executable at '${binaryPath}'. ` +
          `Check the path or omit binaryPath to search PATH.`,
        { cause: err },
      );
    }
  }

  const pathDirs = (process.env.PATH ?? '').split(':').filter(Boolean);
  for (const dir of pathDirs) {
    const candidate = join(dir, toolName);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Not found in this dir — continue
    }
  }

  throw new BinaryNotFoundError(
    `Binary '${toolName}' not found in PATH. ` +
      `Install it (e.g. 'npm install -g @anthropic-ai/claude-code') ` +
      `or pass an explicit binaryPath in the spec.`,
  );
}

// ---------------------------------------------------------------------------
// AgentProcessHandle — the handle returned by spawnAgentProcess
// ---------------------------------------------------------------------------

export interface AgentProcessHandle {
  /** Async iterable of stdout lines (one string per newline-terminated line). */
  readonly stdout: AsyncIterable<string>;
  /** Async iterable of stderr lines. */
  readonly stderr: AsyncIterable<string>;
  /**
   * Resolves when the process exits with code 0.
   * Rejects with ProviderError for non-zero exits (with last 4KB of stderr).
   */
  readonly done: Promise<void>;
  /**
   * Send SIGTERM; escalate to SIGKILL after 2 s if the process hasn't exited.
   * Safe to call multiple times (idempotent after first call).
   */
  abort(): void;
}

// ---------------------------------------------------------------------------
// SpawnAgentProcessOptions
// ---------------------------------------------------------------------------

export interface SpawnAgentProcessOptions {
  binary: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  timeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Internal: push-driven line queue for a stream that emits 'data' + 'close'
// ---------------------------------------------------------------------------

function createLineQueue(stream: NodeJS.EventEmitter, onClose?: () => void): AsyncIterable<string> {
  const lines: string[] = [];
  let waitResolve: (() => void) | null = null;
  let closed = false;
  let buffer = '';

  stream.on('data', (chunk: Buffer | string) => {
    buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    const parts = buffer.split('\n');
    buffer = parts.pop() ?? '';
    for (const line of parts) {
      lines.push(line);
    }
    if (waitResolve) {
      const r = waitResolve;
      waitResolve = null;
      r();
    }
  });

  const markClosed = () => {
    if (buffer.length > 0) {
      lines.push(buffer);
      buffer = '';
    }
    closed = true;
    onClose?.();
    if (waitResolve) {
      const r = waitResolve;
      waitResolve = null;
      r();
    }
  };

  stream.on('close', markClosed);
  stream.on('end', markClosed);

  return {
    [Symbol.asyncIterator]() {
      return {
        async next(): Promise<IteratorResult<string>> {
          // eslint-disable-next-line no-constant-condition
          while (true) {
            if (lines.length > 0) {
              return { value: lines.shift()!, done: false };
            }
            if (closed) {
              return { value: '', done: true };
            }
            await new Promise<void>((resolve) => {
              waitResolve = resolve;
            });
          }
        },
      };
    },
  };
}

// ---------------------------------------------------------------------------
// spawnAgentProcess
// ---------------------------------------------------------------------------

/**
 * Spawn a CLI agent subprocess and return a handle for structured access
 * to its stdio streams and lifecycle.
 *
 * Single-spawn invariant (PRD §9): one subprocess per invocation. The
 * adapter never spawns auxiliaries; coordinator-level fan-out belongs to
 * agentic-worker-lib.
 *
 * Abort handling (PRD §9):
 *   SIGTERM → 2 s grace period → SIGKILL if still alive.
 *
 * Exit-code mapping (PRD §9):
 *   exit 0  → done resolves.
 *   exit ≠0 → done rejects with ProviderError (last 4 KB of stderr).
 */
export function spawnAgentProcess(opts: SpawnAgentProcessOptions): AgentProcessHandle {
  const { binary, args, cwd, env, signal, timeoutMs } = opts;

  const child = spawn(binary, args, {
    cwd,
    env: env ?? process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  // Stderr ring buffer (last 64 KB)
  const stderrChunks: string[] = [];
  const STDERR_MAX = 64 * 1024;
  let stderrTotal = 0;

  child.stderr?.on('data', (chunk: Buffer | string) => {
    const s = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    stderrTotal += s.length;
    stderrChunks.push(s);
    while (stderrTotal > STDERR_MAX && stderrChunks.length > 0) {
      const removed = stderrChunks.shift()!;
      stderrTotal -= removed.length;
    }
  });

  const stdoutIterable = createLineQueue(child.stdout!);
  const stderrIterable = createLineQueue(child.stderr!);

  let aborted = false;
  let killScheduled = false;
  let killTimer: ReturnType<typeof setTimeout> | undefined;

  function doAbort() {
    if (aborted) return;
    aborted = true;
    child.kill('SIGTERM');
    if (!killScheduled) {
      killScheduled = true;
      killTimer = setTimeout(() => {
        if (!child.killed) child.kill('SIGKILL');
      }, 2000);
      // Don't let the timer hold the event loop open
      if (typeof killTimer === 'object' && killTimer !== null && 'unref' in killTimer) {
        (killTimer as NodeJS.Timeout).unref();
      }
    }
  }

  const done = new Promise<void>((resolve, reject) => {
    child.on('error', (err) => {
      if (killTimer !== undefined) clearTimeout(killTimer);
      reject(
        new BinaryNotFoundError(`Failed to spawn '${binary}': ${(err as Error).message}`, {
          cause: err,
        }),
      );
    });

    child.on('close', (code) => {
      if (killTimer !== undefined) clearTimeout(killTimer);
      if (aborted) {
        // Aborted — resolve without error; finishReason: 'aborted' is set by
        // the adapter that owns the stream.
        resolve();
        return;
      }
      if (code === 0) {
        resolve();
        return;
      }
      // Non-zero exit — collect stderr and reject.
      const stderrSnippet = stderrChunks.join('').slice(-4096);
      reject(
        new ProviderError(
          `Process '${binary}' exited with code ${code}. ` +
            (stderrSnippet ? `Stderr: ${stderrSnippet}` : '(no stderr)'),
        ),
      );
    });
  });

  // AbortSignal integration
  if (signal) {
    if (signal.aborted) {
      doAbort();
    } else {
      const onAbort = () => doAbort();
      signal.addEventListener('abort', onAbort, { once: true });
      child.on('close', () => signal.removeEventListener('abort', onAbort));
    }
  }

  // Timeout
  if (timeoutMs !== undefined) {
    const timeoutHandle = setTimeout(() => doAbort(), timeoutMs);
    if (typeof timeoutHandle === 'object' && timeoutHandle !== null && 'unref' in timeoutHandle) {
      (timeoutHandle as NodeJS.Timeout).unref();
    }
    child.on('close', () => clearTimeout(timeoutHandle));
  }

  return {
    stdout: stdoutIterable,
    stderr: stderrIterable,
    done,
    abort: doAbort,
  };
}
