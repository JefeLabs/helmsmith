/**
 * Conformance driving test (PRD §5, §13 D5, Phase E) — the keystone.
 *
 * Runs the reusable conformance suite (./conformance) against ALL 11 built-in
 * adapters with their backends MOCKED (per-adapter injection: the SDK packages
 * via vi.mock, the CLIs via a node:child_process.spawn replacement, copilot-sdk
 * via an injected fetchFn). Every adapter passing its capability-appropriate
 * scenarios is the swap-compatibility guarantee.
 *
 * The mocks are deterministic + input-driven (see ./conformance/fixtures) so the
 * suite runs with NO network and NO real subprocess in CI.
 */

import { describe, expect, it, vi } from 'vitest';

// --- Backend mocks (hoisted). Each delegates to the conformance fixtures. -----
vi.mock('@anthropic-ai/sdk', async () => {
  const fx = await import('./conformance/fixtures/index.ts');
  return fx.makeAnthropicMockModule();
});
vi.mock('openai', async () => {
  const fx = await import('./conformance/fixtures/index.ts');
  return fx.makeOpenAiMockModule();
});
vi.mock('@google/genai', async () => {
  const fx = await import('./conformance/fixtures/index.ts');
  return fx.makeGeminiMockModule();
});
vi.mock('@aws-sdk/client-bedrock-runtime', async () => {
  const fx = await import('./conformance/fixtures/index.ts');
  return fx.makeBedrockMockModule();
});
vi.mock('@anthropic-ai/claude-agent-sdk', async () => {
  const fx = await import('./conformance/fixtures/index.ts');
  return fx.makeClaudeAgentMockModule();
});
vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
  const fx = await import('./conformance/fixtures/index.ts');
  return { ...actual, spawn: fx.conformanceSpawn };
});

// --- The 11 adapter factories (importing also runs their self-registration). --
import { BedrockSdkAdapter } from './adapters/bedrock-sdk/index.ts';
import { ClaudeAgentSdkAdapter } from './adapters/claude-agent-sdk/index.ts';
import { ClaudeCodeCliAdapter } from './adapters/claude-code-cli/index.ts';
import { ClaudeSdkAdapter } from './adapters/claude-sdk/index.ts';
import { CodexCliAdapter } from './adapters/codex-cli/index.ts';
import { CopilotCliAdapter } from './adapters/copilot-cli/index.ts';
import { CopilotSdkAdapter } from './adapters/copilot-sdk/index.ts';
import { GeminiCliAdapter } from './adapters/gemini-cli/index.ts';
import { GeminiSdkAdapter } from './adapters/gemini-sdk/index.ts';
import { OpenAiSdkAdapter } from './adapters/openai-sdk/index.ts';
import { OpenCodeCliAdapter } from './adapters/opencode-cli/index.ts';
import type { AgentAdapter, AgentSpecType } from './agent.ts';
import { makeCopilotFetch } from './conformance/fixtures/index.ts';
import { runConformance } from './conformance/index.ts';
import type { AdapterDeps } from './registry.ts';

// /bin/sh is a real executable on macOS + Linux, so resolveBinary (which uses
// the un-mocked node:fs accessSync) resolves it; spawn is then the mock.
const BIN = '/bin/sh';

function deps(): AdapterDeps {
  return { workdir: '/work/dir', repoRoot: '/work/dir', commit: 'abc123', branch: 'main' };
}

interface AdapterEntry {
  type: AgentSpecType;
  make: () => AgentAdapter;
}

const ADAPTERS: AdapterEntry[] = [
  {
    type: 'claude-sdk',
    make: () =>
      new ClaudeSdkAdapter({ type: 'claude-sdk', model: 'claude-opus-4-7' }, deps(), 'sk-test'),
  },
  {
    type: 'claude-agent-sdk',
    make: () =>
      new ClaudeAgentSdkAdapter(
        { type: 'claude-agent-sdk', model: 'claude-opus-4-7' },
        deps(),
        'sk-test',
      ),
  },
  {
    type: 'openai-sdk',
    make: () => new OpenAiSdkAdapter({ type: 'openai-sdk', model: 'gpt-4o' }, deps(), 'sk-test'),
  },
  {
    type: 'gemini-sdk',
    make: () =>
      new GeminiSdkAdapter({ type: 'gemini-sdk', model: 'gemini-2.5-pro' }, deps(), 'gm-test'),
  },
  {
    type: 'bedrock-sdk',
    make: () =>
      new BedrockSdkAdapter(
        { type: 'bedrock-sdk', model: 'anthropic.claude-3-5-sonnet', region: 'us-east-1' },
        deps(),
      ),
  },
  {
    type: 'copilot-sdk',
    make: () =>
      new CopilotSdkAdapter(
        { type: 'copilot-sdk', model: 'gpt-4o' },
        deps(),
        'copilot-tok',
        makeCopilotFetch(),
      ),
  },
  {
    type: 'claude-code-cli',
    make: () =>
      new ClaudeCodeCliAdapter(
        { type: 'claude-code-cli', model: 'claude-sonnet-4-6', binaryPath: BIN },
        deps(),
        'sk-test',
      ),
  },
  {
    type: 'opencode-cli',
    make: () =>
      new OpenCodeCliAdapter(
        { type: 'opencode-cli', model: 'anthropic/claude-opus-4-7', binaryPath: BIN },
        deps(),
        'sk-test',
      ),
  },
  {
    type: 'gemini-cli',
    make: () =>
      new GeminiCliAdapter(
        { type: 'gemini-cli', model: 'gemini-2.5-pro', binaryPath: BIN },
        deps(),
        'gm-test',
      ),
  },
  {
    type: 'codex-cli',
    make: () =>
      new CodexCliAdapter(
        { type: 'codex-cli', model: 'gpt-5-codex', binaryPath: BIN },
        deps(),
        'sk-test',
      ),
  },
  {
    type: 'copilot-cli',
    make: () =>
      new CopilotCliAdapter(
        { type: 'copilot-cli', model: 'gpt-4o', binaryPath: BIN },
        deps(),
        'gho_test',
      ),
  },
];

