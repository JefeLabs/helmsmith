/**
 * The `--json` contract (spec docs/superpowers/specs/2026-11-07-gittyup-json-mode-design.md §3):
 * one JSON line on stdout on success; on failure an empty stdout, a JSON error
 * body as stderr's last line, exit 2 (refused) or 1 (broken).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanupFixtures } from '../../src/test/git-fixture.js';
import { createWorkspace, parseErrorLine, parseJsonLine, runCli, type Workspace } from './helpers.js';

let ws: Workspace | undefined;
afterEach(async () => {
  await ws?.cleanup();
  ws = undefined;
  await cleanupFixtures();
});

describe('--json contract: cache', () => {
  it('cache clear --json prints one document and no footer', async () => {
    ws = await createWorkspace();
    const r = await runCli(ws, ['cache', 'clear', '--json']);
    expect(r.exitCode).toBe(0);
    expect(parseJsonLine(r.stdout)).toStrictEqual({ cleared: 0 });
    expect(r.stdout).not.toContain('config:');
  });

  it('cache prune --json', async () => {
    ws = await createWorkspace();
    const r = await runCli(ws, ['cache', 'prune', '--json']);
    expect(r.exitCode).toBe(0);
    expect(parseJsonLine(r.stdout)).toStrictEqual({ pruned: 0 });
  });
});

describe('--json contract: usage errors', () => {
  it('an unknown option is USAGE, exit 2, empty stdout', async () => {
    ws = await createWorkspace();
    const r = await runCli(ws, ['cache', 'clear', '--json', '--bogus']);
    expect(r.exitCode).toBe(2);
    expect(r.stdout).toBe('');
    expect(parseErrorLine(r.stderr)).toMatchObject({
      code: 'USAGE',
      message: expect.stringMatching(/unknown option/),
    });
  });

  it.each([['connect'], ['init'], ['auth', 'login']])(
    '%s does not take --json → USAGE',
    async (...cmd) => {
      ws = await createWorkspace();
      const r = await runCli(ws, [...cmd, '--json']);
      expect(r.exitCode).toBe(2);
      expect(r.stdout).toBe('');
      expect(parseErrorLine(r.stderr).code).toBe('USAGE');
    },
  );

  it('text mode is untouched: no --json keeps the footer on stdout', async () => {
    ws = await createWorkspace();
    const r = await runCli(ws, ['cache', 'clear']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain(`config: ${ws.manifestPath}`);
  });
});
