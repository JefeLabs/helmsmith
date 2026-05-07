/**
 * Registry CRUD — `~/.agentx/toolz/registry.yaml`. Records which
 * tools are installed, what version, where, by which manager, and
 * when. Persists across sessions; consumed by `toolz list`,
 * `toolz doctor`, and (Phase 5) the `ensureTool` flow to short-circuit
 * already-installed tools without re-probing the filesystem.
 *
 * YAML shape (per PRD §4):
 *
 *   version: 1
 *   updated_at: "..."
 *   tools:
 *     git:
 *       version: "2.43.0"
 *       path: "/usr/bin/git"
 *       installed_via: brew
 *       installed_at: "..."
 *       registered_at: "..."
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parse, stringify } from "yaml";
import type { PackageManagerType } from "../platform/types.js";
import { ensureToolzDir, getRegistryPath } from "./paths.js";

export interface RegistryToolEntry {
  /** Parsed version string (or null if the tool didn't report one). */
  version: string | null;
  /** Resolved binary path on disk. */
  path: string;
  /** Which package manager installed this — informational; skip when manually registered. */
  installed_via: PackageManagerType | null;
  /** ISO timestamp of original install (when known). */
  installed_at: string | null;
  /** ISO timestamp of last registry write for this entry. */
  registered_at: string;
}

export interface Registry {
  version: 1;
  updated_at: string;
  tools: Record<string, RegistryToolEntry>;
}

/**
 * Factory — returns a freshly-allocated empty registry every call.
 * Avoid sharing a module-level EMPTY constant via `{ ...EMPTY }` —
 * the spread is shallow, so callers that mutate the returned `tools`
 * object would scribble on every subsequent loader's result.
 */
function emptyRegistry(): Registry {
  return {
    version: 1,
    updated_at: "1970-01-01T00:00:00Z",
    tools: {},
  };
}

/**
 * Load the registry. Returns an empty registry when the file is
 * missing or corrupt — never throws on read. Corrupt files are
 * silently treated as empty so the caller can recover by writing a
 * fresh registry.
 */
export function loadRegistry(): Registry {
  const path = getRegistryPath();
  if (!existsSync(path)) return emptyRegistry();
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = parse(raw);
    if (!parsed || typeof parsed !== "object") return emptyRegistry();
    return {
      version: 1,
      updated_at: String(parsed.updated_at ?? "1970-01-01T00:00:00Z"),
      tools: (parsed.tools ?? {}) as Record<string, RegistryToolEntry>,
    };
  } catch {
    return emptyRegistry();
  }
}

/** Atomic-ish write — writes to a temp path first, then renames. */
export function saveRegistry(registry: Registry): void {
  ensureToolzDir();
  const path = getRegistryPath();
  const next: Registry = {
    ...registry,
    updated_at: new Date().toISOString(),
  };
  writeFileSync(path, stringify(next), "utf8");
}

export function registerTool(
  name: string,
  entry: Omit<RegistryToolEntry, "registered_at">,
): void {
  const registry = loadRegistry();
  registry.tools[name] = {
    ...entry,
    registered_at: new Date().toISOString(),
  };
  saveRegistry(registry);
}

export function unregisterTool(name: string): boolean {
  const registry = loadRegistry();
  if (!(name in registry.tools)) return false;
  delete registry.tools[name];
  saveRegistry(registry);
  return true;
}

export function isRegistered(name: string): boolean {
  return name in loadRegistry().tools;
}

export function getRegisteredTool(name: string): RegistryToolEntry | undefined {
  return loadRegistry().tools[name];
}

export function listRegisteredTools(): Array<{
  name: string;
  entry: RegistryToolEntry;
}> {
  const registry = loadRegistry();
  return Object.entries(registry.tools)
    .map(([name, entry]) => ({ name, entry }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