describe('conformance suite — all 11 adapters are swap-compatible', () => {
  it('covers exactly the 11 built-in adapter types', () => {
    expect(ADAPTERS.map((a) => a.type).sort()).toEqual(
      [
        'bedrock-sdk',
        'claude-agent-sdk',
        'claude-code-cli',
        'claude-sdk',
        'codex-cli',
        'copilot-cli',
        'copilot-sdk',
        'gemini-cli',
        'gemini-sdk',
        'openai-sdk',
        'opencode-cli',
      ].sort(),
    );
  });

  for (const { type, make } of ADAPTERS) {
    it(`${type} passes its capability-appropriate scenarios`, async () => {
      const report = await runConformance(make);
      // A readable failure list on mismatch (each item is "scenario: reason").
      expect(report.failures.map((f) => `${f.name}: ${f.reason}`)).toEqual([]);
      expect(report.failed).toBe(0);
      expect(report.passed).toBeGreaterThan(0);
      expect(report.adapterType).toBe(type);
    });
  }
});

describe('conformance suite — capability-aware scenario routing', () => {
  it('the 6 autonomous adapters surface a BUILT-IN tool call (no custom tools)', async () => {
    for (const type of [
      'claude-agent-sdk',
      'claude-code-cli',
      'opencode-cli',
      'gemini-cli',
      'codex-cli',
    ] as const) {
      const entry = ADAPTERS.find((a) => a.type === type)!;
      const report = await runConformance(entry.make);
      const toolUse = report.results.find((r) => r.name === 'tool-use');
      expect(toolUse?.status, `${type} tool-use`).toBe('pass');
    }
  });

  it('the 5 host-loop adapters accept + surface a CUSTOM tool call', async () => {
    for (const type of [
      'claude-sdk',
      'openai-sdk',
      'gemini-sdk',
      'copilot-sdk',
      'bedrock-sdk',
    ] as const) {
      const entry = ADAPTERS.find((a) => a.type === type)!;
      const report = await runConformance(entry.make);
      const toolUse = report.results.find((r) => r.name === 'tool-use');
      expect(toolUse?.status, `${type} tool-use`).toBe('pass');
    }
  });

  it('copilot-cli (autonomous, non-streaming) auto-skips tool-use, usage, and thinking', async () => {
    const entry = ADAPTERS.find((a) => a.type === 'copilot-cli')!;
    const report = await runConformance(entry.make);
    const statusOf = (name: string) => report.results.find((r) => r.name === name)?.status;
    expect(statusOf('tool-use')).toBe('skip');
    expect(statusOf('usage')).toBe('skip');
    expect(statusOf('extended-thinking')).toBe('skip');
    expect(statusOf('json-mode')).toBe('skip');
    // It still passes the core swap-compat scenarios.
    expect(statusOf('echo')).toBe('pass');
    expect(statusOf('multi-turn')).toBe('pass');
    expect(statusOf('abort')).toBe('pass');
    expect(statusOf('malformed')).toBe('pass');
    expect(report.failed).toBe(0);
  });

  it('only the json-mode-capable adapters run the json-mode scenario', async () => {
    for (const { type, make } of ADAPTERS) {
      const report = await runConformance(make);
      const jsonMode = report.results.find((r) => r.name === 'json-mode');
      const expected = type === 'openai-sdk' || type === 'gemini-sdk' ? 'pass' : 'skip';
      expect(jsonMode?.status, `${type} json-mode`).toBe(expected);
    }
  });

  it('skipScenarios honours an explicit per-adapter skip list', async () => {
    const entry = ADAPTERS.find((a) => a.type === 'claude-sdk')!;
    const report = await runConformance(entry.make, { skipScenarios: ['echo'] });
    const echo = report.results.find((r) => r.name === 'echo');
    expect(echo?.status).toBe('skip');
    expect(echo?.reason).toBe('skipScenarios');
  });
});
