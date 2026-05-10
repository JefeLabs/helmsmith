/**
 * Bearer-token verification for the contribute endpoints.
 *
 * The skillzkit API does not own user identity. Tokens are minted by
 * the host platform (typically agentx-controlplane) and presented to
 * skillzkit as opaque strings. The AuthVerifier interface is the seam
 * between "the request has this bearer token" and "this is the
 * AuthorIdentity I should record on the version metadata."
 */

import type { AuthorIdentity } from "./contracts.js";

export interface AuthVerifier {
  /**
   * Verify a bearer token and return the corresponding AuthorIdentity,
   * or null if the token is invalid / expired / revoked.
   * Returning null (not throwing) keeps error handling at the
   * endpoint layer where HTTP status mapping happens.
   */
  verifyToken(token: string): Promise<AuthorIdentity | null>;
}

/**
 * Single-token verifier - reads a static token + identity from env
 * vars. Use for local development where you want a working
 * contribute endpoint without setting up controlplane.
 *
 * Required env vars:
 *   SKILLZKIT_DEV_TOKEN=...  - the bearer token clients must send
 *   SKILLZKIT_DEV_AUTHOR_ID=... - the stable author id to record
 *   SKILLZKIT_DEV_AUTHOR_NAME=... - display name
 *   SKILLZKIT_DEV_AUTHOR_EMAIL=... (optional)
 */
export class StaticTokenVerifier implements AuthVerifier {
  constructor(private readonly config: StaticTokenConfig | null) {}

  static fromEnv(env: NodeJS.ProcessEnv = process.env): StaticTokenVerifier {
    const token = env.SKILLZKIT_DEV_TOKEN;
    const id = env.SKILLZKIT_DEV_AUTHOR_ID;
    const name = env.SKILLZKIT_DEV_AUTHOR_NAME;
    if (!token || !id || !name) {
      return new StaticTokenVerifier(null);
    }
    return new StaticTokenVerifier({
      token,
      identity: {
        id,
        displayName: name,
        email: env.SKILLZKIT_DEV_AUTHOR_EMAIL,
      },
    });
  }

  async verifyToken(token: string): Promise<AuthorIdentity | null> {
    if (!this.config) return null;
    if (token !== this.config.token) return null;
    return this.config.identity;
  }
}

interface StaticTokenConfig {
  token: string;
  identity: AuthorIdentity;
}

/**
 * Test-only verifier - accepts any non-empty token, returns the
 * configured identity.
 */
export class FixedAuthorVerifier implements AuthVerifier {
  constructor(private readonly identity: AuthorIdentity) {}

  async verifyToken(token: string): Promise<AuthorIdentity | null> {
    if (!token || token.trim().length === 0) return null;
    return this.identity;
  }
}

/**
 * Always-fails verifier. Default when no auth is wired up.
 */
export class NoAuthVerifier implements AuthVerifier {
  async verifyToken(_token: string): Promise<AuthorIdentity | null> {
    return null;
  }
}

/**
 * Extract the token portion of an `Authorization: Bearer <token>`
 * header. Returns null for missing or malformed headers.
 */
export function extractBearerToken(
  authHeader: string | null | undefined,
): string | null {
  if (!authHeader) return null;
  const match = authHeader.match(/^Bearer\s+(\S+)$/i);
  return match ? match[1] : null;
}
