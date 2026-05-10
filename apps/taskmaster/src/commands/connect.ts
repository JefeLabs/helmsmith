/**
 * Taskmaster's `connect` command.
 *
 * Taskmaster's auth model is per-project (multi-provider with PKCE
 * for Anthropic Claude.ai), which doesn't fit the simple
 * Connection contract from `@ecruz165/tui-view-components` cleanly.
 *
 * For now: open the connect view with stub Connections that surface
 * the providers used by the active project. Real wiring needs a
 * follow-up that exposes per-project auth state via a Connection
 * adapter — tracked alongside the schema-convergence work in
 * `apps/taskmaster/CLAUDE.md` (auth scope section).
 */

import {
  noopConnection,
  runConnectView,
} from "@ecruz165/tui-view-components";

export async function runConnect(): Promise<void> {
  await runConnectView({
    appName: "agentx-taskmaster",
    optional: [
      noopConnection({
        id: "github-copilot",
        displayName: "GitHub Copilot",
        description:
          "AI provider for scoring and decomposition. Wire via per-project config.ai.provider.",
      }),
      noopConnection({
        id: "anthropic",
        displayName: "Anthropic API",
        description:
          "Optional alternative provider. Configure via PKCE flow per project.",
      }),
    ],
  });
}
