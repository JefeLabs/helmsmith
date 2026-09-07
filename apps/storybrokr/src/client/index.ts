import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type ErrorBody, StorybrokrError } from '../lib/errors.js';
import { daemonFile, homeDir } from '../lib/paths.js';
import { loadConfig } from '../server/config.js';
import type {
  CheckRequest,
  CheckResponse,
  DaemonInfo,
  HostInfo,
  InstanceRecord,
  ScreenshotRequest,
  ScreenshotResponse,
  UpRequest,
} from '../types.js';

export interface ConnectOptions {
  home?: string;
  autoStart?: boolean;
  startCommand?: () => void | Promise<void>;
}

function readInfo(home: string): DaemonInfo | null {
  const file = daemonFile(home);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as DaemonInfo;
  } catch {
    return null;
  }
}

async function healthy(info: DaemonInfo | null): Promise<boolean> {
  if (!info) return false;
  try {
    const res = await fetch(`http://127.0.0.1:${info.port}/v1/health`, {
      signal: AbortSignal.timeout(2_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Resolves the daemon entry point relative to this client's own file, trying the bundled
 * layout (`dist/server/start.js` next to `dist/cli.js`) before the dev/build layout two levels
 * up from `src/client/` (package root's `dist/server/start.js`).
 */
export function resolveDaemonEntry(fromDir: string): string {
  const bundled = join(fromDir, 'server', 'start.js');
  if (existsSync(bundled)) return bundled;
  const dev = join(fromDir, '..', '..', 'dist', 'server', 'start.js');
  if (existsSync(dev)) return dev;
  throw new StorybrokrError(
    'DAEMON_UNAVAILABLE',
    `daemon entry not found (looked for ${bundled} and ${dev}); run \`pnpm build\` first`,
  );
}

/** Default auto-start: run the built daemon entry detached, inheriting STORYBROKR_HOME. */
function spawnDetachedDaemon(home: string): void {
  const entry = resolveDaemonEntry(dirname(fileURLToPath(import.meta.url)));
  const child = spawn(process.execPath, [entry], {
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, STORYBROKR_HOME: home },
  });
  child.unref();
}

export class DaemonClient {
  private constructor(
    readonly home: string,
    private info: DaemonInfo,
  ) {}

  get url(): string {
    return `http://127.0.0.1:${this.info.port}`;
  }

  static async connect(opts: ConnectOptions = {}): Promise<DaemonClient> {
    const home = opts.home ?? homeDir();
    let info = readInfo(home);
    if (await healthy(info)) return new DaemonClient(home, info as DaemonInfo);
    if (opts.autoStart === false) {
      throw new StorybrokrError(
        'DAEMON_UNAVAILABLE',
        `no storybrokr daemon is listening for ${home}`,
      );
    }
    await (opts.startCommand ?? (() => spawnDetachedDaemon(home)))();
    const deadline = Date.now() + loadConfig(home).autoStartWaitMs;
    while (Date.now() < deadline) {
      info = readInfo(home);
      if (await healthy(info)) return new DaemonClient(home, info as DaemonInfo);
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new StorybrokrError(
      'DAEMON_UNAVAILABLE',
      `storybrokr daemon did not come up for ${home}`,
    );
  }

  /**
   * Sends one HTTP request, mapping connection failures to `DAEMON_UNAVAILABLE` (spec §7.2:
   * a client holding a stale token gets 401, re-reads `daemon.json`, and retries once with the
   * new token if it differs — otherwise the 401 is returned for normal error mapping).
   */
  private async send(
    method: string,
    path: string,
    init: { body?: unknown; headers?: Record<string, string>; signal?: AbortSignal } = {},
  ): Promise<Response> {
    const attempt = async (): Promise<Response> => {
      try {
        return await fetch(`${this.url}${path}`, {
          method,
          headers: { authorization: `Bearer ${this.info.token}`, ...init.headers },
          body: init.body === undefined ? undefined : JSON.stringify(init.body),
          signal: init.signal,
        });
      } catch (err) {
        throw new StorybrokrError(
          'DAEMON_UNAVAILABLE',
          `daemon at ${this.url} is not answering: ${(err as Error).message}`,
        );
      }
    };
    const res = await attempt();
    if (res.status === 401) {
      const fresh = readInfo(this.home);
      if (fresh && fresh.token !== this.info.token) {
        this.info = fresh;
        return attempt();
      }
    }
    return res;
  }

  /** Parses a JSON body, mapping a malformed response to a coded error instead of a bare SyntaxError. */
  private async parseBody<T>(res: Response): Promise<T> {
    try {
      return (await res.json()) as T;
    } catch {
      throw new StorybrokrError(
        res.ok ? 'INTERNAL' : 'DAEMON_UNAVAILABLE',
        `daemon returned a non-JSON ${res.status} response`,
      );
    }
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.send(method, path, {
      body,
      headers: { 'content-type': 'application/json' },
    });
    if (res.status === 204) return undefined as T;
    const json = await this.parseBody<T | ErrorBody>(res);
    if (!res.ok) {
      const e = json as ErrorBody;
      throw new StorybrokrError(e.code ?? 'INTERNAL', e.message ?? `HTTP ${res.status}`, e.logTail);
    }
    return json as T;
  }

  health() {
    return this.request<{
      ok: boolean;
      version: string;
      pid: number;
      uptimeMs: number;
      instances: number;
    }>('GET', '/v1/health');
  }
  async up(req: UpRequest): Promise<{ record: InstanceRecord; created: boolean }> {
    const res = await this.send('POST', '/v1/instances', {
      body: req,
      headers: { 'content-type': 'application/json' },
    });
    const json = await this.parseBody<{ record: InstanceRecord } | ErrorBody>(res);
    if (!res.ok) {
      const e = json as ErrorBody;
      throw new StorybrokrError(e.code ?? 'INTERNAL', e.message ?? `HTTP ${res.status}`, e.logTail);
    }
    return { record: (json as { record: InstanceRecord }).record, created: res.status === 201 };
  }
  async list(): Promise<InstanceRecord[]> {
    return (await this.request<{ instances: InstanceRecord[] }>('GET', '/v1/instances')).instances;
  }
  async get(id: string): Promise<InstanceRecord> {
    return (
      await this.request<{ record: InstanceRecord }>(
        'GET',
        `/v1/instances/${encodeURIComponent(id)}`,
      )
    ).record;
  }
  down(id: string): Promise<void> {
    return this.request<void>('DELETE', `/v1/instances/${encodeURIComponent(id)}`);
  }
  async touch(id: string): Promise<InstanceRecord> {
    return (
      await this.request<{ record: InstanceRecord }>(
        'POST',
        `/v1/instances/${encodeURIComponent(id)}/touch`,
      )
    ).record;
  }
  check(id: string, req: CheckRequest = {}): Promise<CheckResponse> {
    return this.request<CheckResponse>(
      'POST',
      `/v1/instances/${encodeURIComponent(id)}/check`,
      req,
    );
  }
  screenshot(id: string, req: ScreenshotRequest): Promise<ScreenshotResponse> {
    return this.request<ScreenshotResponse>(
      'POST',
      `/v1/instances/${encodeURIComponent(id)}/screenshot`,
      req,
    );
  }
  async logs(id: string, tail = 200): Promise<string[]> {
    return (
      await this.request<{ lines: string[] }>(
        'GET',
        `/v1/instances/${encodeURIComponent(id)}/logs?tail=${tail}`,
      )
    ).lines;
  }
  /**
   * Streams log lines via SSE; resolves with a function that closes the stream. `onEnd`, if
   * given, fires exactly once when the stream ends — whether the server closed it (daemon
   * shutdown, instance stopped), a read error occurred, or the returned closer was called.
   */
  async follow(
    id: string,
    onLine: (line: string) => void,
    onEnd?: () => void,
  ): Promise<() => void> {
    const controller = new AbortController();
    const res = await this.send('GET', `/v1/instances/${encodeURIComponent(id)}/logs?follow=1`, {
      signal: controller.signal,
    });
    if (!res.ok) {
      const json = await this.parseBody<ErrorBody>(res);
      throw new StorybrokrError(
        json.code ?? 'INTERNAL',
        json.message ?? `HTTP ${res.status}`,
        json.logTail,
      );
    }
    const reader = res.body?.getReader();
    void (async () => {
      let buf = '';
      const dec = new TextDecoder();
      while (reader) {
        const { value, done } = await reader.read().catch(() => ({ value: undefined, done: true }));
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx = buf.indexOf('\n\n');
        while (idx >= 0) {
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          if (frame.startsWith('data: ')) {
            try {
              onLine(JSON.parse(frame.slice(6)) as string);
            } catch {
              // A malformed frame is not fatal to the stream; skip it and keep reading.
            }
          }
          idx = buf.indexOf('\n\n');
        }
      }
      onEnd?.();
    })();
    return () => controller.abort();
  }
  async inspectHost(path: string): Promise<HostInfo> {
    return (await this.request<{ host: HostInfo }>('POST', '/v1/hosts/inspect', { path })).host;
  }
  shutdown(): Promise<void> {
    return this.request<void>('POST', '/v1/shutdown').then(() => undefined);
  }
}
