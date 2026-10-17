import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { Registry } from './registry.js';

const run = promisify(execFile);
const child = fileURLToPath(new URL('./testing/alloc-child.ts', import.meta.url));
const tsx = fileURLToPath(new URL('../../../../node_modules/.bin/tsx', import.meta.url));

describe('Registry across processes', () => {
  let home = '';
  afterEach(() => {
    if (home) rmSync(home, { recursive: true, force: true });
  });

  it('six processes allocating three slots each never share one', async () => {
    home = mkdtempSync(join(tmpdir(), 'wk-mp-'));
    Registry.open(home).upsertProject('mp', { root: '/mp', ranges: {} });
    const outs = await Promise.all(
      Array.from({ length: 6 }, () =>
        run(tsx, [child, home, 'mp', '30', '3'], { env: process.env }),
      ),
    );
    const slots = outs.flatMap((o) => o.stdout.trim().split(',').map(Number));
    expect(slots).toHaveLength(18);
    expect(new Set(slots).size).toBe(18);
    expect(Registry.open(home).leases({ kind: 'slot' })).toHaveLength(18);
  });
});
