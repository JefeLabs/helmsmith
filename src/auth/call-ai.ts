import type { ChatCompletionMessage, ChatCompletionResponse } from './types.js';
import type { AIProviderName } from './provider.js';
import { getProvider } from './provider-registry.js';
import { readAuthFile } from './token-manager.js';

/**
 * Unified AI call dispatcher. Resolves the provider and calls its AI endpoint.
 * Consumer modules use this instead of importing callCopilot directly.
 *
 * @param messages - Chat completion messages
 * @param model - Model identifier (e.g. 'gpt-4o', 'claude-sonnet-4')
 * @param providerName - Explicit provider override; if omitted, reads from auth.json active_provider
 */
export async function callAI(
  messages: ChatCompletionMessage[],
  model: string,
  providerName?: AIProviderName,
): Promise<ChatCompletionResponse> {
  const name = providerName ?? (await readAuthFile()).active_provider;
  const provider = getProvider(name);
  return provider.callAI(messages, model);
}

/**
 * Check whether the active (or specified) provider has valid credentials.
 * Drop-in replacement for resolveGitHubToken() — works across all providers.
 *
 * @returns `{ source: string }` if authenticated, `null` otherwise.
 */
export async function resolveActiveAuth(
  providerName?: AIProviderName,
): Promise<{ source: string } | null> {
  const name = providerName ?? (await readAuthFile()).active_provider;
  const provider = getProvider(name);
  return provider.resolveAuth();
}
