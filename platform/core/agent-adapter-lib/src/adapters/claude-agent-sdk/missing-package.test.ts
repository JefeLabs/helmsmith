/**
 * claude-agent-sdk: a failed dynamic import of the optional peer package
 * (@anthropic-ai/claude-agent-sdk) must surface as a ConfigError — a
 * configuration problem — NOT a MissingCredentialError (Phase B2 item 14).
 *
 * Isolated in its own file so the dynamic import can be mocked to FAIL without
 * disturbing index.test.ts, which mocks it to SUCCEED.
 */

import { describe, expect, it, vi } from 'vitest';
import { ConfigError, MissingCredentialError } from '../../errors.ts';
import type { AdapterDeps } from '../../registry.ts';
import { ClaudeAgentSdkAdapter } from './index.ts';

// Force `import('@anthropic-ai/claude-agent-sdk')` (inside getQueryFn) to throw.
vi.mock('@anthropic-ai/claude-agent-sdk', () => {
  throw new Error("Cannot find package '@anthropic-ai/claude-agent-sdk'");
});

function makeDeps(): AdapterDeps {
  return { workdir: '/tmp/x', repoRoot: '/tmp/x', commit: 'abc', branch: 'main' };
}

describe('ClaudeAgentSdkAdapter — missing package', () => {
  it('throws ConfigError (not MissingCredentialError) when the SDK import fails', async () => {
    const adapter = new ClaudeAgentSdkAdapter(
      { type: 'claude-agent-sdk', model: 'claude-opus-4-7', apiKey: 'sk-test' },
      makeDeps(),
      'sk-test',
    );

    let caught: unknown;
    try {
      await adapter.invoke({ messages: [{ role: 'user', content: 'hi' }] });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ConfigError);
    expect(caught).not.toBeInstanceOf(MissingCredentialError);
  });
});
