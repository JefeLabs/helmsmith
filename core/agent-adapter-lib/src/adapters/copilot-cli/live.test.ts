/**
 * LIVE integration test for CopilotCliAdapter (standalone `copilot`).
 *
 * Triple-gated and SKIPPED by default:
 *   1. the `copilot` binary is resolvable,
 *   2. a token is present (COPILOT_GITHUB_TOKEN / GH_TOKEN / GITHUB_TOKEN), AND
 *   3. COPILOT_CLI_LIVE=1 is set (explicit opt-in).
 *
 * The opt-in is deliberate: the standalone `copilot` is an AUTONOMOUS agent run
 * with --allow-all-tools. The adapter sandboxes $HOME/$TMPDIR + cwd to a
 * throwaway workdir to bound blast radius, but we still require the explicit flag
 * so CI / dev boxes never trigger it inadvertently. Skipping when the gates are
 * unmet is expected, not a failure.
 *
 * NOTE (env limitation captured during the rework): on the dev box used to build
 * this, the live model call was blocked by an org Copilot policy ("Access denied
 * by policy settings" / "not authorized to use this Copilot feature"), so this
 * test could not be exercised end-to-end. The argv/flags were verified against
 * `copilot --help` (v1.0.65) and the JSONL envelope shape against a real
 * `--output-format json` run (see fixtures/json-events.jsonl).
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AdapterDeps } from '../../registry.ts';
import { resolveBinary } from '../shared/child-process.ts';
import { CopilotCliAdapter } from './index.ts';

function hasCopilot(): boolean {
  try {
    resolveBinary('copilot');
    return true;
  } catch {
    return false;
  }
}

const TOKEN = process.env.COPILOT_GITHUB_TOKEN ?? process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
const ENABLED = hasCopilot() && Boolean(TOKEN) && process.env.COPILOT_CLI_LIVE === '1';

describe.skipIf(!ENABLED)('CopilotCliAdapter — live integration', () => {
  let workdir: string;

  beforeAll(() => {
    workdir = mkdtempSync(join(tmpdir(), 'copilot-cli-live-'));
    spawnSync('git', ['-C', workdir, 'init', '-q'], { encoding: 'utf8' });
  });

  afterAll(() => {
    spawnSync('rm', ['-rf', workdir]);
  });

  it('runs a real `copilot` round-trip and returns text', async () => {
    const deps: AdapterDeps = { workdir, repoRoot: workdir, commit: 'live', branch: 'main' };
    const adapter = new CopilotCliAdapter(
      { type: 'copilot-cli', model: 'gpt-4o' },
      deps,
      TOKEN as string,
    );
    const result = await adapter.invoke({
      messages: [{ role: 'user', content: 'Reply with exactly the word: pong' }],
    });
    expect(result.content.toLowerCase()).toContain('pong');
    expect(result.finishReason).toBe('stop');
  }, 180000);
});
