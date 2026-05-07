export { detectPlatform, resetPlatformCache } from "./detect.js";
export type {
  Architecture,
  LinuxFamily,
  PackageManagerType,
  Platform,
  PlatformInfo,
} from "./types.js";
export type { InstallResult, PackageManagerAdapter } from "./package-managers.js";
export { adapters, selectAdapter } from "./adapters/index.js";
