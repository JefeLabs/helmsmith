import type { DeviceCodeResponse, CopilotTokenResponse, ChatCompletionResponse } from '../../src/auth/types.js';

export const mockDeviceCodeResponse: DeviceCodeResponse = {
  device_code: 'dc_test_device_code_123',
  user_code: 'TEST-1234',
  verification_uri: 'https://github.com/login/device',
  expires_in: 900,
  interval: 5,
};

export const mockTokenResponse = {
  access_token: 'gho_test_access_token_abc123',
  token_type: 'bearer',
  scope: 'read:user',
};

export const mockTokenPendingResponse = {
  error: 'authorization_pending',
  error_description: 'The authorization request is still pending.',
};

export const mockTokenSlowDownResponse = {
  error: 'slow_down',
  error_description: 'Please slow down.',
};

export const mockTokenExpiredResponse = {
  error: 'expired_token',
  error_description: 'The device code has expired.',
};

export const mockTokenDeniedResponse = {
  error: 'access_denied',
  error_description: 'The user has denied the authorization request.',
};

export const mockCopilotTokenResponse: CopilotTokenResponse = {
  token: 'tid=test_copilot_token_xyz',
  expires_at: Math.floor(Date.now() / 1000) + 1800, // 30 minutes from now
};

export const mockExpiredCopilotTokenResponse: CopilotTokenResponse = {
  token: 'tid=expired_copilot_token',
  expires_at: Math.floor(Date.now() / 1000) - 60, // 1 minute ago
};

export const mockChatCompletionResponse: ChatCompletionResponse = {
  choices: [
    {
      message: {
        content: '{"score": 7, "label": "high", "reasoning": "Complex task with multiple integration points and cross-cutting concerns."}',
      },
    },
  ],
};

export const mockLowScoreChatResponse: ChatCompletionResponse = {
  choices: [
    {
      message: {
        content: '{"score": 2, "label": "low", "reasoning": "Simple, well-defined task."}',
      },
    },
  ],
};

export const mockMalformedChatResponse: ChatCompletionResponse = {
  choices: [
    {
      message: {
        content: 'This is not valid JSON at all',
      },
    },
  ],
};

export const mockUserResponse = {
  login: 'testuser',
};
