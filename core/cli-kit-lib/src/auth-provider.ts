/**
 * AuthProvider — the contract cli-kit consumers implement to wire
 * their auth library into commands that need a token.
 *
 * Why pluggable: cli-kit is consumed by toolbox apps (which use
 * `@ecruz165/agent-auth`) AND by platform CLIs (which may use
 * different auth flows). Hardcoding agent-auth would force every
 * consumer onto it.
 *
 * Why minimal: this interface is published and breaking it forces
 * every consumer to update. Login flows, token storage, refresh
 * policy — those belong in the auth library, not here.
 */
export interface AuthProvider {
  /**
   * Returns a fresh access token. Implementations are expected to
   * handle refresh internally and throw if the user isn't logged in.
   */
  getToken(): Promise<string>;

  /**
   * Returns the current user's identity, if available. `null` if not
   * logged in or the provider doesn't expose identity. Used by
   * `--whoami`-style commands.
   */
  whoami?(): Promise<{ id: string; email?: string; name?: string } | null>;
}

/**
 * No-op AuthProvider for commands that don't need auth, or for tests.
 * Calling `getToken()` throws — opt in explicitly.
 */
export const noopAuthProvider: AuthProvider = {
  async getToken(): Promise<string> {
    throw new Error(
      "noopAuthProvider.getToken() called — wire a real AuthProvider via createCli({ auth })",
    );
  },
  async whoami() {
    return null;
  },
};
