import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock provider-registry and token-manager
vi.mock('../../../src/auth/provider-registry.js', () => ({
  getProvider: vi.fn(),
}));

vi.mock('../../../src/auth/token-manager.js', () => ({
  readAuthFile: vi.fn(),
}));

import { callAI, resolveActiveAuth } from '../../../src/auth/call-ai.js';
import { getProvider } from '../../../src/auth/provider-registry.js';
import { readAuthFile } from '../../../src/auth/token-manager.js';

const mockedGetProvider = vi.mocked(getProvider);
const mockedReadAuthFile = vi.mocked(readAuthFile);

describe('callAI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('delegates to the specified provider', async () => {
    const mockProvider = {
      name: 'anthropic' as const,
      callAI: vi.fn().mockResolvedValue({
        choices: [{ message: { content: 'response' } }],
      }),
      resolveAuth: vi.fn(),
      login: vi.fn(),
      listModels: vi.fn(),
      logout: vi.fn(),
    };
    mockedGetProvider.mockReturnValue(mockProvider);

    const messages = [{ role: 'user' as const, content: 'hello' }];
    const result = await callAI(messages, 'claude-sonnet-4', 'anthropic');

    expect(mockedGetProvider).toHaveBeenCalledWith('anthropic');
    expect(mockProvider.callAI).toHaveBeenCalledWith(messages, 'claude-sonnet-4');
    expect(result.choices[0].message.content).toBe('response');
  });

  it('reads active_provider from auth file when no provider specified', async () => {
    mockedReadAuthFile.mockResolvedValue({ active_provider: 'openai' });

    const mockProvider = {
      name: 'openai' as const,
      callAI: vi.fn().mockResolvedValue({
        choices: [{ message: { content: 'openai response' } }],
      }),
      resolveAuth: vi.fn(),
      login: vi.fn(),
      listModels: vi.fn(),
      logout: vi.fn(),
    };
    mockedGetProvider.mockReturnValue(mockProvider);

    await callAI([{ role: 'user', content: 'test' }], 'gpt-4o');

    expect(mockedReadAuthFile).toHaveBeenCalled();
    expect(mockedGetProvider).toHaveBeenCalledWith('openai');
  });

  it('propagates provider errors', async () => {
    const mockProvider = {
      name: 'copilot' as const,
      callAI: vi.fn().mockRejectedValue(new Error('API unavailable')),
      resolveAuth: vi.fn(),
      login: vi.fn(),
      listModels: vi.fn(),
      logout: vi.fn(),
    };
    mockedGetProvider.mockReturnValue(mockProvider);

    await expect(
      callAI([{ role: 'user', content: 'test' }], 'gpt-4o', 'copilot'),
    ).rejects.toThrow('API unavailable');
  });
});

describe('resolveActiveAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('delegates to the specified provider resolveAuth', async () => {
    const mockProvider = {
      name: 'anthropic' as const,
      callAI: vi.fn(),
      resolveAuth: vi.fn().mockResolvedValue({ source: 'auth.json (anthropic)' }),
      login: vi.fn(),
      listModels: vi.fn(),
      logout: vi.fn(),
    };
    mockedGetProvider.mockReturnValue(mockProvider);

    const result = await resolveActiveAuth('anthropic');

    expect(mockedGetProvider).toHaveBeenCalledWith('anthropic');
    expect(result).toEqual({ source: 'auth.json (anthropic)' });
  });

  it('reads active_provider from auth file when no provider specified', async () => {
    mockedReadAuthFile.mockResolvedValue({ active_provider: 'copilot' });

    const mockProvider = {
      name: 'copilot' as const,
      callAI: vi.fn(),
      resolveAuth: vi.fn().mockResolvedValue({ source: 'env:GITHUB_TOKEN' }),
      login: vi.fn(),
      listModels: vi.fn(),
      logout: vi.fn(),
    };
    mockedGetProvider.mockReturnValue(mockProvider);

    const result = await resolveActiveAuth();

    expect(mockedReadAuthFile).toHaveBeenCalled();
    expect(mockedGetProvider).toHaveBeenCalledWith('copilot');
    expect(result).toEqual({ source: 'env:GITHUB_TOKEN' });
  });

  it('returns null when provider has no credentials', async () => {
    const mockProvider = {
      name: 'openai' as const,
      callAI: vi.fn(),
      resolveAuth: vi.fn().mockResolvedValue(null),
      login: vi.fn(),
      listModels: vi.fn(),
      logout: vi.fn(),
    };
    mockedGetProvider.mockReturnValue(mockProvider);

    const result = await resolveActiveAuth('openai');
    expect(result).toBeNull();
  });
});
