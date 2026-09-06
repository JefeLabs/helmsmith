import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { StorybrokrError } from '../lib/errors.js';
import { daemonFile, lockFile } from '../lib/paths.js';
import type { DaemonConfig, DaemonInfo } from '../types.js';
import { VERSION } from '../version.js';
import type { Broker } from './broker.js';
import { handle } from './routes.js';

export interface Daemon {
  start(port?: number): Promise<DaemonInfo>;
  stop(): Promise<void>;
  readonly url: string;
  readonly token: string;
}

export interface DaemonOptions {
  home: string;
  broker: Broker;
  config: DaemonConfig;
  token?: string;
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Exclusive lock: creates daemon.lock with our pid; a stale lock (dead pid) is reclaimed. */
function acquireLock(home: string): void {
  const file = lockFile(home);
  mkdirSync(home, { recursive: true });
  if (existsSync(file)) {
    const other = Number(readFileSync(file, 'utf8').trim());
    if (Number.isInteger(other) && pidAlive(other)) {
      throw new StorybrokrError(
        'INTERNAL',
        `storybrokr daemon already running (pid ${other}) for ${home}`,
      );
    }
    rmSync(file, { force: true });
  }
  const fd = openSync(file, 'wx');
  writeFileSync(fd, String(process.pid));
}

export function createDaemon(opts: DaemonOptions): Daemon {
  const token = opts.token ?? randomBytes(24).toString('hex');
  let server: Server | null = null;
  let url = '';
  let reaper: NodeJS.Timeout | null = null;
  const startedAt = Date.now();

  const stop = async (): Promise<void> => {
    if (reaper) clearInterval(reaper);
    reaper = null;
    await opts.broker.downAll();
    if (server) await new Promise<void>((r) => server?.close(() => r()));
    server = null;
    rmSync(daemonFile(opts.home), { force: true });
    rmSync(lockFile(opts.home), { force: true });
  };

  return {
    get url() {
      return url;
    },
    token,
    async start(port = 0) {
      acquireLock(opts.home);
      const ctx = {
        broker: opts.broker,
        version: VERSION,
        startedAt,
        pid: process.pid,
        shutdown: () => void stop(),
      };
      server = createServer((req, res) => {
        const isHealth = req.url === '/v1/health';
        const auth = req.headers.authorization ?? '';
        if (!isHealth && auth !== `Bearer ${token}`) {
          res.writeHead(401, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({ code: 'UNAUTHORIZED', message: 'missing or invalid bearer token' }),
          );
          return;
        }
        void handle(ctx, req, res);
      });
      await new Promise<void>((resolve, reject) => {
        server?.once('error', reject);
        server?.listen(port, '127.0.0.1', () => resolve());
      });
      const addr = server.address();
      const boundPort = typeof addr === 'object' && addr ? addr.port : port;
      url = `http://127.0.0.1:${boundPort}`;
      const info: DaemonInfo = {
        port: boundPort,
        token,
        pid: process.pid,
        startedAt: new Date(startedAt).toISOString(),
      };
      writeFileSync(daemonFile(opts.home), `${JSON.stringify(info, null, 2)}\n`, { mode: 0o600 });
      reaper = setInterval(() => void opts.broker.reapIdle(), opts.config.reaperIntervalMs);
      reaper.unref();
      return info;
    },
    stop,
  };
}
