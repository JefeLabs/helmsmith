/**
 * CredentialBroker — structural interface for credential resolution.
 *
 * The lib's OWN structural copy so it has NO hard @helmsmith/agent-auth
 * dependency. agent-auth's FileBroker / AuthClient satisfies it structurally
 * as long as its getCredential() signature is compatible.
 *
 * PRD §12: "The CredentialBroker interface in src/credentials/broker.ts is a
 * structural subset of agent-auth-lib's AuthClient."
 */
export interface CredentialBroker {
  /**
   * Resolve a credential for the named provider (e.g. 'anthropic', 'copilot',
   * 'github'). Returns the resolved API key and an optional expiry timestamp.
   *
   * Implementations may refresh tokens transparently (e.g. Copilot tokens are
   * short-lived; the broker handles rotation). The adapter calls this once per
   * invocation; caching is the broker's responsibility.
   */
  getCredential(provider: string): Promise<{ apiKey: string; expiresAt?: Date }>;
}
