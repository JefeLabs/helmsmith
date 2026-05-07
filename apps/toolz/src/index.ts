/**
 * Public API for `@agentx/toolz`. Other AgentX packages import from
 * here:
 *
 *   import { checkTool, detectPlatform } from "@agentx/toolz";
 *
 * Future additions (per the implementation plan): `ensureTool`,
 * `ensureTools`, registry CRUD.
 */

export {
  BUILT_IN_CATALOG,
  catalogToolNames,
  checkTool,
  getPath,
  getVersion,
  isInstalled,
  resolvePackageName,
} from "./core/index.js";
export type {
  CatalogEntry,
  ResolvedPackage,
  ToolCheckResult,
} from "./core/index.js";

export {
  adapters,
  detectPlatform,
  resetPlatformCache,
  selectAdapter,
} from "./platform/index.js";
export type {
  Architecture,
  InstallResult,
  LinuxFamily,
  PackageManagerAdapter,
  PackageManagerType,
  Platform,
  PlatformInfo,
} from "./platform/index.js";

export {
  ensureToolzDir,
  getRegistryPath,
  getRegisteredTool,
  getToolzDir,
  getUserCatalogPath,
  isRegistered,
  listRegisteredTools,
  loadRegistry,
  registerTool,
  saveRegistry,
  unregisterTool,
} from "./config/index.js";
export type { Registry, RegistryToolEntry } from "./config/index.js";
