import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateManifest } from './manifest.js';
import { isAlive, startServices, stopServices } from './runner.js';

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
});
