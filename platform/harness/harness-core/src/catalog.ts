import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  CatalogError,
  type FlowCatalog,
  type UnsupportedFeature,
  validateFlowCatalog,
} from '@helmsmith/flow-spec';

/**
 * Node-side catalog loading for the harness runtime. The spec itself —
 * types, validation, expression semantics, conformance fixtures — lives
 * in @helmsmith/flow-spec (browser-safe, zero deps) and is re-exported
 * here so existing `./catalog.ts` imports keep working.
 *
 * The catalog is admin-owned: clients submit *intent* (a flow id +
 * input), they do not design flows.
 *
 * Local layout: `.harness/config/flows.json` at the workspace root.
 * Production sources the same shape from controlplane (Spring Modulith
 * Catalog service) over HTTP — `loadCatalog()` is the local-fs path; the
 * controlplane-fed path lives in harness-server's `load-catalog.ts`.
 *
 * Runtime coverage of step kinds / tags / edges / expressions: see the
 * "RUNTIME COVERAGE MATRIX" comment block at the top of
 * `orchestrator.ts`.
 */
export * from '@helmsmith/flow-spec';

const EMPTY: FlowCatalog = { flows: [] };

/** One console.warn line per spec feature the runtime does not execute
 *  yet — policy, joinStrategy, terminal:'fail', non-manual triggers,
 *  js expressions, parallel fan-out. Loud at load time so catalog
 *  authors learn before a silent no-op ships. */
function warnUnsupported(path: string, f: UnsupportedFeature): void {
  console.warn(
    `[catalog] ${path}: ${f.where}: "${f.feature}" is not executed by the runtime yet — ${f.detail}`,
  );
}

/**
 * Reads the catalog file. Missing file → empty catalog (no throw) so a fresh
 * workspace boots without a config file. Malformed JSON or wrong shape throws
 * `CatalogError` with a path-prefixed message — fail loud on bad config.
 *
 * Catalog `accepts` Record-form (named sets) is preserved through loading.
 * Set selection happens per-job at submission time via `resolveAccepts`.
 */
export async function loadCatalog(workspaceRoot: string): Promise<FlowCatalog> {
  const path = join(workspaceRoot, '.harness', 'config', 'flows.json');
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return EMPTY;
    throw new CatalogError(`failed to read ${path}: ${(err as Error).message}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new CatalogError(`${path}: invalid JSON — ${(err as Error).message}`);
  }

  validateFlowCatalog(parsed, path, { onUnsupported: (f) => warnUnsupported(path, f) });
  return parsed as FlowCatalog;
}
