/**
 * Linear adapter — GraphQL against api.linear.app.
 *
 * Auth: a personal API key from Linear (Settings → API → Personal API
 * keys). The key goes directly in the `Authorization` header (no
 * `Bearer` prefix — that's Linear's convention).
 *
 * Query: `issue(id: $id)` accepts either Linear's UUID or the
 * human-readable identifier (e.g. "ENG-123"), so callers can pass
 * the same ticket key used elsewhere in pritty.
 *
 * Failure modes:
 *   - Issue not found  → { exists: false }
 *   - GraphQL errors   → null (fail open; usually means malformed query
 *                              or auth issue, neither blocks the dev)
 *   - Network / non-200 → null
 */

import type { LinearValidation, TicketSystemAdapter, ValidationResult } from './index.js';

const LINEAR_GRAPHQL_URL = 'https://api.linear.app/graphql';

const ISSUE_QUERY = `
  query ($id: String!) {
    issue(id: $id) {
      identifier
      title
      url
      state {
        name
      }
    }
  }
`;

interface LinearGraphQLResponse {
  data?: {
    issue?: {
      identifier?: string;
      title?: string;
      url?: string;
      state?: { name?: string };
    } | null;
  };
  errors?: Array<{ message?: string }>;
}

export class LinearAdapter implements TicketSystemAdapter {
  readonly name = 'linear' as const;

  constructor(private readonly config: LinearValidation) {}

  async isAvailable(): Promise<boolean> {
    return Boolean(process.env[this.config.apiKeyEnv]);
  }

  async validate(ticket: string): Promise<ValidationResult | null> {
    const apiKey = process.env[this.config.apiKeyEnv];
    if (!apiKey) return null;

    let response: Response;
    try {
      response = await fetch(LINEAR_GRAPHQL_URL, {
        method: 'POST',
        headers: {
          Authorization: apiKey, // Linear: raw API key, no `Bearer`
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: ISSUE_QUERY,
          variables: { id: ticket },
        }),
      });
    } catch {
      return null; // network unreachable
    }

    if (!response.ok) return null;

    let json: LinearGraphQLResponse;
    try {
      json = (await response.json()) as LinearGraphQLResponse;
    } catch {
      return null;
    }

    if (json.errors && json.errors.length > 0) {
      // GraphQL-level errors (auth failure, bad query) — fail open
      return null;
    }

    const issue = json.data?.issue;
    if (!issue) {
      return {
        exists: false,
        error: `${ticket} not found in Linear`,
      };
    }

    return {
      exists: true,
      ...(issue.title ? { title: issue.title } : {}),
      ...(issue.state?.name ? { status: issue.state.name } : {}),
      ...(issue.url ? { url: issue.url } : {}),
    };
  }
}
