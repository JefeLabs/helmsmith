/**
 * LIVE integration test for GeminiCliAdapter.
 *
 * Gated on BOTH a real GEMINI_API_KEY and the `gemini` binary on PATH. Skipped
 * otherwise (CI, or a machine with only expired OAuth). Because the adapter
 * sandboxes $HOME, gemini's own ~/.gemini OAuth is unreachable, so a real
 * GEMINI_API_KEY is mandatory — exactly the contract under test.
 *
 * No spawn mock here (separate file) so a real `gemini -p` round-trip runs.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AdapterDeps } from '../../registry.ts';
import { resolveBinary } from '../shared/child-process.ts';
import { GeminiCliAdapter } from './index.ts';

function hasGemini(): boolean {
  try {
    resolveBinary('gemini');
    return true;
  } catch {
    return false;
  }
}

const ENABLED = Boolean(process.env.GEMINI_API_KEY) && hasGemini();

describe.skipIf(!ENABLED)('GeminiCliAdapter — live integration', () => {
  let workdir: string;

  beforeAll(() => {
    workdir = mkdtempSync(join(tmpdir(), 'gemini-cli-live-'));
    spawnSync('git', ['-C', workdir, 'init', '-q'], { encoding: 'utf8' });
  });

  afterAll(() => {
    spawnSync('rm', ['-rf', workdir]);
  });

  it('runs a real gemini round-trip and returns a text result', async () => {
    const deps: AdapterDeps = { workdir, repoRoot: workdir, commit: 'live', branch: 'main' };
    const apiKey = process.env.GEMINI_API_KEY as string;
    const adapter = new GeminiCliAdapter(
      { type: 'gemini-cli', model: 'gemini-2.5-flash', apiKey },
      deps,
      apiKey,
    );

    const result = await adapter.invoke({
      messages: [{ role: 'user', content: 'Reply with exactly the word: pong' }],
    });

    expect(result.content.toLowerCase()).toContain('pong');
    expect(result.finishReason).toBe('stop');
  }, 60000);
});
