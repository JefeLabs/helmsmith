export {
  getChildType,
  generateSubtaskId,
  buildExpansionPrompt,
  parseExpansionResponse,
  heuristicExpand,
  expandTask,
  expandMultiple,
} from './expander.js';

export type {
  ExpansionOptions,
  ExpansionResult,
  ExpansionError,
  BatchExpansionResult,
} from './types.js';
