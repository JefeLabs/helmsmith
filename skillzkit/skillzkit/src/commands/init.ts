import {
  configExists,
  configPath,
} from "../init/config.js";
import { runInit, type InitOptions } from "../init/init.js";
import { gatherInitOptions } from "./_shared/gather-init.js";

export interface InitCliOptions extends Partial<InitOptions> {
  force?: boolean;
}

/**
 * First-run setup — creates ~/.agentx/skillzkit/config.json.
 * Interactive when called without args; pass flags to skip prompts.
 */
export async function runInitCommand(options: InitCliOptions): Promise<void> {
  // Refuse to overwrite without --force BEFORE any prompts run —
  // saves the user from typing through the whole flow only to be
  // told "config already exists, --force required."
  if (configExists() && !options.force) {
    console.error(`Config already exists at ${configPath()}.`);
    console.error(
      `  Pass --force to overwrite, or run \`skillzkit config\` to view/edit fields.`,
    );
    process.exit(1);
  }

  try {
    const opts = await gatherInitOptions(options);
    const result = runInit({ ...opts, force: options.force });

    console.log(
      `\n✓ ${result.overwrote ? "Updated" : "Created"} ${result.path}`,
    );
    console.log("");
    if (result.config.mode === "standalone") {
      console.log("Mode: standalone (using bundled skills)");
      console.log("Next:");
      console.log("  skillzkit list                  — browse the catalog");
      console.log("  skillzkit ui                    — interactive picker");
      console.log("  skillzkit install <slug>        — install a slug into your project");
    } else {
      console.log(`Mode: team`);
      console.log(`API:  ${result.config.team.apiUrl}`);
      console.log(`Key:  ${result.config.team.keyMasked}  (encrypted at rest)`);
      console.log("");
      console.log("Next:");
      console.log("  skillzkit ui                    — browse the team catalog");
      console.log("  skillzkit config                — view current configuration");
    }
  } catch (err) {
    console.error(`✗ ${(err as Error).message}`);
    process.exit(1);
  }
}
