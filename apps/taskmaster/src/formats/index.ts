// Re-export task schema types and schemas for use by other modules
export {
  type Dependency,
  DependencySchema,
  type TaskMetadata,
  TaskMetadataSchema,
  type TaskNode,
  TaskNodeSchema,
  TasksFileSchema,
} from '../config/schema.js';
export { getConfigValue, loadProjectConfig, readProjectConfig } from './config-reader.js';
export {
  readComponentIndex,
  readSymbolIndex,
  writeComponentIndex,
  writeSymbolIndex,
} from './index-store.js';
export { type SyncChange, type SyncResult, syncTaskFiles } from './sync.js';
export { generateTaskFiles } from './task-writer.js';
export { readTasks, writeTasks } from './tasks-store.js';
// Re-export format modules
export { safeDump, safeLoad, YamlParseError } from './yaml-bridge.js';
