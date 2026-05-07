/**
 * Branded banner shown on bare `toolz` invocation. Kept compact —
 * one heading line + tagline + commands hint. Skip the ASCII-art
 * extravagance until there's a real reason for it.
 */

import { dim, heading } from "./symbols.js";

export function printBanner(version: string): void {
  console.log(heading(`🔧 ToolZ ${version}`));
  console.log(dim("Cross-platform tool manager for the AgentX ecosystem"));
  console.log("");
  console.log("Common commands:");
  console.log(dim("  toolz check <tool>      Is it installed? At what version?"));
  console.log(dim("  toolz install <tool>    Install via the platform package manager"));
  console.log(dim("  toolz ensure <tool>     Check + install + register in one call"));
  console.log(dim("  toolz list              Registered tools"));
  console.log(dim("  toolz doctor            Validate the registry against reality"));
  console.log("");
  console.log(dim("Run `toolz --help` for the full command list."));
}
