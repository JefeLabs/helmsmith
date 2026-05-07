/**
 * Public API for `@agentx/toolz`. Other AgentX packages import from
 * here:
 *
 *   import { checkTool, detectPlatform } from "@agentx/toolz";
 *
 * Future additions (per the implementation plan): `ensureTool`,
 * `ensureTools`, registry CRUD.
 */

export { checkTool, getPath, getVersion, isInstalled } from "./core/index.js";
export type { ToolCheckResult } from "./core/index.js";

export { detectPlatform, resetPlatformCache } from "./platform/index.js";
export type {
  Architecture,
  LinuxFamily,
  PackageManagerType,
  Platform,
  PlatformInfo,
} from "./platform/index.js";
