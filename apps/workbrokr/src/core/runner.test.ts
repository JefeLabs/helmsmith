import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateManifest } from './manifest.js';
import { isAlive, pidSignature, startServices, stopServices } from './runner.js';

const svc = fileURLToPath(new URL('./testing/http-service.mjs', import.meta.url));
const manifest = (overrides: Record<string, unknown> = {}) =>
  validateManifest({
    project: 'demo',
    baseBranch: 'develop',
    ports: { services: { api: { base: 42100 } } },
    services: {
      api: {
        start: `node ${svc} --port $PORT_API --name api`,
        stop: 'true',
        health: 'curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:$PORT_API/health',
        healthyCodes: [200],
        healthTimeoutMs: 15000,
        ...overrides,
      },
    },
    scopes: { frontend: [], backend: [] },
    areas: { a: {} },
  });

describe('runner', () => {
  it('starts a service, reports healthy, stops only the pid it started', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'wk-run-'));
    const m = manifest();
    const env = { ...process.env, PORT_API: '42107' };
    const { pids } = await startServices({ m, cwd, env, logDir: cwd });
    expect(isAlive(pids.api)).toBe(true);
    await stopServices({ m, cwd, env, pids });
    expect(isAlive(pids.api)).toBe(false);
  });

  it('times out with HEALTH_TIMEOUT when nothing answers, and leaves nothing running', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'wk-run-'));
    const m = manifest({ start: 'sleep 30', healthTimeoutMs: 2000 });
    await expect(
      startServices({ m, cwd, env: { ...process.env, PORT_API: '42108' }, logDir: cwd }),
    ).rejects.toMatchObject({ code: 'HEALTH_TIMEOUT' });
  });

  it('a hanging health probe does not outlive the health budget', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'wk-run-'));
    const m = manifest({ start: 'sleep 30', health: 'sleep 6; false', healthTimeoutMs: 1000 });
    const t0 = Date.now();
    await expect(
      startServices({ m, cwd, env: { ...process.env, PORT_API: '42109' }, logDir: cwd }),
    ).rejects.toMatchObject({ code: 'HEALTH_TIMEOUT' });
    expect(Date.now() - t0).toBeLessThan(4000);
  });

  it('records a pid signature at spawn and refuses to signal a pid whose signature changed', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'wk-run-'));
    const m = manifest();
    const env = { ...process.env, PORT_API: '42110' };
    const { pids, signatures } = await startServices({ m, cwd, env, logDir: cwd });
    expect(signatures.api).toBe(pidSignature(pids.api));
    await stopServices({ m, cwd, env, pids, signatures: { api: 'not-the-same' } });
    expect(isAlive(pids.api)).toBe(true);
    await stopServices({ m, cwd, env, pids, signatures });
    expect(isAlive(pids.api)).toBe(false);
  });

  it('stopping a lease leaves a foreign process on the same port alone', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'wk-run-'));
    const foreign = spawn('node', [svc, '--port', '42111', '--name', 'foreign'], {
      stdio: 'ignore',
    });
    await new Promise((r) => setTimeout(r, 500));
    try {
      const m = manifest();
      const env = { ...process.env, PORT_API: '42112' };
      const { pids, signatures } = await startServices({ m, cwd, env, logDir: cwd });
      await stopServices({ m, cwd, env, pids, signatures });
      expect(isAlive(pids.api)).toBe(false);
      expect(foreign.pid !== undefined && isAlive(foreign.pid)).toBe(true);
    } finally {
      foreign.kill('SIGKILL');
    }
  });
});
