export {
  buildExpansionPrompt,
  expandMultiple,
  expandTask,
  generateSubtaskId,
  getChildType,
  heuristicExpand,
  parseExpansionResponse,
} from './expander.js';

export type {
  BatchExpansionResult,
  ExpansionError,
  ExpansionOptions,
  ExpansionResult,
} from './types.js';
