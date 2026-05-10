import { unregisterTool } from '../config/index.js';
import { resolvePackageName } from '../core/index.js';
import { selectAdapter } from '../platform/index.js';
import { fail, ok } from '../ui/index.js';

export interface UninstallOptions {
  via?: string;
}

/** Uninstall a tool via the platform's package manager. */
export async function runUninstall(tool: string, options: UninstallOptions = {}): Promise<void> {
  const adapter = options.via
    ? ((await import('../platform/adapters/index.js')).adapters[options.via as never] ?? null)
    : await selectAdapter();

  if (!adapter) {
    console.error(`✗ No package manager available.`);
    process.exit(1);
  }
  const resolved = resolvePackageName(tool, adapter.name);
  if (!resolved) {
    console.error(`✗ ${tool} is not in the catalog for ${adapter.name}.`);
    process.exit(1);
  }
  console.log(`Uninstalling ${tool} via ${adapter.name}...`);
  const result = await adapter.uninstall(resolved.packageName);
  if (!result.success) {
    console.error(fail(`Uninstall failed: ${result.error ?? 'unknown error'}`));
    process.exit(1);
  }
  console.log(ok(`Uninstalled ${tool}`));
  unregisterTool(tool);
}
