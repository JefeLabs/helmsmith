/**
 * Pritty's adapter from its existing AuthFile-based storage to
 * @ecruz165/cli-kit's AuthProvider interface. Lets cli-kit-aware
 * commands (or future shared kit features) ask "what's the token?"
 * without knowing about pritty's auth.json layout.
 *
 * Multi-provider env-var fallback intentionally stays in src/ai.ts
 * (the chat-call layer) — that's where the per-provider routing
 * already lives. This adapter only resolves the github-copilot
 * apiKey from disk; pritty's primary auth surface.
 */
import type { AuthProvider } from "@ecruz165/cli-kit";
import { readAuth } from "./auth.js";

export const prittyAuthProvider: AuthProvider = {
  async getToken(): Promise<string> {
    const auth = await readAuth();
    const apiKey = auth.providers["github-copilot"]?.apiKey;
    if (!apiKey) {
      throw new Error("Not logged in. Run `pritty auth login`.");
    }
    return apiKey;
  },

  async whoami() {
    const auth = await readAuth();
    const ids = Object.keys(auth.providers);
    if (ids.length === 0) return null;
    return { id: ids[0]! };
  },
};
