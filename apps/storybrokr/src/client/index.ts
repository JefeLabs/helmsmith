import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type ErrorBody, StorybrokrError } from '../lib/errors.js';
import { daemonFile, homeDir } from '../lib/paths.js';
import { loadConfig } from '../server/config.js';
import type { DaemonInfo, HostInfo, InstanceRecord, UpRequest } from '../types.js';

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
    const res = await fetch(`http://127.0.0.1:${info.port}/v1/health`);
    return res.ok;
  } catch {
    return false;
  }
}

/** Default auto-start: run the built daemon entry detached, inheriting STORYBROKR_HOME. */
function spawnDetachedDaemon(home: string): void {
  const entry = join(dirname(fileURLToPath(import.meta.url)), 'server', 'start.js');
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

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.url}${path}`, {
        method,
        headers: { authorization: `Bearer ${this.info.token}`, 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (err) {
      throw new StorybrokrError(
        'DAEMON_UNAVAILABLE',
        `daemon at ${this.url} is not answering: ${(err as Error).message}`,
      );
    }
    if (res.status === 204) return undefined as T;
    const json = (await res.json()) as T | ErrorBody;
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
    const res = await fetch(`${this.url}/v1/instances`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.info.token}`, 'content-type': 'application/json' },
      body: JSON.stringify(req),
    });
    const json = (await res.json()) as { record: InstanceRecord } | ErrorBody;
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
  async logs(id: string, tail = 200): Promise<string[]> {
    return (
      await this.request<{ lines: string[] }>(
        'GET',
        `/v1/instances/${encodeURIComponent(id)}/logs?tail=${tail}`,
      )
    ).lines;
  }
  /** Streams log lines via SSE; resolves with a function that closes the stream. */
  async follow(id: string, onLine: (line: string) => void): Promise<() => void> {
    const controller = new AbortController();
    const res = await fetch(`${this.url}/v1/instances/${encodeURIComponent(id)}/logs?follow=1`, {
      headers: { authorization: `Bearer ${this.info.token}` },
      signal: controller.signal,
    });
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
          if (frame.startsWith('data: ')) onLine(JSON.parse(frame.slice(6)) as string);
          idx = buf.indexOf('\n\n');
        }
      }
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
