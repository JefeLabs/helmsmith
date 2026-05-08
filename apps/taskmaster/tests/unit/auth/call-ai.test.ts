import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock provider-registry, token-manager, home, and fs
vi.mock('../../../src/auth/provider-registry.js', () => ({
  getProvider: vi.fn(),
}));

vi.mock('../../../src/auth/token-manager.js', () => ({
  readAuthFile: vi.fn(),
}));

vi.mock('../../../src/utils/home.js', () => ({
  getTaskmasterHome: vi.fn().mockReturnValue('/tmp/test-agentx/taskmaster'),
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    appendFileSync: vi.fn(),
    existsSync: vi.fn().mockReturnValue(true),
    mkdirSync: vi.fn(),
  };
});

import { appendFileSync } from 'node:fs';
import { callAI, resolveActiveAuth } from '../../../src/auth/call-ai.js';
import { getProvider } from '../../../src/auth/provider-registry.js';
import { readAuthFile } from '../../../src/auth/token-manager.js';

const mockedGetProvider = vi.mocked(getProvider);
const mockedReadAuthFile = vi.mocked(readAuthFile);
const mockedAppendFileSync = vi.mocked(appendFileSync);

function makeMockProvider(name: 'anthropic' | 'openai' | 'copilot', response?: object) {
  return {
    name: name as const,
    callAI: vi.fn().mockResolvedValue(
      response ?? { choices: [{ message: { content: 'response' } }] },
    ),
    resolveAuth: vi.fn(),
    login: vi.fn(),
    listModels: vi.fn(),
    logout: vi.fn(),
  };
}

