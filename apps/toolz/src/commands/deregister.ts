import { isRegistered, unregisterTool } from "../config/index.js";
import { fail, ok } from "../ui/index.js";

/** Remove a tool from the registry (does NOT uninstall). */
export function runDeregister(tool: string): void {
  if (!isRegistered(tool)) {
    console.error(fail(`${tool} is not registered.`));
    process.exit(1);
  }
  unregisterTool(tool);
  console.log(ok(`Deregistered ${tool}`));
}
