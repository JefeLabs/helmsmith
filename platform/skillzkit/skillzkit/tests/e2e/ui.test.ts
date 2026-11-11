/**
 * `skillzkit ui` starts the TUI in a second Bun process (src/commands/ui.ts). That process
 * must start from the built package, and, like bin/skillzkit.mjs, must not read `bunfig.toml`
 * or `.env` from the current directory: a `bunfig.toml` `preload` runs arbitrary code, and
 * this CLI is run inside cloned repos (same class as helmsmith#69).
 *
 * These tests drive the real launcher as a user would: wait for the TUI's first frame,
 * press `q`, and expect `ui` to exit 0.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const APP = resolve(import.meta.dirname, '../..');
const BIN = join(APP, 'bin', 'skillzkit.mjs');
/** Text in the TUI's first frame (the catalog pane's label). */
const FIRST_FRAME = 'Catalog';

// dist/cli.js and dist/tui.js are built by this suite's vitest globalSetup.

interface Sandbox {
  root: string;
  home: string;
  cwd: string;
  target: string;
  config: string;
}

let sb: Sandbox;
beforeEach(() => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'skillzkit-ui-')));
  sb = {
    root,
    home: join(root, 'home'),
    cwd: join(root, 'cwd'),
    target: join(root, 'target'),
    config: join(root, 'config.json'),
  };
  for (const d of [sb.home, sb.cwd, sb.target]) mkdirSync(d);
  // A standalone config, so `ui` skips first-run setup and the TUI reads the bundled catalog.
  writeFileSync(
    sb.config,
    JSON.stringify({
      version: 1,
      mode: 'standalone',
      email: 'ui-test@example.com',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }),
  );
});
afterEach(() => {
  rmSync(sb.root, { recursive: true, force: true });
});

/**
 * Run `skillzkit ui`, press `q` once the TUI has drawn, and wait for it to exit. The TUI is a
 * grandchild (launcher → CLI → TUI), so the run gets its own process group and is killed as
 * a group if it outlives the timeout or leaves anything behind.
 *
 * `q` is pressed every 200ms until the TUI exits, not once: the first frame is drawn before
 * React registers the TUI's keyboard handler, and a key that arrives in between is dropped.
 * On a busy CI runner a single `q` sent on the first frame was lost and the run timed out.
 */
async function runUi(s: Sandbox): Promise<{ status: number | null; out: string }> {
  const child = spawn(process.execPath, [BIN, 'ui', '--target', s.target], {
    cwd: s.cwd,
    env: { PATH: process.env.PATH ?? '', HOME: s.home, SKILLZKIT_CONFIG: s.config },
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: true,
  });
  const killGroup = () => {
    try {
      if (child.pid) process.kill(-child.pid, 'SIGKILL');
    } catch {
      // ESRCH: nothing left in the group.
    }
  };
  let out = '';
  let pressQ: NodeJS.Timeout | undefined;
  const onData = (chunk: Buffer) => {
    out += chunk.toString();
    if (!pressQ && out.includes(FIRST_FRAME)) {
      child.stdin.write('q');
      pressQ = setInterval(() => child.stdin.write('q'), 200);
    }
  };
  // EPIPE from a `q` written as the TUI exits is expected.
  child.stdin.on('error', () => {});
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  const status = await new Promise<number | null>((done) => {
    const timer = setTimeout(killGroup, 30_000);
    child.on('exit', (code) => {
      clearTimeout(timer);
      clearInterval(pressQ);
      done(code);
    });
  });
  killGroup();
  return { status, out };
}

describe('skillzkit ui', () => {
  it('starts the TUI from the built package, and q exits 0', async () => {
    const r = await runUi(sb);
    expect(r.out).not.toContain('TUI entry not found');
    expect(r.out).toContain(FIRST_FRAME);
    expect(r.status).toBe(0);
  }, 60_000);

  it('does not run a bunfig.toml preload from the current directory in the TUI process', async () => {
    const marker = join(sb.root, 'PWNED');
    writeFileSync(join(sb.cwd, 'bunfig.toml'), 'preload = ["./evil.ts"]\n');
    writeFileSync(
      join(sb.cwd, 'evil.ts'),
      `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(marker)}, 'preload ran');\n`,
    );
    const r = await runUi(sb);
    // Sanity: the TUI process really started, so a missing marker means something.
    expect(r.out).toContain(FIRST_FRAME);
    expect(existsSync(marker)).toBe(false);
  }, 60_000);
});
