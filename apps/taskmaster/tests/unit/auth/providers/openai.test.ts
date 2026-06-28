import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock token-manager
vi.mock('../../../../src/auth/token-manager.js', () => ({
  readAuthFile: vi.fn(),
  writeAuthFile: vi.fn(),
}));

// Mock oauth-pkce
vi.mock('../../../../src/auth/oauth-pkce.js', () => ({
  generateCodeVerifier: vi.fn().mockReturnValue('test-verifier'),
  generateCodeChallenge: vi.fn().mockReturnValue('test-challenge'),
  waitForCallback: vi.fn(),
  openBrowser: vi.fn(),
}));

import { OpenAIProvider } from '../../../../src/auth/providers/openai.js';
import { readAuthFile, writeAuthFile } from '../../../../src/auth/token-manager.js';

const mockedReadAuthFile = vi.mocked(readAuthFile);
const mockedWriteAuthFile = vi.mocked(writeAuthFile);

describe('OpenAIProvider', () => {
  let provider: OpenAIProvider;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new OpenAIProvider();
    delete process.env.OPENAI_API_KEY;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.OPENAI_API_KEY;
  });

  it('has name "openai"', () => {
    expect(provider.name).toBe('openai');
  });

  describe('resolveAuth', () => {
    it('returns source from OPENAI_API_KEY env var', async () => {
      process.env.OPENAI_API_KEY = 'sk-test-key-123';

      const result = await provider.resolveAuth();
      expect(result).toEqual({ source: 'env:OPENAI_API_KEY' });
    });

    it('returns source when access_token exists in auth.json', async () => {
      mockedReadAuthFile.mockResolvedValue({
        active_provider: 'openai',
        openai: { access_token: 'oai_token_123' },
      });

      const result = await provider.resolveAuth();
      expect(result).toEqual({ source: 'auth.json (openai)' });
    });

    it('returns null when no openai credentials', async () => {
      mockedReadAuthFile.mockResolvedValue({
        active_provider: 'copilot',
      });

      const result = await provider.resolveAuth();
      expect(result).toBeNull();
    });

    it('returns null when access_token is empty', async () => {
      mockedReadAuthFile.mockResolvedValue({
        active_provider: 'openai',
        openai: { access_token: '' },
      });

      const result = await provider.resolveAuth();
      expect(result).toBeNull();
    });

    it('prioritizes OPENAI_API_KEY over auth.json', async () => {
      process.env.OPENAI_API_KEY = 'sk-env-key';
      mockedReadAuthFile.mockResolvedValue({
        active_provider: 'openai',
        openai: { access_token: 'file_token' },
      });

      const result = await provider.resolveAuth();
      expect(result).toEqual({ source: 'env:OPENAI_API_KEY' });
    });
  });

  describe('callAI', () => {
    it('sends OpenAI-compatible request and returns response', async () => {
      mockedReadAuthFile.mockResolvedValue({
        active_provider: 'openai',
        openai: { access_token: 'oai_valid_token' },
      });

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: '{"score": 5}' } }],
          }),
          { status: 200 },
        ),
      );

      const messages = [
        { role: 'system' as const, content: 'You are a scorer.' },
        { role: 'user' as const, content: 'Score this task.' },
      ];

      const result = await provider.callAI(messages, 'gpt-4o');

      expect(result.choices[0].message.content).toBe('{"score": 5}');

      // Verify the request
      const [url, opts] = fetchSpy.mock.calls[0];
      expect(url).toBe('https://api.openai.com/v1/chat/completions');
      const body = JSON.parse(opts!.body as string);
      expect(body.model).toBe('gpt-4o');
      // OpenAI uses same format — system messages stay in messages array
      expect(body.messages).toHaveLength(2);
      expect(body.stream).toBe(false);

      const headers = opts!.headers as Record<string, string>;
      expect(headers.Authorization).toBe('Bearer oai_valid_token');

      fetchSpy.mockRestore();
    });

    it('uses OPENAI_API_KEY env var as Bearer token', async () => {
      process.env.OPENAI_API_KEY = 'sk-env-api-key';
      mockedReadAuthFile.mockResolvedValue({
        active_provider: 'openai',
        openai: { access_token: 'stored_token' },
      });

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: 'ok' } }],
          }),
          { status: 200 },
        ),
      );

      await provider.callAI([{ role: 'user', content: 'test' }], 'gpt-4o');

      const headers = fetchSpy.mock.calls[0][1]!.headers as Record<string, string>;
      // Env var takes priority over stored token
      expect(headers.Authorization).toBe('Bearer sk-env-api-key');

      fetchSpy.mockRestore();
    });

    it('throws when not authenticated', async () => {
      mockedReadAuthFile.mockResolvedValue({ active_provider: 'openai' });

      await expect(provider.callAI([{ role: 'user', content: 'test' }], 'gpt-4o')).rejects.toThrow(
        'Not authenticated',
      );
    });

    it('throws on API error', async () => {
      mockedReadAuthFile.mockResolvedValue({
        active_provider: 'openai',
        openai: { access_token: 'oai_token' },
      });

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response('Bad Request', { status: 400 }),
      );

      await expect(provider.callAI([{ role: 'user', content: 'test' }], 'gpt-4o')).rejects.toThrow(
        'OpenAI API error (400)',
      );

      vi.restoreAllMocks();
    });

    it('retries on 429 rate limit', async () => {
      mockedReadAuthFile.mockResolvedValue({
        active_provider: 'openai',
        openai: { access_token: 'oai_token' },
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
              choices: [{ message: { content: 'ok after retry' } }],
            }),
            { status: 200 },
          ),
        );

      const result = await provider.callAI([{ role: 'user', content: 'test' }], 'gpt-4o');

      expect(result.choices[0].message.content).toBe('ok after retry');
      expect(fetchSpy).toHaveBeenCalledTimes(2);

      fetchSpy.mockRestore();
    });

    it('auto-refreshes expired token before calling API', async () => {
      const nowSec = Math.floor(Date.now() / 1000);

      // Token expired 10 minutes ago
      mockedReadAuthFile
        .mockResolvedValueOnce({
          active_provider: 'openai',
          openai: {
            access_token: 'expired_token',
            refresh_token: 'refresh_123',
            token_expires_at: nowSec - 600,
          },
        })
        // Second read after refresh writes back
        .mockResolvedValueOnce({
          active_provider: 'openai',
          openai: {
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
              choices: [{ message: { content: 'ok' } }],
            }),
            { status: 200 },
          ),
        );

      const result = await provider.callAI([{ role: 'user', content: 'test' }], 'gpt-4o');

      expect(result.choices[0].message.content).toBe('ok');

      // Verify refresh token was exchanged
      const refreshCall = fetchSpy.mock.calls[0];
      expect(refreshCall[0]).toBe('https://auth.openai.com/oauth/token');
      const refreshBody = refreshCall[1]!.body as string;
      expect(refreshBody).toContain('grant_type=refresh_token');
      expect(refreshBody).toContain('refresh_token=refresh_123');

      // Verify API call used the refreshed token
      const apiCall = fetchSpy.mock.calls[1];
      const headers = apiCall[1]!.headers as Record<string, string>;
      expect(headers.Authorization).toBe('Bearer refreshed_token');

      // Verify auth file was updated
      expect(mockedWriteAuthFile).toHaveBeenCalled();

      fetchSpy.mockRestore();
    });
  });

  describe('listModels', () => {
    it('returns null when not authenticated', async () => {
      mockedReadAuthFile.mockResolvedValue({ active_provider: 'openai' });

      const result = await provider.listModels();
      expect(result).toBeNull();
    });

    it('filters to chat models from API response', async () => {
      mockedReadAuthFile.mockResolvedValue({
        active_provider: 'openai',
        openai: { access_token: 'oai_token' },
      });

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              { id: 'gpt-4o' },
              { id: 'gpt-4.1' },
              { id: 'dall-e-3' },
              { id: 'whisper-1' },
              { id: 'o3-mini' },
              { id: 'codex-mini-latest' },
            ],
          }),
          { status: 200 },
        ),
      );

      const result = await provider.listModels();
      expect(result).not.toBeNull();
      const ids = result!.map((m) => m.id);
      expect(ids).toContain('gpt-4o');
      expect(ids).toContain('gpt-4.1');
      expect(ids).toContain('o3-mini');
      expect(ids).toContain('codex-mini-latest');
      expect(ids).not.toContain('dall-e-3');
      expect(ids).not.toContain('whisper-1');

      vi.restoreAllMocks();
    });

    it('returns known models on API failure', async () => {
      mockedReadAuthFile.mockResolvedValue({
        active_provider: 'openai',
        openai: { access_token: 'oai_token' },
      });

      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response('Server Error', { status: 500 }),
      );

      const result = await provider.listModels();
      expect(result).not.toBeNull();
      expect(result!.length).toBeGreaterThan(0);
      expect(result!.some((m) => m.id.includes('gpt'))).toBe(true);

      vi.restoreAllMocks();
    });

    it('returns known models on network error', async () => {
      mockedReadAuthFile.mockResolvedValue({
        active_provider: 'openai',
        openai: { access_token: 'oai_token' },
      });

      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Network error'));

      const result = await provider.listModels();
      expect(result).not.toBeNull();
      expect(result!.length).toBeGreaterThan(0);

      vi.restoreAllMocks();
    });
  });

  describe('logout', () => {
    it('removes openai credentials from auth file', async () => {
      mockedReadAuthFile.mockResolvedValue({
        active_provider: 'openai',
        openai: { access_token: 'oai_token' },
        copilot: { github_token: 'gho_token' },
      });

      // No revocation fetch (no refresh_token)
      await provider.logout();

      expect(mockedWriteAuthFile).toHaveBeenCalled();
      const written = mockedWriteAuthFile.mock.calls[0][0];
      expect(written.openai).toBeUndefined();
      expect(written.copilot).toEqual({ github_token: 'gho_token' });
    });

    it('attempts token revocation when refresh_token exists', async () => {
      mockedReadAuthFile.mockResolvedValue({
        active_provider: 'openai',
        openai: {
          access_token: 'oai_token',
          refresh_token: 'refresh_to_revoke',
        },
      });

      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(new Response('', { status: 200 }));

      await provider.logout();

      // Verify revocation request
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, opts] = fetchSpy.mock.calls[0];
      expect(url).toBe('https://auth.openai.com/oauth/revoke');
      expect(opts!.method).toBe('POST');
      const body = opts!.body as string;
      expect(body).toContain('token=refresh_to_revoke');

      // Credentials still removed locally even after revocation
      const written = mockedWriteAuthFile.mock.calls[0][0];
      expect(written.openai).toBeUndefined();

      fetchSpy.mockRestore();
    });

    it('removes credentials even when revocation fails', async () => {
      mockedReadAuthFile.mockResolvedValue({
        active_provider: 'openai',
        openai: {
          access_token: 'oai_token',
          refresh_token: 'refresh_to_revoke',
        },
      });

      vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('Network error'));

      await provider.logout();

      // Credentials removed even though revocation failed
      expect(mockedWriteAuthFile).toHaveBeenCalled();
      const written = mockedWriteAuthFile.mock.calls[0][0];
      expect(written.openai).toBeUndefined();

      vi.restoreAllMocks();
    });
  });
});
