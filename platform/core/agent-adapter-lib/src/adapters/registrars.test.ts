/**
 * Every adapter exposes an explicit registrar that registers exactly its own
 * type — and importing the module registers nothing on its own.
 *
 * This is the contract that lets a host carry only the providers it uses: the
 * import is inert, the registration is a statement you can see.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import type { AgentSpecType } from '../agent.ts';
import { _clearRegistry, getAdapterFactory, registeredAdapterTypes } from '../registry.ts';
import { registerBedrockSdk } from './bedrock-sdk/index.ts';
import { registerClaudeAgentSdk } from './claude-agent-sdk/index.ts';
import { registerClaudeCodeCli } from './claude-code-cli/index.ts';
import { registerClaudeSdk } from './claude-sdk/index.ts';
import { registerCodexCli } from './codex-cli/index.ts';
import { registerCopilotCli } from './copilot-cli/index.ts';
import { registerCopilotSdk } from './copilot-sdk/index.ts';
import { registerGeminiCli } from './gemini-cli/index.ts';
import { registerGeminiSdk } from './gemini-sdk/index.ts';
import { registerOpenAiSdk } from './openai-sdk/index.ts';
import { registerOpenCodeCli } from './opencode-cli/index.ts';

const REGISTRARS: [AgentSpecType, () => void][] = [
  ['claude-sdk', registerClaudeSdk],
  ['claude-agent-sdk', registerClaudeAgentSdk],
  ['claude-code-cli', registerClaudeCodeCli],
  ['opencode-cli', registerOpenCodeCli],
  ['copilot-sdk', registerCopilotSdk],
  ['copilot-cli', registerCopilotCli],
  ['gemini-cli', registerGeminiCli],
  ['gemini-sdk', registerGeminiSdk],
  ['openai-sdk', registerOpenAiSdk],
  ['codex-cli', registerCodexCli],
  ['bedrock-sdk', registerBedrockSdk],
];

describe('adapter registrars', () => {
  beforeEach(() => _clearRegistry());

  it('covers all 11 built-in adapters', () => {
    expect(REGISTRARS).toHaveLength(11);
  });

  it.each(REGISTRARS)('the %s registrar registers exactly that type', (type, register) => {
    register();
    expect(registeredAdapterTypes()).toEqual([type]);
    expect(getAdapterFactory(type)).toBeDefined();
  });

  it('is idempotent — calling a registrar twice registers once', () => {
    registerCodexCli();
    registerCodexCli();
    expect(registeredAdapterTypes()).toEqual(['codex-cli']);
  });

  it('composes — a host registers exactly the set it asked for', () => {
    registerCodexCli();
    registerCopilotCli();
    registerGeminiCli();
    expect(new Set(registeredAdapterTypes())).toEqual(
      new Set(['codex-cli', 'copilot-cli', 'gemini-cli']),
    );
  });
});
