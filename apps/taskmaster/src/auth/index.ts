// --- Legacy exports (kept for backward compatibility) ---

// --- Multi-provider exports ---
export { callAI, resolveActiveAuth } from './call-ai.js';
export { login, pollForToken, requestDeviceCode } from './device-flow.js';
export type { AIModelEntry, AIProvider, AIProviderName } from './provider.js';
export { AI_PROVIDERS, AIProviderNameSchema } from './provider.js';
export { clearProviders, getProvider } from './provider-registry.js';
export {
  callCopilot,
  deleteAuthCredentials,
  fetchCopilotModels,
  getCopilotToken,
  readAuthCredentials,
  readAuthFile,
  resolveGitHubToken,
  writeAuthCredentials,
  writeAuthFile,
} from './token-manager.js';

// --- Types ---
export type {
  AuthCredentials,
  AuthFile,
  ChatCompletionMessage,
  ChatCompletionResponse,
  CopilotCredentials,
  CopilotModelEntry,
  CopilotTokenResponse,
  DeviceCodeResponse,
  OAuthCredentials,
  TokenSource,
} from './types.js';

export {
  AuthCredentialsSchema,
  AuthFileSchema,
  COPILOT_CLIENT_ID,
  COPILOT_MODELS,
  CopilotCredentialsSchema,
  EDITOR_VERSION,
  OAuthCredentialsSchema,
} from './types.js';
