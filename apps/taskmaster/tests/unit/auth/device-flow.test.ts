import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  mockDeviceCodeResponse,
  mockTokenDeniedResponse,
  mockTokenExpiredResponse,
  mockTokenPendingResponse,
  mockTokenResponse,
  mockTokenSlowDownResponse,
  mockUserResponse,
} from '../../fixtures/copilot-responses.js';

// Mock getHomePath to use temp directory
let tempDir: string;

vi.mock('../../../src/utils/home.js', () => ({
  getHomePath: (filename: string) => join(tempDir, filename),
  getTaskmasterHome: () => tempDir,
}));

const { requestDeviceCode, pollForToken, login } = await import('../../../src/auth/device-flow.js');

describe('device-flow', () => {
  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'device-flow-test-'));
    delete process.env.GITHUB_COPILOT_CLIENT_ID;
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(async () => {
    vi.useRealTimers();
    await rm(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  describe('requestDeviceCode', () => {
    it('sends correct POST body with client_id and scope', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(
          new Response(JSON.stringify(mockDeviceCodeResponse), { status: 200 }),
        );

      const result = await requestDeviceCode();

      expect(result.device_code).toBe(mockDeviceCodeResponse.device_code);
      expect(result.user_code).toBe(mockDeviceCodeResponse.user_code);
      expect(result.verification_uri).toBe('https://github.com/login/device');

      const [url, opts] = fetchSpy.mock.calls[0];
      expect(url).toBe('https://github.com/login/device/code');
      const body = JSON.parse((opts as RequestInit).body as string);
      expect(body.client_id).toBe('Iv1.b507a08c87ecfe98');
      expect(body.scope).toBe('read:user');
    });

    it('throws on API error', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response('Bad Request', { status: 400 }),
      );

      await expect(requestDeviceCode()).rejects.toThrow('Failed to request device code (400)');
    });
  });

  describe('pollForToken', () => {
    it('returns token on immediate success', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify(mockTokenResponse), { status: 200 }),
      );

      const token = await pollForToken('dc_test', 0.01, 60);
      expect(token).toBe(mockTokenResponse.access_token);
    });

    it('handles authorization_pending and continues polling', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(
          new Response(JSON.stringify(mockTokenPendingResponse), { status: 200 }),
        )
        .mockResolvedValueOnce(new Response(JSON.stringify(mockTokenResponse), { status: 200 }));

      const token = await pollForToken('dc_test', 0.01, 60);
      expect(token).toBe(mockTokenResponse.access_token);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('handles slow_down by increasing interval', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(
          new Response(JSON.stringify(mockTokenSlowDownResponse), { status: 200 }),
        )
        .mockResolvedValueOnce(new Response(JSON.stringify(mockTokenResponse), { status: 200 }));

      const token = await pollForToken('dc_test', 0.01, 60);
      expect(token).toBe(mockTokenResponse.access_token);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    }, 15000);

    it('throws on expired_token', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify(mockTokenExpiredResponse), { status: 200 }),
      );

      await expect(pollForToken('dc_test', 0.01, 60)).rejects.toThrow('Device code expired');
    });

    it('throws on access_denied', async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(JSON.stringify(mockTokenDeniedResponse), { status: 200 }),
      );

      await expect(pollForToken('dc_test', 0.01, 60)).rejects.toThrow('Authorization denied');
    });
  });

  describe('login', () => {
    it('orchestrates full device flow', async () => {
      // Suppress console output during login
      vi.spyOn(console, 'log').mockImplementation(() => {});

      vi.spyOn(globalThis, 'fetch')
        // requestDeviceCode
        .mockResolvedValueOnce(
          new Response(JSON.stringify(mockDeviceCodeResponse), { status: 200 }),
        )
        // pollForToken (immediate success)
        .mockResolvedValueOnce(new Response(JSON.stringify(mockTokenResponse), { status: 200 }))
        // fetchUsername
        .mockResolvedValueOnce(new Response(JSON.stringify(mockUserResponse), { status: 200 }));

      const result = await login();
      expect(result.username).toBe('testuser');

      // Verify credentials were stored
      const { readAuthCredentials } = await import('../../../src/auth/token-manager.js');
      const creds = await readAuthCredentials();
      expect(creds).not.toBeNull();
      expect(creds!.github_token).toBe(mockTokenResponse.access_token);
      expect(creds!.username).toBe('testuser');
    }, 15000);
  });
});
