import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JiraRestAdapter } from './jira-rest.js';

describe('JiraRestAdapter', () => {
  const config = {
    type: 'jira-rest' as const,
    baseUrl: 'https://yourorg.atlassian.net',
    emailEnv: 'JIRA_EMAIL',
    tokenEnv: 'JIRA_API_TOKEN',
  };

  let originalFetch: typeof fetch;

  beforeEach(() => {
    process.env.JIRA_EMAIL = 'user@example.com';
    process.env.JIRA_API_TOKEN = 'tok';
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    delete process.env.JIRA_EMAIL;
    delete process.env.JIRA_API_TOKEN;
    globalThis.fetch = originalFetch;
  });

  it('isAvailable is true when both env vars are set', async () => {
    expect(await new JiraRestAdapter(config).isAvailable()).toBe(true);
  });

  it('isAvailable is false when env vars are missing', async () => {
    delete process.env.JIRA_EMAIL;
    expect(await new JiraRestAdapter(config).isAvailable()).toBe(false);
  });

  it('returns exists:true on 200 with parsed fields', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({
        key: 'PROJ-1',
        fields: {
          summary: 'Add SSO support',
          status: { name: 'In Progress' },
        },
      }),
    } as Response);

    const result = await new JiraRestAdapter(config).validate('PROJ-1');
    expect(result?.exists).toBe(true);
    expect(result?.title).toBe('Add SSO support');
    expect(result?.status).toBe('In Progress');
    expect(result?.url).toBe('https://yourorg.atlassian.net/browse/PROJ-1');
  });

  it('returns exists:false on 404', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      status: 404,
      ok: false,
    } as Response);

    const result = await new JiraRestAdapter(config).validate('PROJ-999');
    expect(result?.exists).toBe(false);
    expect(result?.error).toContain('PROJ-999');
  });

  it('returns null on auth errors (401/403) — fail open', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      status: 403,
      ok: false,
    } as Response);

    const result = await new JiraRestAdapter(config).validate('PROJ-1');
    expect(result).toBeNull();
  });

  it('returns null on rate limits (429) — fail open', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      status: 429,
      ok: false,
    } as Response);

    const result = await new JiraRestAdapter(config).validate('PROJ-1');
    expect(result).toBeNull();
  });

  it('returns null on network error — fail open', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const result = await new JiraRestAdapter(config).validate('PROJ-1');
    expect(result).toBeNull();
  });

  it('returns null when env vars are missing', async () => {
    delete process.env.JIRA_EMAIL;
    const result = await new JiraRestAdapter(config).validate('PROJ-1');
    expect(result).toBeNull();
  });

  it('strips trailing slash from baseUrl when constructing the URL', async () => {
    let capturedUrl: string | undefined;
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      capturedUrl = url;
      return Promise.resolve({
        status: 200,
        ok: true,
        json: async () => ({ key: 'PROJ-1', fields: { summary: 'x' } }),
      } as Response);
    });

    await new JiraRestAdapter({
      ...config,
      baseUrl: 'https://yourorg.atlassian.net/',
    }).validate('PROJ-1');

    expect(capturedUrl).toContain('https://yourorg.atlassian.net/rest/api/3');
    expect(capturedUrl).not.toContain('//rest');
  });
});
