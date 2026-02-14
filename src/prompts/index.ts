// Factory — reusable prompt builders
export {
  inputWithDefault,
  listWithDefault,
  checkboxWithDefaults,
  confirmPrompt,
  numberWithDefault,
  searchPrompt,
  resolveDefault,
  resetDefaultsCache,
} from './factory.js';

// Init wizard
export { runInitWizard, type InitWizardResult } from './init-wizard.js';

// Add task prompt
export { runAddTaskPrompt, type AddTaskResult } from './add-task.js';

// Config editor
export {
  runConfigEditor,
  getConfigValue,
  validateConfigValue,
  applyConfigValue,
  CONFIG_KEYS,
  type ConfigEditResult,
} from './config-editor.js';

// Confirmation prompts
export {
  confirmRemove,
  confirmExpand,
  confirmBulkOperation,
  type RemoveConfirmResult,
  type ExpandConfirmResult,
  type BulkConfirmResult,
} from './confirmations.js';
