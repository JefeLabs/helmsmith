/**
 * `gitradar --demo` on a fresh machine (#93): it must render from in-memory data and
 * leave the real store untouched — no data dir, no DB, no config.
 */
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSandbox, runCli, type Sandbox } from './helpers.js';

describe('gitradar --demo', () => {
  let sb: Sandbox;
  beforeEach(async () => {
    sb = await createSandbox();
  });
  afterEach(async () => {
    await sb.cleanup();
  });

  it('starts on an empty HOME without touching the store and leaves no files behind', async () => {
    const r = await runCli(sb, ['--demo', '--weeks', '2'], { timeoutMs: 8_000 });
    expect(r.stdout).toMatch(/Demo mode: \d+ records generated/);
    expect(r.stderr).not.toMatch(/database could not be opened|--reset/);
    expect(existsSync(join(sb.gitradarHome, 'data'))).toBe(false);
    expect(existsSync(join(sb.gitradarHome, 'config.yml'))).toBe(false);
    // Nothing created under the sandbox HOME except what the launcher itself needs.
    const home = await readdir(sb.home);
    expect(home.filter((f) => f === '.agentx')).toEqual([]);
  });
});
