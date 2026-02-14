export { login, requestDeviceCode, pollForToken } from './device-flow.js';

export {
  readAuthCredentials,
  writeAuthCredentials,
  deleteAuthCredentials,
  resolveGitHubToken,
  getCopilotToken,
  callCopilot,
  fetchCopilotModels,
} from './token-manager.js';

export type {
  AuthCredentials,
  DeviceCodeResponse,
  CopilotTokenResponse,
  ChatCompletionMessage,
  ChatCompletionResponse,
  TokenSource,
  CopilotModelEntry,
} from './types.js';

export {
  AuthCredentialsSchema,
  COPILOT_CLIENT_ID,
  COPILOT_MODELS,
  EDITOR_VERSION,
} from './types.js';
