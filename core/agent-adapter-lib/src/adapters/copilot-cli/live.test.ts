/**
 * LIVE integration test for CopilotCliAdapter.
 *
 * Triple-gated and SKIPPED by default:
 *   1. the `gh` binary is resolvable,
 *   2. a GitHub token is present (GH_TOKEN or GITHUB_TOKEN), AND
 *   3. COPILOT_CLI_LIVE=1 is set (explicit opt-in).
 *
 * The opt-in is deliberate: the installed `gh copilot` v1.2.0 is the AGENTIC
 * Copilot CLI (not the old `suggest` shell-helper), so a live run launches an
 * autonomous agent with --allow-all-tools. The adapter sandboxes $HOME/$TMPDIR
 * + cwd to a throwaway workdir to bound blast radius, but we still require the
 * explicit flag so CI / dev boxes never trigger it inadvertently. Skipping when
 * the gates are unmet is expected, not a failure.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AdapterDeps } from '../../registry.ts';
import { resolveBinary } from '../shared/child-process.ts';
import { CopilotCliAdapter } from './index.ts';

function hasGh(): boolean {
  try {
    resolveBinary('gh');
    return true;
  } catch {
    return false;
  }
}

const TOKEN = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
const ENABLED = hasGh() && Boolean(TOKEN) && process.env.COPILOT_CLI_LIVE === '1';

describe.skipIf(!ENABLED)('CopilotCliAdapter — live integration', () => {
  let workdir: string;

  beforeAll(() => {
    workdir = mkdtempSync(join(tmpdir(), 'copilot-cli-live-'));
    spawnSync('git', ['-C', workdir, 'init', '-q'], { encoding: 'utf8' });
  });

  afterAll(() => {
    spawnSync('rm', ['-rf', workdir]);
  });

  it('runs a real `gh copilot` round-trip and returns text', async () => {
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
