/**
 * LIVE integration test for ClaudeCodeCliAdapter.
 *
 * Gated on BOTH a real ANTHROPIC_API_KEY and the `claude` binary on PATH.
 * Skipped otherwise (e.g. in CI). Because the adapter sandboxes $HOME, the
 * CLI's own OAuth state is unreachable, so a real ANTHROPIC_API_KEY is
 * mandatory for this to pass — which is exactly the contract under test.
 *
 * No spawn mock here (separate file) so a real `claude -p` round-trip runs.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AdapterDeps } from '../../registry.ts';
import { resolveBinary } from '../shared/child-process.ts';
import { ClaudeCodeCliAdapter } from './index.ts';

function hasClaude(): boolean {
  try {
    resolveBinary('claude');
    return true;
  } catch {
    return false;
  }
}

const ENABLED = Boolean(process.env.ANTHROPIC_API_KEY) && hasClaude();

describe.skipIf(!ENABLED)('ClaudeCodeCliAdapter — live integration', () => {
  let workdir: string;

  beforeAll(() => {
    workdir = mkdtempSync(join(tmpdir(), 'claude-cli-live-'));
    spawnSync('git', ['-C', workdir, 'init', '-q'], { encoding: 'utf8' });
  });

  afterAll(() => {
    spawnSync('rm', ['-rf', workdir]);
  });

  it('runs a real claude round-trip and returns a text result', async () => {
    const deps: AdapterDeps = {
      workdir,
      repoRoot: workdir,
      commit: 'live',
      branch: 'main',
    };
    const apiKey = process.env.ANTHROPIC_API_KEY as string; // gated by ENABLED above
    const adapter = new ClaudeCodeCliAdapter(
      { type: 'claude-code-cli', model: 'sonnet', apiKey },
      deps,
      apiKey,
    );

    const result = await adapter.invoke({
      messages: [{ role: 'user', content: 'Reply with exactly the word: pong' }],
    });

    expect(result.content.toLowerCase()).toContain('pong');
    expect(result.finishReason).toBe('stop');
    expect(result.usage?.outputTokens).toBeGreaterThan(0);
  }, 60000);
});
