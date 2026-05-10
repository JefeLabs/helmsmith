import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock token-manager
vi.mock('../../../../src/auth/token-manager.js', () => ({
  readAuthFile: vi.fn(),
  writeAuthFile: vi.fn(),
}));

// Mock oauth-pkce (login uses these)
vi.mock('../../../../src/auth/oauth-pkce.js', () => ({
  generateCodeChallenge: vi.fn().mockReturnValue('test-challenge'),
  openBrowser: vi.fn(),
}));

import { AnthropicProvider } from '../../../../src/auth/providers/anthropic.js';
import { readAuthFile, writeAuthFile } from '../../../../src/auth/token-manager.js';

const mockedReadAuthFile = vi.mocked(readAuthFile);
const mockedWriteAuthFile = vi.mocked(writeAuthFile);

describe('AnthropicProvider', () => {
  let provider: AnthropicProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new AnthropicProvider();
    delete process.env.ANTHROPIC_API_KEY;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.ANTHROPIC_API_KEY;
  });

  it('has name "anthropic"', () => {
    expect(provider.name).toBe('anthropic');
  });

  describe('resolveAuth', () => {
    it('returns source from ANTHROPIC_API_KEY env var', async () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';

      const result = await provider.resolveAuth();
      expect(result).toEqual({ source: 'env:ANTHROPIC_API_KEY' });
    });

    it('returns source when access_token exists in auth.json', async () => {
      mockedReadAuthFile.mockResolvedValue({
        active_provider: 'anthropic',
        anthropic: { access_token: 'ant_token_123' },
      });

      const result = await provider.resolveAuth();
      expect(result).toEqual({ source: 'auth.json (anthropic)' });
    });

    it('returns null when no anthropic credentials', async () => {
      mockedReadAuthFile.mockResolvedValue({
        active_provider: 'copilot',
      });

      const result = await provider.resolveAuth();
      expect(result).toBeNull();
    });

    it('returns null when access_token is empty', async () => {
      mockedReadAuthFile.mockResolvedValue({
        active_provider: 'anthropic',
        anthropic: { access_token: '' },
      });

      const result = await provider.resolveAuth();
      expect(result).toBeNull();
    });

    it('prioritizes ANTHROPIC_API_KEY over auth.json', async () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-env-key';
      mockedReadAuthFile.mockResolvedValue({
        active_provider: 'anthropic',
        anthropic: { access_token: 'file_token' },
      });

      const result = await provider.resolveAuth();
      expect(result).toEqual({ source: 'env:ANTHROPIC_API_KEY' });
    });
  });

  describe('callAI', () => {
    it('normalizes Anthropic response to ChatCompletionResponse shape', async () => {
      mockedReadAuthFile.mockResolvedValue({
        active_provider: 'anthropic',
        anthropic: { access_token: 'ant_valid_token' },
      });

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            content: [{ type: 'text', text: '{"score": 7}' }],
          }),
          { status: 200 },
        ),
      );

      const messages = [
        { role: 'system' as const, content: 'You are a scorer.' },
        { role: 'user' as const, content: 'Score this task.' },
      ];

      const result = await provider.callAI(messages, 'claude-sonnet-4-20250514');

      // Verify normalized response shape
      expect(result.choices).toHaveLength(1);
      expect(result.choices[0].message.content).toBe('{"score": 7}');

      // Verify request was correct
      const [url, opts] = fetchSpy.mock.calls[0];
      expect(url).toBe('https://api.anthropic.com/v1/messages');
      const body = JSON.parse(opts!.body as string);
      // System messages should be extracted to the "system" field
      expect(body.system).toBe('You are a scorer.');
      // Only non-system messages in messages array
      expect(body.messages).toHaveLength(1);
      expect(body.messages[0].role).toBe('user');
      expect(body.model).toBe('claude-sonnet-4-20250514');

      fetchSpy.mockRestore();
    });

    it('uses x-api-key header for standard API keys', async () => {
      mockedReadAuthFile.mockResolvedValue({
        active_provider: 'anthropic',
        anthropic: { access_token: 'sk-ant-api-key-123' },
      });

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ content: [{ type: 'text', text: 'ok' }] }), {
          status: 200,
        }),
      );

      await provider.callAI([{ role: 'user', content: 'test' }], 'claude-sonnet-4');

      const headers = fetchSpy.mock.calls[0][1]!.headers as Record<string, string>;
      expect(headers['anthropic-version']).toBe('2023-06-01');
      expect(headers['x-api-key']).toBe('sk-ant-api-key-123');
      expect(headers.Authorization).toBeUndefined();

      fetchSpy.mockRestore();
    });

    it('uses ANTHROPIC_API_KEY env var as x-api-key header', async () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-env-api-key';
      mockedReadAuthFile.mockResolvedValue({
        active_provider: 'anthropic',
        anthropic: { access_token: 'stored_token' },
      });

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ content: [{ type: 'text', text: 'ok' }] }), {
          status: 200,
        }),
      );

      await provider.callAI([{ role: 'user', content: 'test' }], 'claude-sonnet-4');

      const headers = fetchSpy.mock.calls[0][1]!.headers as Record<string, string>;
      // Env var takes priority over stored token
      expect(headers['x-api-key']).toBe('sk-ant-env-api-key');

      fetchSpy.mockRestore();
    });

    it('uses Authorization Bearer for OAuth tokens', async () => {
      mockedReadAuthFile.mockResolvedValue({
        active_provider: 'anthropic',
        anthropic: { access_token: 'sk-ant-oat01-some-oauth-token' },
      });

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ content: [{ type: 'text', text: 'ok' }] }), {
          status: 200,
        }),
      );

      await provider.callAI([{ role: 'user', content: 'test' }], 'claude-sonnet-4');

      const headers = fetchSpy.mock.calls[0][1]!.headers as Record<string, string>;
      expect(headers.Authorization).toBe('Bearer sk-ant-oat01-some-oauth-token');
      expect(headers['x-api-key']).toBeUndefined();

      fetchSpy.mockRestore();
    });

    it('appends ?beta=true for OAuth tokens', async () => {
      mockedReadAuthFile.mockResolvedValue({
        active_provider: 'anthropic',
        anthropic: { access_token: 'sk-ant-oat01-oauth-token' },
      });

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ content: [{ type: 'text', text: 'ok' }] }), {
          status: 200,
        }),
      );

      await provider.callAI([{ role: 'user', content: 'test' }], 'claude-sonnet-4');

      const url = fetchSpy.mock.calls[0][0] as string;
      expect(url).toBe('https://api.anthropic.com/v1/messages?beta=true');

      fetchSpy.mockRestore();
    });

    it('does not append ?beta=true for standard API keys', async () => {
      mockedReadAuthFile.mockResolvedValue({
        active_provider: 'anthropic',
        anthropic: { access_token: 'sk-ant-api-key-123' },
      });

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ content: [{ type: 'text', text: 'ok' }] }), {
          status: 200,
        }),
      );

      await provider.callAI([{ role: 'user', content: 'test' }], 'claude-sonnet-4');

      const url = fetchSpy.mock.calls[0][0] as string;
      expect(url).toBe('https://api.anthropic.com/v1/messages');

      fetchSpy.mockRestore();
    });

    it('throws when not authenticated', async () => {
      mockedReadAuthFile.mockResolvedValue({ active_provider: 'anthropic' });

      await expect(
        provider.callAI([{ role: 'user', content: 'test' }], 'claude-sonnet-4'),
      ).rejects.toThrow('Not authenticated');
    });

    it('throws on API error', async () => {
      mockedReadAuthFile.mockResolvedValue({
        active_provider: 'anthropic',
        anthropic: { access_token: 'ant_token' },
      });

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response('Internal Server Error', { status: 500 }),
      );

      await expect(
        provider.callAI([{ role: 'user', content: 'test' }], 'claude-sonnet-4'),
      ).rejects.toThrow('Anthropic API error (500)');

      vi.restoreAllMocks();
    });

    it('retries on 429 rate limit', async () => {
      mockedReadAuthFile.mockResolvedValue({
        active_provider: 'anthropic',
        anthropic: { access_token: 'ant_token' },
      });

      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(
          new Response('Rate limited', {
            status: 429,
            headers: { 'retry-after': '0' },
          }),
        )
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              content: [{ type: 'text', text: 'ok after retry' }],
            }),
            { status: 200 },
          ),
        );

      const result = await provider.callAI([{ role: 'user', content: 'test' }], 'claude-sonnet-4');

      expect(result.choices[0].message.content).toBe('ok after retry');
      expect(fetchSpy).toHaveBeenCalledTimes(2);

      fetchSpy.mockRestore();
    });

    it('handles response with no text content', async () => {
      mockedReadAuthFile.mockResolvedValue({
        active_provider: 'anthropic',
        anthropic: { access_token: 'ant_token' },
      });

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify({ content: [] }), { status: 200 }),
      );

      const result = await provider.callAI([{ role: 'user', content: 'test' }], 'claude-sonnet-4');

      expect(result.choices[0].message.content).toBe('');

      vi.restoreAllMocks();
    });

    it('auto-refreshes expired token before calling API', async () => {
      const nowSec = Math.floor(Date.now() / 1000);

      // Token expired 10 minutes ago
      mockedReadAuthFile
        .mockResolvedValueOnce({
          active_provider: 'anthropic',
          anthropic: {
            access_token: 'expired_token',
            refresh_token: 'refresh_123',
            token_expires_at: nowSec - 600,
          },
        })
        // Second read after refresh writes back
        .mockResolvedValueOnce({
          active_provider: 'anthropic',
          anthropic: {
            access_token: 'refreshed_token',
            refresh_token: 'new_refresh',
            token_expires_at: nowSec + 3600,
          },
        });

      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        // First fetch: refresh token exchange
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              access_token: 'refreshed_token',
              refresh_token: 'new_refresh',
              expires_in: 3600,
            }),
            { status: 200 },
          ),
        )
        // Second fetch: actual API call
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              content: [{ type: 'text', text: 'ok' }],
            }),
            { status: 200 },
          ),
        );

      const result = await provider.callAI([{ role: 'user', content: 'test' }], 'claude-sonnet-4');

      expect(result.choices[0].message.content).toBe('ok');

      // Verify refresh token was exchanged
      const refreshCall = fetchSpy.mock.calls[0];
      expect(refreshCall[0]).toBe('https://console.anthropic.com/v1/oauth/token');
      const refreshBody = JSON.parse(refreshCall[1]!.body as string);
      expect(refreshBody.grant_type).toBe('refresh_token');
      expect(refreshBody.refresh_token).toBe('refresh_123');

      // Verify auth file was updated
      expect(mockedWriteAuthFile).toHaveBeenCalled();

      fetchSpy.mockRestore();
    });
  });

  describe('listModels', () => {
    it('returns null when not authenticated', async () => {
      mockedReadAuthFile.mockResolvedValue({ active_provider: 'anthropic' });

      const result = await provider.listModels();
      expect(result).toBeNull();
    });

    it('returns models from API response', async () => {
      mockedReadAuthFile.mockResolvedValue({
        active_provider: 'anthropic',
        anthropic: { access_token: 'ant_token' },
      });

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              { id: 'claude-sonnet-4-20250514', display_name: 'Claude Sonnet 4' },
              { id: 'claude-opus-4-20250514', display_name: 'Claude Opus 4' },
            ],
          }),
          { status: 200 },
        ),
      );

      const result = await provider.listModels();
      expect(result).not.toBeNull();
      expect(result).toHaveLength(2);
      expect(result![0].id).toBe('claude-sonnet-4-20250514');
      expect(result![0].name).toBe('Claude Sonnet 4');

      vi.restoreAllMocks();
    });

    it('returns known models on API failure', async () => {
      mockedReadAuthFile.mockResolvedValue({
        active_provider: 'anthropic',
        anthropic: { access_token: 'ant_token' },
      });

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response('Forbidden', { status: 403 }),
      );

      const result = await provider.listModels();
      expect(result).not.toBeNull();
      expect(result!.length).toBeGreaterThan(0);
      expect(result!.some((m) => m.id.includes('claude'))).toBe(true);

      vi.restoreAllMocks();
    });

    it('returns known models on network error', async () => {
      mockedReadAuthFile.mockResolvedValue({
        active_provider: 'anthropic',
        anthropic: { access_token: 'ant_token' },
      });

      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Network error'));

      const result = await provider.listModels();
      expect(result).not.toBeNull();
      expect(result!.length).toBeGreaterThan(0);

      vi.restoreAllMocks();
    });
  });

  describe('logout', () => {
    it('removes anthropic credentials from auth file', async () => {
      mockedReadAuthFile.mockResolvedValue({
        active_provider: 'anthropic',
        anthropic: { access_token: 'ant_token' },
        copilot: { github_token: 'gho_token' },
      });

      await provider.logout();

      expect(mockedWriteAuthFile).toHaveBeenCalledWith(
        expect.objectContaining({
          copilot: { github_token: 'gho_token' },
        }),
      );
      const written = mockedWriteAuthFile.mock.calls[0][0];
      expect(written.anthropic).toBeUndefined();
    });
  });
});
