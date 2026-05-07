/**
 * The `ensure` API — the primary entry point other AgentX packages
 * consume. Given a canonical tool name, ensure it's available, and
 * optionally install it if missing.
 *
 * Flow:
 *   1. Check the registry for a fast path. If recorded and the path
 *      still resolves, return immediately (source: "registry").
 *   2. Probe with the tool-checker. If installed but not registered,
 *      register it on the fly (source: "found-on-path").
 *   3. If not installed:
 *        - autoInstall === true → resolve catalog entry, pick adapter,
 *          install, register, return (source: "fresh-install")
 *        - autoInstall === false → return { installed: false } so the
 *          caller can decide what to do (prompt, fail, etc.)
 *   4. If `minVersion` provided, compare via semver. Below threshold:
 *      mark `versionTooLow: true`. Caller decides whether to error.
 *
 * The function never throws — every failure mode returns a structured
 * ToolStatus with `error` populated. This makes it safe for AgentX
 * tools to call in setup paths without try/catch noise.
 */

import semver from "semver";
import {
  getRegisteredTool,
  isRegistered,
  registerTool,
} from "../config/registry.js";
import { selectAdapter } from "../platform/adapters/index.js";
import type { PackageManagerAdapter } from "../platform/package-managers.js";
import type { PackageManagerType } from "../platform/types.js";
import { checkTool } from "./tool-checker.js";
import { resolvePackageName } from "./tool-resolver.js";

export type EnsureSource =
  | "registry" // hit the registry fast path
  | "found-on-path" // not in registry, but found via tool-checker
  | "fresh-install" // installed during this call
  | "missing"; // not installed; autoInstall was false

export interface EnsureOptions {
  /** Minimum acceptable semver. Compared with semver.gte. */
  minVersion?: string;
  /**
   * When true, install the tool if it's missing. When false (default),
   * return status with installed=false so the caller can prompt.
   */
  autoInstall?: boolean;
  /**
   * Suppress console output. The function never logs to stdout when
   * silent; errors still go to the returned status object.
   */
  silent?: boolean;
  /** Force a specific package manager (otherwise auto-selected). */
  via?: PackageManagerType;
}

export interface ToolStatus {
  name: string;
  /** Is the tool currently installed and on PATH? */
  installed: boolean;
  /** Parsed version, or null if unparseable / not installed. */
  version: string | null;
  /** Resolved binary path, or null if not installed. */
  path: string | null;
  /** ISO timestamp from the registry, or null if not registered. */
  registeredAt: string | null;
  /** How the result was produced. */
  source: EnsureSource;
  /**
   * True when minVersion was supplied and version is below it.
   * Independent of `installed` — a tool can be installed but stale.
   */
  versionTooLow: boolean;
  /** Set on adapter / install failures. Caller decides how to surface. */
  error?: string;
}

export async function ensureTool(
  name: string,
  options: EnsureOptions = {},
): Promise<ToolStatus> {
  const opts = { autoInstall: false, silent: false, ...options };

  // 1. Registry fast path
  const fromRegistry = checkRegistry(name);
  if (fromRegistry) {
    return finalizeStatus(fromRegistry, opts.minVersion);
  }

  // 2. Probe PATH
  const probed = await checkTool(name);
  if (probed.installed) {
    // Found on disk — register so future calls take the fast path
    registerTool(name, {
      version: probed.version,
      path: probed.path!,
      installed_via: null,
      installed_at: null,
    });
    return finalizeStatus(
      {
        name,
        installed: true,
        version: probed.version,
        path: probed.path,
        registeredAt: new Date().toISOString(),
        source: "found-on-path",
        versionTooLow: false,
      },
      opts.minVersion,
    );
  }

  // 3. Not installed
  if (!opts.autoInstall) {
    return {
      name,
      installed: false,
      version: null,
      path: null,
      registeredAt: null,
      source: "missing",
      versionTooLow: false,
    };
  }

  // autoInstall — pick adapter, resolve, install, register
  const adapter = opts.via
    ? (await import("../platform/adapters/index.js")).adapters[opts.via]
    : await selectAdapter();

  if (!adapter) {
    return {
      name,
      installed: false,
      version: null,
      path: null,
      registeredAt: null,
      source: "missing",
      versionTooLow: false,
      error: opts.via
        ? `Requested package manager "${opts.via}" is not implemented or not available on this host.`
        : "No package manager available on this host.",
    };
  }

  return doInstall(name, adapter, opts);
}

