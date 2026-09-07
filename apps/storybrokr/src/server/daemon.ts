import { randomBytes, timingSafeEqual } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer, type Server } from 'node:http';
import { type ErrorBody, httpStatusFor, StorybrokrError } from '../lib/errors.js';
import { daemonFile, lockFile } from '../lib/paths.js';
import type { DaemonConfig, DaemonInfo } from '../types.js';
import { VERSION } from '../version.js';
import type { Broker } from './broker.js';
import { BrowserPool } from './browser.js';
import { createInspector, type Inspector } from './inspector.js';
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
  inspector?: Inspector;
}

/** Constant-time bearer comparison over equal-length buffers; a length mismatch (which already
 * leaks nothing useful about the token) falls back to a plain false. */
function bearerMatches(auth: string, token: string): boolean {
  const expected = Buffer.from(`Bearer ${token}`);
  const actual = Buffer.from(auth);
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Exclusive lock: creates daemon.lock with our pid; a stale lock (dead, missing, or malformed
 * pid) is reclaimed. */
function acquireLock(home: string): void {
  const file = lockFile(home);
  mkdirSync(home, { recursive: true });
  if (existsSync(file)) {
    const other = Number(readFileSync(file, 'utf8').trim());
    if (Number.isInteger(other) && other > 0 && pidAlive(other)) {
      throw new StorybrokrError(
        'INTERNAL',
        `storybrokr daemon already running (pid ${other}) for ${home}`,
      );
    }
    rmSync(file, { force: true });
  }
  let fd: number;
  try {
    fd = openSync(file, 'wx');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new StorybrokrError('INTERNAL', `storybrokr daemon already running for ${home}`);
    }
    throw new StorybrokrError('INTERNAL', `cannot create ${file}: ${(err as Error).message}`);
  }
  try {
    writeFileSync(fd, String(process.pid));
  } finally {
    closeSync(fd);
  }
}

export function createDaemon(opts: DaemonOptions): Daemon {
  const token = opts.token ?? randomBytes(24).toString('hex');
  let server: Server | null = null;
  let url = '';
  let reaper: NodeJS.Timeout | null = null;
  let started = false;
  const startedAt = Date.now();
  const pool = new BrowserPool({
    idleMinutes: opts.config.browserIdleMinutes,
    log: (line) => console.error(`storybrokr: browser: ${line}`),
  });
  const inspector =
    opts.inspector ??
    createInspector({
      pool,
    });

  const stop = async (): Promise<void> => {
    if (reaper) clearInterval(reaper);
    reaper = null;
    // Idempotent, and a no-op for a daemon that never finished start() (e.g. it lost the
    // lock race) — otherwise it would delete a live daemon's daemon.json and daemon.lock.
    if (!started) return;
    started = false;
    await opts.broker.downAll();
    await pool
      .close()
      .catch((err: unknown) => console.error('storybrokr: browser close failed', err));
    // An open ?follow=1 SSE response otherwise keeps this connection (and server.close) pending.
    server?.closeAllConnections();
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
        inspector,
        version: VERSION,
        startedAt,
        pid: process.pid,
        shutdown: () => {
          stop().catch((err: unknown) => console.error('storybrokr: shutdown failed', err));
        },
      };
      server = createServer((req, res) => {
        const isHealth = req.url === '/v1/health';
        const auth = req.headers.authorization ?? '';
        if (!isHealth && !bearerMatches(auth, token)) {
          const body: ErrorBody = {
            code: 'UNAUTHORIZED',
            message: 'missing or invalid bearer token',
          };
          res.writeHead(httpStatusFor(body.code), { 'content-type': 'application/json' });
          res.end(JSON.stringify(body));
          return;
        }
        handle(ctx, req, res).catch((err: unknown) =>
          console.error('storybrokr: request handler failed', err),
        );
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
      // `mode` on writeFileSync only applies when the file is newly created — a pre-existing
      // daemon.json (e.g. left over with looser perms) needs an explicit chmod too.
      writeFileSync(daemonFile(opts.home), `${JSON.stringify(info, null, 2)}\n`, { mode: 0o600 });
      chmodSync(daemonFile(opts.home), 0o600);
      reaper = setInterval(() => {
        opts.broker
          .reapIdle()
          .catch((err: unknown) => console.error('storybrokr: reaper failed', err));
      }, opts.config.reaperIntervalMs);
      reaper.unref();
      started = true;
      return info;
    },
    stop,
  };
}
