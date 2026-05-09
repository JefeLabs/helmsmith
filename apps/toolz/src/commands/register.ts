import { checkTool } from "../core/index.js";
import { registerTool } from "../config/index.js";
import { fail, ok } from "../ui/index.js";

/** Register an already-installed tool in the local registry. */
export async function runRegister(tool: string): Promise<void> {
  const check = await checkTool(tool);
  if (!check.installed) {
    console.error(fail(`${tool} is not on PATH. Install it first, then register.`));
    process.exit(1);
  }
  registerTool(tool, {
    version: check.version,
    path: check.path!,
    installed_via: null, // manually registered
    installed_at: null, // unknown — we didn't install it
  });
  console.log(ok(`Registered ${tool} ${check.version ?? ""} at ${check.path}`));
}
