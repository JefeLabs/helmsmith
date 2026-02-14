import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  mockCopilotTokenResponse,
  mockChatCompletionResponse,
} from '../../fixtures/copilot-responses.js';

// Mock getHomePath to use temp directory
let tempDir: string;

vi.mock('../../../src/utils/home.js', () => ({
  getHomePath: (filename: string) => join(tempDir, filename),
  getTaskmasterHome: () => tempDir,
}));

// Import after mocking
const {
  readAuthCredentials,
  writeAuthCredentials,
  deleteAuthCredentials,
  resolveGitHubToken,
  getCopilotToken,
  callCopilot,
} = await import('../../../src/auth/token-manager.js');

describe('token-manager', () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'auth-test-'));
    // Clear env vars
    delete process.env.COPILOT_GITHUB_TOKEN;
    delete process.env.GITHUB_TOKEN;
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  describe('readAuthCredentials', () => {
    it('returns null when auth.json does not exist', async () => {
      const result = await readAuthCredentials();
      expect(result).toBeNull();
    });

    it('reads valid auth.json', async () => {
      const creds = { github_token: 'gho_test123', username: 'testuser' };
      const { writeFile } = await import('node:fs/promises');
      await writeFile(join(tempDir, 'auth.json'), JSON.stringify(creds));

      const result = await readAuthCredentials();
      expect(result).not.toBeNull();
      expect(result!.github_token).toBe('gho_test123');
      expect(result!.username).toBe('testuser');
    });

    it('returns null for invalid JSON', async () => {
      const { writeFile } = await import('node:fs/promises');
      await writeFile(join(tempDir, 'auth.json'), 'not json');

      const result = await readAuthCredentials();
      expect(result).toBeNull();
    });
  });

  describe('writeAuthCredentials', () => {
    it('writes credentials to auth.json', async () => {
      await writeAuthCredentials({ github_token: 'gho_write_test', username: 'writer' });

      const raw = await readFile(join(tempDir, 'auth.json'), 'utf-8');
      const parsed = JSON.parse(raw);
      expect(parsed.github_token).toBe('gho_write_test');
      expect(parsed.username).toBe('writer');
    });
  });

  describe('deleteAuthCredentials', () => {
    it('removes auth.json', async () => {
      await writeAuthCredentials({ github_token: 'gho_delete_test' });
      await deleteAuthCredentials();

      const result = await readAuthCredentials();
      expect(result).toBeNull();
    });

    it('does not throw when auth.json does not exist', async () => {
      await expect(deleteAuthCredentials()).resolves.not.toThrow();
    });
  });

  describe('resolveGitHubToken', () => {
    it('returns COPILOT_GITHUB_TOKEN with highest priority', async () => {
      process.env.COPILOT_GITHUB_TOKEN = 'copilot_env_token';
      process.env.GITHUB_TOKEN = 'github_env_token';
      await writeAuthCredentials({ github_token: 'file_token' });

      const result = await resolveGitHubToken();
      expect(result).not.toBeNull();
      expect(result!.token).toBe('copilot_env_token');
      expect(result!.source).toBe('env:COPILOT_GITHUB_TOKEN');
    });

    it('returns GITHUB_TOKEN with second priority', async () => {
      process.env.GITHUB_TOKEN = 'github_env_token';
      await writeAuthCredentials({ github_token: 'file_token' });

      const result = await resolveGitHubToken();
      expect(result).not.toBeNull();
      expect(result!.token).toBe('github_env_token');
      expect(result!.source).toBe('env:GITHUB_TOKEN');
    });

    it('returns auth.json token with lowest priority', async () => {
      await writeAuthCredentials({ github_token: 'file_token' });

      const result = await resolveGitHubToken();
      expect(result).not.toBeNull();
      expect(result!.token).toBe('file_token');
      expect(result!.source).toBe('auth.json');
    });

    it('returns null when no token is available', async () => {
      const result = await resolveGitHubToken();
      expect(result).toBeNull();
    });
  });

  describe('getCopilotToken', () => {
    it('fetches a new Copilot token from the API', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify(mockCopilotTokenResponse), { status: 200 }),
      );

      const token = await getCopilotToken('gho_test_github_token');
      expect(token).toBe(mockCopilotTokenResponse.token);
      expect(fetchSpy).toHaveBeenCalledOnce();
    });

    it('returns cached token when still valid', async () => {
      // Write a cached token with 30 minutes remaining
      await writeAuthCredentials({
        github_token: 'gho_test',
        copilot_token: 'cached_token',
        copilot_token_expires_at: Math.floor(Date.now() / 1000) + 1800,
      });

      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      const token = await getCopilotToken('gho_test');
      expect(token).toBe('cached_token');
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('refreshes token when less than 5 minutes remaining', async () => {
      // Write a token that expires in 2 minutes
      await writeAuthCredentials({
        github_token: 'gho_test',
        copilot_token: 'expiring_token',
        copilot_token_expires_at: Math.floor(Date.now() / 1000) + 120,
      });

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify(mockCopilotTokenResponse), { status: 200 }),
      );

      const token = await getCopilotToken('gho_test');
      expect(token).toBe(mockCopilotTokenResponse.token);
      expect(fetchSpy).toHaveBeenCalledOnce();
    });

    it('throws on API error', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response('Forbidden', { status: 403 }),
      );

      await expect(getCopilotToken('gho_bad_token')).rejects.toThrow('Failed to get Copilot token (403)');
    });
  });

  describe('callCopilot', () => {
    it('sends correct headers and body', async () => {
      await writeAuthCredentials({ github_token: 'gho_test' });

      const fetchSpy = vi.spyOn(globalThis, 'fetch')
        // First call: getCopilotToken
        .mockResolvedValueOnce(
          new Response(JSON.stringify(mockCopilotTokenResponse), { status: 200 }),
        )
        // Second call: chat completions
        .mockResolvedValueOnce(
          new Response(JSON.stringify(mockChatCompletionResponse), { status: 200 }),
        );

      const result = await callCopilot(
        [{ role: 'user', content: 'test' }],
        'gpt-4o',
      );

      expect(result.choices[0].message.content).toContain('"score"');

      // Verify chat completions call headers
      const chatCall = fetchSpy.mock.calls[1];
      const chatOpts = chatCall[1] as RequestInit;
      const headers = chatOpts.headers as Record<string, string>;
      expect(headers['Authorization']).toContain('Bearer');
      expect(headers['Editor-Version']).toBe('AgentX-Taskmaster/0.1.0');
      expect(headers['Openai-Intent']).toBe('conversation-panel');

      // Verify body
      const body = JSON.parse(chatOpts.body as string);
      expect(body.model).toBe('gpt-4o');
      expect(body.messages).toHaveLength(1);
      expect(body.stream).toBe(false);
    });

    it('retries once on 401', async () => {
      await writeAuthCredentials({ github_token: 'gho_test' });

      const fetchSpy = vi.spyOn(globalThis, 'fetch')
        // getCopilotToken (first attempt)
        .mockResolvedValueOnce(
          new Response(JSON.stringify(mockCopilotTokenResponse), { status: 200 }),
        )
        // Chat completions → 401
        .mockResolvedValueOnce(
          new Response('Unauthorized', { status: 401 }),
        )
        // getCopilotToken (retry after clearing cache)
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ ...mockCopilotTokenResponse, token: 'new_token' }), { status: 200 }),
        )
        // Chat completions → success
        .mockResolvedValueOnce(
          new Response(JSON.stringify(mockChatCompletionResponse), { status: 200 }),
        );

      const result = await callCopilot(
        [{ role: 'user', content: 'test' }],
        'gpt-4o',
      );

      expect(result.choices).toHaveLength(1);
      // 4 fetch calls: token, 401, token refresh, success
      expect(fetchSpy).toHaveBeenCalledTimes(4);
    });

    it('throws when not authenticated', async () => {
      await expect(
        callCopilot([{ role: 'user', content: 'test' }], 'gpt-4o'),
      ).rejects.toThrow('Not authenticated');
    });
  });
});
