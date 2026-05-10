import { ensureTool, ensureTools } from '../core/index.js';
import { dim, fail, ok, warn } from '../ui/index.js';

export interface EnsureOptions {
  minVersion?: string;
  autoInstall?: boolean;
  silent?: boolean;
  via?: string;
}

/**
 * Ensure one or more tools are installed; install missing ones if
 * --auto-install. Exits non-zero if any tool is missing or below
 * --min-version.
 */
export async function runEnsure(tools: string[], options: EnsureOptions = {}): Promise<void> {
  const opts = {
    ...(options.minVersion ? { minVersion: options.minVersion } : {}),
    ...(options.autoInstall !== undefined ? { autoInstall: options.autoInstall } : {}),
    ...(options.silent !== undefined ? { silent: options.silent } : {}),
    ...(options.via ? { via: options.via as never } : {}),
  };

  const statuses =
    tools.length === 1 ? [await ensureTool(tools[0], opts)] : await ensureTools(tools, opts);

  let anyMissing = false;
  let anyStale = false;
  for (const status of statuses) {
    if (status.error) {
      console.error(fail(`${status.name}: ${status.error}`));
      anyMissing = true;
      continue;
    }
    if (!status.installed) {
      console.error(
        fail(
          `${status.name}: not installed${
            opts.autoInstall ? ' (install also failed)' : '; pass --auto-install to attempt install'
          }`,
        ),
      );
      anyMissing = true;
      continue;
    }
    if (status.versionTooLow) {
      console.error(
        warn(
          `${status.name} ${status.version ?? '(unknown)'}: below minVersion ${opts.minVersion}`,
        ),
      );
      anyStale = true;
      continue;
    }
    if (!options.silent) {
      console.log(ok(`${status.name} ${status.version ?? ''} ${dim(`(${status.source})`)}`));
    }
  }

  if (anyMissing || anyStale) process.exit(1);
}
