/**
 * The `config: <path> [<location>]` footer every text command prints must name where the
 * manifest really came from.
 */
import { mkdir, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createWorkspace, runCli, type Workspace } from './helpers.js';

let ws: Workspace | undefined;
afterEach(async () => {
  await ws?.cleanup();
  ws = undefined;
});

describe('config footer location', () => {
  it('labels a gittyup.yaml found from the working directory [workspace], not [home]', async () => {
    ws = await createWorkspace();

    const r = await runCli(ws, ['repo', 'list']);

    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain(`config: ${ws.manifestPath} [workspace]`);
  });

  it('still labels the global manifest [home]', async () => {
    ws = await createWorkspace();
    // runCli sets HOME to the workspace; the global manifest lives under ~/.helmsmith/gittyup.
    const homeDir = join(ws.dir, '.helmsmith', 'gittyup');
    await mkdir(homeDir, { recursive: true });
    const homeManifest = join(homeDir, 'gittyup.yaml');
    await rename(ws.manifestPath, homeManifest);

    const r = await runCli(ws, ['repo', 'list']);

    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain(`config: ${homeManifest} [home]`);
  });
});
