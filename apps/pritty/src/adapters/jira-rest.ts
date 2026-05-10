/**
 * Jira Cloud REST API adapter.
 *
 * Auth: HTTP Basic with `<email>:<api-token>` (base64). API tokens
 * are created at https://id.atlassian.com/manage-profile/security/api-tokens.
 *
 * Endpoint: `GET /rest/api/3/issue/{issueIdOrKey}?fields=summary,status`
 *
 * Response shape (relevant fields):
 *   { key, fields: { summary, status: { name } } }
 *
 * Failure modes:
 *   - 404 → ticket doesn't exist → { exists: false }
 *   - 401/403 → return null (caller fails open with a warning)
 *   - 429 → return null (rate-limited; let caller retry on next run)
 *   - network error → return null
 */

import type { JiraRestValidation, TicketSystemAdapter, ValidationResult } from './index.js';

interface JiraIssueResponse {
  key?: string;
  fields?: {
    summary?: string;
    status?: { name?: string };
  };
}

export class JiraRestAdapter implements TicketSystemAdapter {
  readonly name = 'jira-rest' as const;

  constructor(private readonly config: JiraRestValidation) {}

  async isAvailable(): Promise<boolean> {
    return Boolean(
      this.config.baseUrl && process.env[this.config.emailEnv] && process.env[this.config.tokenEnv],
    );
  }

  async validate(ticket: string): Promise<ValidationResult | null> {
    const email = process.env[this.config.emailEnv];
    const token = process.env[this.config.tokenEnv];
    if (!email || !token) return null;

    const base = this.config.baseUrl.replace(/\/$/, '');
    const url = `${base}/rest/api/3/issue/${encodeURIComponent(ticket)}?fields=summary,status`;
    const auth = Buffer.from(`${email}:${token}`).toString('base64');

    let response: Response;
    try {
      response = await fetch(url, {
        headers: {
          Authorization: `Basic ${auth}`,
          Accept: 'application/json',
        },
      });
    } catch {
      return null; // network unreachable — fail open
    }

    if (response.status === 404) {
      return {
        exists: false,
        error: `${ticket} not found in Jira (${base})`,
      };
    }
    if (!response.ok) {
      // 401/403/429/500 → fail open, let caller decide whether to warn
      return null;
    }

    let data: JiraIssueResponse;
    try {
      data = (await response.json()) as JiraIssueResponse;
    } catch {
      return null;
    }

    return {
      exists: true,
      title: data.fields?.summary,
      status: data.fields?.status?.name,
      url: `${base}/browse/${ticket}`,
    };
  }
}
