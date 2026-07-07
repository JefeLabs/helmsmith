/**
 * LIVE integration test for CodexCliAdapter.
 *
 * Gated on BOTH a real OPENAI_API_KEY and the `codex` binary on PATH. Skipped
 * otherwise (CI, or a machine with only ChatGPT OAuth / a deactivated
 * workspace). Because the adapter sandboxes $HOME, codex's own ~/.codex
 * auth.json is unreachable, so a real OPENAI_API_KEY is mandatory — exactly the
 * contract under test.
 *
 * No spawn mock here (separate file) so a real `codex exec` round-trip runs.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AdapterDeps } from '../../registry.ts';
import { resolveBinary } from '../shared/child-process.ts';
import { CodexCliAdapter } from './index.ts';

function hasCodex(): boolean {
  try {
    resolveBinary('codex');
    return true;
  } catch {
    return false;
  }
}

const ENABLED = Boolean(process.env.OPENAI_API_KEY) && hasCodex();

describe.skipIf(!ENABLED)('CodexCliAdapter — live integration', () => {
  let workdir: string;

  beforeAll(() => {
    workdir = mkdtempSync(join(tmpdir(), 'codex-cli-live-'));
    spawnSync('git', ['-C', workdir, 'init', '-q'], { encoding: 'utf8' });
  });

  afterAll(() => {
    spawnSync('rm', ['-rf', workdir]);
  });

  it('runs a real codex exec round-trip and returns a text result', async () => {
    const deps: AdapterDeps = { workdir, repoRoot: workdir, commit: 'live', branch: 'main' };
    const apiKey = process.env.OPENAI_API_KEY as string;
    const adapter = new CodexCliAdapter(
      { type: 'codex-cli', model: 'gpt-5-codex', apiKey, sandboxMode: 'read-only' },
      deps,
      apiKey,
    );

    const result = await adapter.invoke({
      messages: [{ role: 'user', content: 'Reply with exactly the word: pong' }],
    });

    expect(result.content.toLowerCase()).toContain('pong');
    expect(result.finishReason).toBe('stop');
  }, 120000);
});
