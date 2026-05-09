import { checkTool } from "../core/index.js";
import { dim, fail, ok } from "../ui/index.js";

export interface CheckOptions {
  versionFlag?: string;
}

/**
 * Check whether a CLI tool is installed; show its path and parsed
 * version. Exits 1 if not installed.
 */
export async function runCheck(
  tool: string,
  options: CheckOptions = {},
): Promise<void> {
  const result = await checkTool(tool, {
    ...(options.versionFlag ? { versionFlag: options.versionFlag } : {}),
  });
  if (!result.installed) {
    console.log(fail(`${tool} — not installed`));
    process.exit(1);
  }
  console.log(ok(tool));
  console.log(dim(`  path:    ${result.path}`));
  console.log(dim(`  version: ${result.version ?? "(unparseable)"}`));
}
