/**
 * Toolz's `connect` command.
 *
 * Toolz currently has no auth-required surface. The planned
 * "agent to add new tools" feature (per cli.ts) will add a
 * GitHub Copilot or Anthropic Connection here. Until then, the
 * view shows the empty-state ("no connections needed").
 */

import { runConnectView } from "@ecruz165/tui-view-components";

export async function runConnect(): Promise<void> {
  await runConnectView({
    appName: "toolz",
    // No required/optional connections today. Future agent-driven
    // features will add Connection objects here.
  });
}
