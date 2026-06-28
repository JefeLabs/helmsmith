export type { DoctorFinding, DoctorSeverity } from './doctor.js';
export { runDoctor } from './doctor.js';
export type { EnsureOptions, EnsureSource, ToolStatus } from './ensure.js';
export { ensureTool, ensureTools } from './ensure.js';
export type { ToolCheckResult } from './tool-checker.js';
export {
  checkTool,
  getPath,
  getVersion,
  isInstalled,
} from './tool-checker.js';
export type { CatalogEntry, ResolvedPackage } from './tool-resolver.js';
export {
  BUILT_IN_CATALOG,
  catalogToolNames,
  resolvePackageName,
} from './tool-resolver.js';
