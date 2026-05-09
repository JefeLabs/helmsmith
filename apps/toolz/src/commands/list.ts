import { BUILT_IN_CATALOG, catalogToolNames } from "../core/index.js";
import { listRegisteredTools } from "../config/index.js";
import { dim, heading } from "../ui/index.js";

export interface ListOptions {
  catalog?: boolean;
}

/** List tools registered in the local registry, or the built-in catalog. */
export function runList(options: ListOptions = {}): void {
  if (options.catalog) {
    const names = catalogToolNames();
    console.log(heading(`Catalog (${names.length} tools)`));
    console.log("");
    for (const name of names) {
      const entry = BUILT_IN_CATALOG[name];
      const desc = entry?.description ?? "(no description)";
      console.log(`  ${name.padEnd(12)} ${dim(`— ${desc}`)}`);
    }
    return;
  }
  const registered = listRegisteredTools();
  if (registered.length === 0) {
    console.log(
      dim(
        "No tools registered. Run `toolz install <tool>` or `toolz register <tool>`.",
      ),
    );
    return;
  }
  console.log(heading(`Registered tools (${registered.length})`));
  console.log("");
  for (const { name, entry } of registered) {
    const via = entry.installed_via ? ` via ${entry.installed_via}` : " (manual)";
    const ver = entry.version ?? "?";
    console.log(`  ${name.padEnd(12)} ${ver.padEnd(10)} ${dim(entry.path + via)}`);
  }
}
