import chalk from 'chalk';
import {
  claimRanges,
  currentOwner,
  Git,
  homeDir,
  loadManifest,
  Registry,
  startServices,
  stopServices,
} from '../core/index.js';
import type { Ctx } from './effort.js';
import { storybrokrCli } from './storybrokr.js';

/** The repo root is the MAIN checkout of whatever checkout the caller stands in. */
export function resolveRepoRoot(cwd: string, override?: string): string {
  if (override) return override;
  return new Git(cwd).mainRoot();
}

/** Build the context every verb shares; the project's port ranges are claimed on first use. */
export async function buildCtx(
  opts: { cwd?: string; projectRoot?: string; quiet?: boolean } = {},
): Promise<Ctx> {
  const repoRoot = resolveRepoRoot(opts.cwd ?? process.cwd(), opts.projectRoot);
  const manifest = await loadManifest(repoRoot);
  const home = homeDir();
  const registry = Registry.open(home);
  if (!registry.project(manifest.project)) claimRanges(registry, manifest, repoRoot);
  return {
    home,
    repoRoot,
    manifest,
    registry,
    owner: currentOwner(),
    runner: { start: startServices, stop: stopServices },
    storybrokr: storybrokrCli,
    log: opts.quiet ? () => {} : (line) => console.error(chalk.gray(line)),
  };
}
