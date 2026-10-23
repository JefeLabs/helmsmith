import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { makeSandbox, runCli, type Sandbox } from './helpers.js';

let sb: Sandbox | undefined;
afterEach(() => {
  sb?.cleanup();
  sb = undefined;
});

describe('state under PRITTY_HOME', () => {
  it('cache path and cache clear use PRITTY_HOME and never touch HOME', async () => {
    sb = makeSandbox();
    const cacheFile = join(sb.prittyHome, 'cache.json');

    const path = await runCli(sb, sb.root, ['cache', 'path']);
    expect(path.exitCode).toBe(0);
    expect(path.stdout.trim()).toBe(cacheFile);

    mkdirSync(sb.prittyHome, { recursive: true });
    writeFileSync(cacheFile, `${JSON.stringify({ version: 1, tickets: {} })}\n`);
    const clear = await runCli(sb, sb.root, ['cache', 'clear']);
    expect(clear.exitCode).toBe(0);
    expect(existsSync(cacheFile)).toBe(false);
    expect(readdirSync(sb.home)).toEqual([]);
  });

  it('auth status lists stored providers without printing the token; logout removes them', async () => {
    sb = makeSandbox();
    const authFile = join(sb.prittyHome, 'auth.json');

    const before = await runCli(sb, sb.root, ['auth', 'status']);
    expect(before.exitCode).toBe(0);
    expect(before.stdout).toContain('Not logged in');

    // Assembled at runtime so no token-shaped literal sits in the source.
    const token = ['gho', `e2e${'0'.repeat(33)}`].join('_');
    mkdirSync(sb.prittyHome, { recursive: true });
    writeFileSync(
      authFile,
      JSON.stringify({
        version: 1,
        providers: {
          'github-copilot': {
            apiKey: token,
            scope: 'read:user',
            createdAt: '2026-10-23T00:00:00.000Z',
          },
        },
      }),
    );
    const status = await runCli(sb, sb.root, ['auth', 'status']);
    expect(status.exitCode).toBe(0);
    expect(status.stdout).toContain('github-copilot');
    expect(status.stdout).toContain('read:user');
    expect(status.stdout + status.stderr).not.toContain(token);

    const logout = await runCli(sb, sb.root, ['auth', 'logout']);
    expect(logout.exitCode).toBe(0);
    expect(existsSync(authFile)).toBe(false);

    const after = await runCli(sb, sb.root, ['auth', 'status']);
    expect(after.stdout).toContain('Not logged in');
  });
});
