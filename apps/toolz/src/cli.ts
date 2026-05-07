/**
 * ToolZ CLI entry. Commander.js per agentx-toolbox stack convention.
 * Phase 1+2 surface area: `platform`, `check`. More commands land in
 * later phases (install, list, register, doctor, etc.).
 */

import { Command } from "commander";
import { detectPlatform } from "./platform/index.js";
import { checkTool } from "./core/index.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function readVersion(): string {
  // Walk up from the compiled cli.js (in dist/) to find package.json.
  for (let dir = __dirname, i = 0; i < 4; i++, dir = dirname(dir)) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
      if (pkg.name === "@agentx/toolz") return pkg.version as string;
    } catch {
      /* keep walking */
    }
  }
  return "0.0.0";
}

const program = new Command();

program
  .name("toolz")
  .description("ToolZ — cross-platform tool manager for AgentX")
  .version(readVersion());

program
  .command("platform")
  .description("Show the detected OS, architecture, distro family, and WSL state")
  .action(() => {
    const info = detectPlatform();
    console.log(JSON.stringify(info, null, 2));
  });

program
  .command("check <tool>")
  .description("Check whether a CLI tool is installed; show its path and parsed version")
  .option("--version-flag <flag>", "Override the default `--version` flag")
  .action(
    async (
      tool: string,
      options: { versionFlag?: string },
    ) => {
      const result = await checkTool(tool, {
        ...(options.versionFlag ? { versionFlag: options.versionFlag } : {}),
      });
      if (!result.installed) {
        console.log(`✗ ${tool} — not installed`);
        process.exit(1);
      }
      console.log(`✓ ${tool}`);
      console.log(`  path:    ${result.path}`);
      console.log(`  version: ${result.version ?? "(unparseable)"}`);
    },
  );

program.parseAsync(process.argv).catch((err) => {
  console.error(err);
  process.exit(1);
});