describe('callAI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Suppress console.error output during tests
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('delegates to the specified provider', async () => {
    const mockProvider = makeMockProvider('anthropic');
    mockedGetProvider.mockReturnValue(mockProvider);

    const messages = [{ role: 'user' as const, content: 'hello' }];
    const result = await callAI(messages, 'claude-sonnet-4', 'anthropic');

    expect(mockedGetProvider).toHaveBeenCalledWith('anthropic');
    expect(mockProvider.callAI).toHaveBeenCalledWith(messages, 'claude-sonnet-4');
    expect(result.choices[0].message.content).toBe('response');
  });

  it('reads active_provider from auth file when no provider specified', async () => {
    mockedReadAuthFile.mockResolvedValue({ active_provider: 'openai' });

    const mockProvider = makeMockProvider('openai');
    mockedGetProvider.mockReturnValue(mockProvider);

    await callAI([{ role: 'user', content: 'test' }], 'gpt-4o');

    expect(mockedReadAuthFile).toHaveBeenCalled();
    expect(mockedGetProvider).toHaveBeenCalledWith('openai');
  });

  it('propagates provider errors', async () => {
    const mockProvider = makeMockProvider('copilot');
    mockProvider.callAI.mockRejectedValue(new Error('API unavailable'));
    mockedGetProvider.mockReturnValue(mockProvider);

    await expect(
      callAI([{ role: 'user', content: 'test' }], 'gpt-4o', 'copilot'),
    ).rejects.toThrow('API unavailable');
  });

  it('passes caller context through to the JSONL log', async () => {
    const mockProvider = makeMockProvider('anthropic', {
      choices: [{ message: { content: 'ok' } }],
      usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 },
    });
    mockedGetProvider.mockReturnValue(mockProvider);

    await callAI(
      [{ role: 'user', content: 'test' }],
      'claude-sonnet-4',
      'anthropic',
      'parser',
    );

    expect(mockedAppendFileSync).toHaveBeenCalledOnce();
    const logLine = mockedAppendFileSync.mock.calls[0][1] as string;
    const entry = JSON.parse(logLine.trim());
    expect(entry.caller).toBe('parser');
    expect(entry.provider).toBe('anthropic');
    expect(entry.model).toBe('claude-sonnet-4');
    expect(entry.input_tokens).toBe(100);
    expect(entry.output_tokens).toBe(50);
    expect(entry.status).toBe('ok');
  });

  it('logs to console with provider and model info', async () => {
    const consoleSpy = vi.spyOn(console, 'error');
    const mockProvider = makeMockProvider('openai', {
      choices: [{ message: { content: 'hi' } }],
      usage: { input_tokens: 200, output_tokens: 80, total_tokens: 280 },
    });
    mockedGetProvider.mockReturnValue(mockProvider);

    await callAI([{ role: 'user', content: 'test' }], 'gpt-4o', 'openai', 'scorer');

    // Should have at least 2 console.error calls: pre-call and post-call
    expect(consoleSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('uses "unknown" as default caller in log entry', async () => {
    const mockProvider = makeMockProvider('copilot', {
      choices: [{ message: { content: 'ok' } }],
    });
    mockedGetProvider.mockReturnValue(mockProvider);

    await callAI([{ role: 'user', content: 'test' }], 'gpt-4o', 'copilot');

    expect(mockedAppendFileSync).toHaveBeenCalledOnce();
    const logLine = mockedAppendFileSync.mock.calls[0][1] as string;
    const entry = JSON.parse(logLine.trim());
    expect(entry.caller).toBe('unknown');
  });

  it('does not throw when JSONL logging fails', async () => {
    mockedAppendFileSync.mockImplementation(() => {
      throw new Error('disk full');
    });

    const mockProvider = makeMockProvider('anthropic');
    mockedGetProvider.mockReturnValue(mockProvider);

    // Should not throw despite appendFileSync throwing
    const result = await callAI(
      [{ role: 'user', content: 'test' }],
      'claude-sonnet-4',
      'anthropic',
    );
    expect(result.choices[0].message.content).toBe('response');
  });

  it('includes usage data from provider in the returned response', async () => {
    const usage = {
      input_tokens: 500,
      output_tokens: 200,
      total_tokens: 700,
      content_types: ['thinking', 'text'],
    };
    const mockProvider = makeMockProvider('anthropic', {
      choices: [{ message: { content: 'result' } }],
      usage,
    });
    mockedGetProvider.mockReturnValue(mockProvider);

    const result = await callAI(
      [{ role: 'user', content: 'test' }],
      'claude-sonnet-4',
      'anthropic',
      'parser',
    );

    expect(result.usage).toEqual(usage);
  });
});

describe('resolveActiveAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('delegates to the specified provider resolveAuth', async () => {
    const mockProvider = makeMockProvider('anthropic');
    mockProvider.resolveAuth.mockResolvedValue({ source: 'auth.json (anthropic)' });
    mockedGetProvider.mockReturnValue(mockProvider);

    const result = await resolveActiveAuth('anthropic');

    expect(mockedGetProvider).toHaveBeenCalledWith('anthropic');
    expect(result).toEqual({ source: 'auth.json (anthropic)' });
  });

  it('reads active_provider from auth file when no provider specified', async () => {
    mockedReadAuthFile.mockResolvedValue({ active_provider: 'copilot' });

    const mockProvider = makeMockProvider('copilot');
    mockProvider.resolveAuth.mockResolvedValue({ source: 'env:GITHUB_TOKEN' });
    mockedGetProvider.mockReturnValue(mockProvider);

    const result = await resolveActiveAuth();

    expect(mockedReadAuthFile).toHaveBeenCalled();
    expect(mockedGetProvider).toHaveBeenCalledWith('copilot');
    expect(result).toEqual({ source: 'env:GITHUB_TOKEN' });
  });

  it('returns null when provider has no credentials', async () => {
    const mockProvider = makeMockProvider('openai');
    mockProvider.resolveAuth.mockResolvedValue(null);
    mockedGetProvider.mockReturnValue(mockProvider);

    const result = await resolveActiveAuth('openai');
    expect(result).toBeNull();
  });
});