export async function ensureTools(
  names: string[] | Record<string, EnsureOptions>,
  sharedOptions: EnsureOptions = {},
): Promise<ToolStatus[]> {
  const entries: Array<[string, EnsureOptions]> = Array.isArray(names)
    ? names.map((n) => [n, sharedOptions])
    : Object.entries(names).map(
        ([n, opts]): [string, EnsureOptions] => [n, { ...sharedOptions, ...opts }],
      );

  // Sequential — adapter calls touch shell + filesystem; parallelism
  // doesn't buy much and serializes nicer log output.
  const results: ToolStatus[] = [];
  for (const [name, opts] of entries) {
    results.push(await ensureTool(name, opts));
  }
  return results;
}

// ─── internals ──────────────────────────────────────────────────────

function checkRegistry(name: string): ToolStatus | null {
  if (!isRegistered(name)) return null;
  const entry = getRegisteredTool(name);
  if (!entry) return null;
  // Note: we trust the registry's path. The Phase 6 `toolz doctor`
  // command will validate stale entries; ensure() prefers fast.
  return {
    name,
    installed: true,
    version: entry.version,
    path: entry.path,
    registeredAt: entry.registered_at,
    source: "registry",
    versionTooLow: false,
  };
}

async function doInstall(
  name: string,
  adapter: PackageManagerAdapter,
  opts: EnsureOptions,
): Promise<ToolStatus> {
  const resolved = resolvePackageName(name, adapter.name);
  if (!resolved) {
    return {
      name,
      installed: false,
      version: null,
      path: null,
      registeredAt: null,
      source: "missing",
      versionTooLow: false,
      error: `${name} is not in the catalog, or has no entry for ${adapter.name}.`,
    };
  }

  if (!opts.silent) {
    console.log(`Installing ${name} via ${adapter.name} (${resolved.packageName})...`);
  }

  const result = await adapter.install(resolved.packageName);
  if (!result.success) {
    return {
      name,
      installed: false,
      version: null,
      path: null,
      registeredAt: null,
      source: "missing",
      versionTooLow: false,
      error: `Install failed: ${result.error ?? "unknown error"}`,
    };
  }

  // Probe the freshly-installed binary so version + path are accurate
  const probed = await checkTool(name);
  if (!probed.installed || !probed.path) {
    return {
      name,
      installed: false,
      version: null,
      path: null,
      registeredAt: null,
      source: "missing",
      versionTooLow: false,
      error: "Install reported success but the binary isn't on PATH. Check the package manager output.",
    };
  }

  registerTool(name, {
    version: probed.version,
    path: probed.path,
    installed_via: adapter.name,
    installed_at: new Date().toISOString(),
  });

  return finalizeStatus(
    {
      name,
      installed: true,
      version: probed.version,
      path: probed.path,
      registeredAt: new Date().toISOString(),
      source: "fresh-install",
      versionTooLow: false,
    },
    opts.minVersion,
  );
}

/**
 * Apply the minVersion check to a status that's already known
 * installed. Returns the status unchanged when minVersion isn't set,
 * or with versionTooLow=true when the current version is below the
 * threshold. Unparseable versions count as "low" so callers see it.
 */
function finalizeStatus(
  status: ToolStatus,
  minVersion: string | undefined,
): ToolStatus {
  if (!minVersion || !status.installed) return status;
  if (!status.version) {
    return { ...status, versionTooLow: true };
  }
  const coerced = semver.coerce(status.version);
  if (!coerced) {
    return { ...status, versionTooLow: true };
  }
  const ok = semver.gte(coerced, minVersion);
  return { ...status, versionTooLow: !ok };
}
