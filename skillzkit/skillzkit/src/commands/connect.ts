/**
 * Skillzkit's `connect` command.
 *
 * Skillzkit's auth model uses a team-mode API key (encrypted at
 * rest with a PIN), not a token-based device flow. Real Connection
 * adapters for the team-mode flow are future work; for now this
 * surfaces a stub so the connect view exists across the toolbox.
 */

import {
  noopConnection,
  runConnectView,
} from "@ecruz165/tui-view-components";

export async function runConnect(): Promise<void> {
  await runConnectView({
    appName: "skillzkit",
    optional: [
      noopConnection({
        id: "skillzkit-team-api",
        displayName: "Skillzkit Team API",
        description:
          "Team-mode connection (API key + PIN). Configured via `skillzkit init --mode team`.",
      }),
    ],
  });
}
