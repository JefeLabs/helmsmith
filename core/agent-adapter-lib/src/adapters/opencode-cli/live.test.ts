/**
 * LIVE integration test for OpenCodeCliAdapter.
 *
 * Gated on BOTH the `opencode` binary AND a real provider API KEY in the env
 * (ANTHROPIC_API_KEY or OPENAI_API_KEY). Skipped otherwise.
 *
 * IMPORTANT: the adapter sandboxes $HOME, so opencode's own credential store
 * (~/.local/share/opencode/auth.json — OAuth for ChatGPT/Copilot) is
 * UNREACHABLE. A live run therefore requires a plain API-key env var, which is
 * exactly the sandbox contract under test. In a dev box that only has OAuth
 * logins (the common case), this suite skips — that is expected, not a failure.
 *
 * Override the model via OPENCODE_LIVE_MODEL (default picks per available key).
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AdapterDeps } from '../../registry.ts';
import { resolveBinary } from '../shared/child-process.ts';
import { OpenCodeCliAdapter } from './index.ts';

function hasOpencode(): boolean {
  try {
    resolveBinary('opencode');
    return true;
  } catch {
    return false;
  }
}

const ANTHROPIC = process.env.ANTHROPIC_API_KEY;
const OPENAI = process.env.OPENAI_API_KEY;
const KEY = ANTHROPIC ?? OPENAI;
const MODEL =
  process.env.OPENCODE_LIVE_MODEL ??
  (ANTHROPIC ? 'anthropic/claude-sonnet-4-6' : 'openai/gpt-5.4-mini');
const PROVIDER = ANTHROPIC ? 'anthropic' : 'openai';

const ENABLED = Boolean(KEY) && hasOpencode();

describe.skipIf(!ENABLED)('OpenCodeCliAdapter — live integration', () => {
  let workdir: string;

  beforeAll(() => {
    workdir = mkdtempSync(join(tmpdir(), 'opencode-cli-live-'));
    spawnSync('git', ['-C', workdir, 'init', '-q'], { encoding: 'utf8' });
  });

  afterAll(() => {
    spawnSync('rm', ['-rf', workdir]);
  });

  it('runs a real opencode round-trip and returns a text result', async () => {
    const deps: AdapterDeps = { workdir, repoRoot: workdir, commit: 'live', branch: 'main' };
    const adapter = new OpenCodeCliAdapter(
      { type: 'opencode-cli', model: MODEL, provider: PROVIDER, apiKey: KEY as string },
      deps,
      KEY as string,
    );

    const result = await adapter.invoke({
      messages: [{ role: 'user', content: 'Reply with exactly the word: pong' }],
    });

    expect(result.content.toLowerCase()).toContain('pong');
    expect(result.finishReason).toBe('stop');
  }, 90000);
});
