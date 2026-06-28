import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock token-manager
vi.mock('../../../../src/auth/token-manager.js', () => ({
  readAuthFile: vi.fn(),
  writeAuthFile: vi.fn(),
}));

// Mock device-flow (login uses this)
vi.mock('../../../../src/auth/device-flow.js', () => ({
  login: vi.fn(),
}));

import { CopilotProvider } from '../../../../src/auth/providers/copilot.js';
import { readAuthFile, writeAuthFile } from '../../../../src/auth/token-manager.js';

const mockedReadAuthFile = vi.mocked(readAuthFile);
const mockedWriteAuthFile = vi.mocked(writeAuthFile);

describe('CopilotProvider', () => {
  let provider: CopilotProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new CopilotProvider();
    // Clear env vars
    delete process.env.COPILOT_GITHUB_TOKEN;
    delete process.env.GITHUB_TOKEN;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.COPILOT_GITHUB_TOKEN;
    delete process.env.GITHUB_TOKEN;
  });

  it('has name "copilot"', () => {
    expect(provider.name).toBe('copilot');
  });

  describe('resolveAuth', () => {
    it('returns source from env COPILOT_GITHUB_TOKEN', async () => {
      process.env.COPILOT_GITHUB_TOKEN = 'env_copilot_token';

      const result = await provider.resolveAuth();
      expect(result).toEqual({ source: 'env:COPILOT_GITHUB_TOKEN' });
    });

    it('returns source from env GITHUB_TOKEN', async () => {
      process.env.GITHUB_TOKEN = 'env_github_token';

      const result = await provider.resolveAuth();
      expect(result).toEqual({ source: 'env:GITHUB_TOKEN' });
    });

    it('returns source from auth.json copilot credentials', async () => {
      mockedReadAuthFile.mockResolvedValue({
        active_provider: 'copilot',
        copilot: { github_token: 'gho_file_token' },
      });

      const result = await provider.resolveAuth();
      expect(result).toEqual({ source: 'auth.json' });
    });

    it('returns null when no credentials exist', async () => {
      mockedReadAuthFile.mockResolvedValue({ active_provider: 'copilot' });

      const result = await provider.resolveAuth();
      expect(result).toBeNull();
    });

    it('prioritizes COPILOT_GITHUB_TOKEN over GITHUB_TOKEN', async () => {
      process.env.COPILOT_GITHUB_TOKEN = 'copilot_env';
      process.env.GITHUB_TOKEN = 'github_env';

      const result = await provider.resolveAuth();
      expect(result).toEqual({ source: 'env:COPILOT_GITHUB_TOKEN' });
    });
  });

  describe('callAI', () => {
    it('throws when not authenticated', async () => {
      mockedReadAuthFile.mockResolvedValue({ active_provider: 'copilot' });

      await expect(provider.callAI([{ role: 'user', content: 'test' }], 'gpt-4o')).rejects.toThrow(
        'Not authenticated',
      );
    });

    it('makes request to Copilot chat completions API', async () => {
      process.env.GITHUB_TOKEN = 'gho_test_token';

      // getCopilotToken: return cached token
      mockedReadAuthFile.mockResolvedValue({
        active_provider: 'copilot',
        copilot: {
          github_token: 'gho_test_token',
          copilot_token: 'cached_copilot_token',
          copilot_token_expires_at: Math.floor(Date.now() / 1000) + 1800,
        },
      });

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: '{"score": 5}' } }],
          }),
          { status: 200 },
        ),
      );

      const result = await provider.callAI([{ role: 'user', content: 'score this' }], 'gpt-4o');

      expect(result.choices[0].message.content).toBe('{"score": 5}');

      // Verify correct endpoint and headers
      const [url, opts] = fetchSpy.mock.calls[0];
      expect(url).toBe('https://api.githubcopilot.com/chat/completions');
      const headers = opts!.headers as Record<string, string>;
      expect(headers.Authorization).toBe('Bearer cached_copilot_token');
      expect(headers['Copilot-Integration-Id']).toBe('vscode-chat');

      fetchSpy.mockRestore();
    });

    it('throws on non-recoverable API error', async () => {
      process.env.GITHUB_TOKEN = 'gho_test_token';

      mockedReadAuthFile.mockResolvedValue({
        active_provider: 'copilot',
        copilot: {
          github_token: 'gho_test_token',
          copilot_token: 'cached_token',
          copilot_token_expires_at: Math.floor(Date.now() / 1000) + 1800,
        },
      });

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response('Service Unavailable', { status: 503 }),
      );

      await expect(provider.callAI([{ role: 'user', content: 'test' }], 'gpt-4o')).rejects.toThrow(
        'Copilot API error (503)',
      );

      vi.restoreAllMocks();
    });
  });

  describe('listModels', () => {
    it('returns null when not authenticated', async () => {
      mockedReadAuthFile.mockResolvedValue({ active_provider: 'copilot' });

      const result = await provider.listModels();
      expect(result).toBeNull();
    });

    it('returns model list from API', async () => {
      process.env.GITHUB_TOKEN = 'gho_test';

      mockedReadAuthFile.mockResolvedValue({
        active_provider: 'copilot',
        copilot: {
          github_token: 'gho_test',
          copilot_token: 'cached_token',
          copilot_token_expires_at: Math.floor(Date.now() / 1000) + 1800,
        },
      });

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              { id: 'gpt-4o', name: 'GPT-4o', version: '2024-01-01' },
              { id: 'gpt-4.1', name: 'GPT-4.1', version: '2024-06-01' },
            ],
          }),
          { status: 200 },
        ),
      );

      const result = await provider.listModels();
      expect(result).not.toBeNull();
      expect(result).toHaveLength(2);
      expect(result![0].id).toBe('gpt-4o');

      vi.restoreAllMocks();
    });

    it('returns null on network error', async () => {
      process.env.GITHUB_TOKEN = 'gho_test';

      mockedReadAuthFile.mockResolvedValue({
        active_provider: 'copilot',
        copilot: {
          github_token: 'gho_test',
          copilot_token: 'cached_token',
          copilot_token_expires_at: Math.floor(Date.now() / 1000) + 1800,
        },
      });

      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Network error'));

      const result = await provider.listModels();
      expect(result).toBeNull();

      vi.restoreAllMocks();
    });
  });

  describe('logout', () => {
    it('removes copilot credentials from auth file', async () => {
      mockedReadAuthFile.mockResolvedValue({
        active_provider: 'copilot',
        copilot: { github_token: 'gho_token', username: 'testuser' },
        anthropic: { access_token: 'ant_token' },
      });

      await provider.logout();

      expect(mockedWriteAuthFile).toHaveBeenCalled();
      const written = mockedWriteAuthFile.mock.calls[0][0];
      expect(written.copilot).toBeUndefined();
      expect(written.anthropic).toEqual({ access_token: 'ant_token' });
      // active_provider should remain copilot (reset to default)
      expect(written.active_provider).toBe('copilot');
    });
  });
});
