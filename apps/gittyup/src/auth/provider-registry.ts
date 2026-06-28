import type { AIProvider, AIProviderName } from './provider.js';
import { AnthropicProvider } from './providers/anthropic.js';
import { CopilotProvider } from './providers/copilot.js';
import { OpenAIProvider } from './providers/openai.js';

/** Singleton instances — one per provider name. */
const providers = new Map<AIProviderName, AIProvider>();

/**
 * Get (or lazily create) the AIProvider instance for the given name.
 */
export function getProvider(name: AIProviderName): AIProvider {
  let provider = providers.get(name);
  if (provider) return provider;

  switch (name) {
    case 'copilot':
      provider = new CopilotProvider();
      break;
    case 'anthropic':
      provider = new AnthropicProvider();
      break;
    case 'openai':
      provider = new OpenAIProvider();
      break;
    default: {
      const _exhaustive: never = name;
      throw new Error(`Unknown AI provider: ${_exhaustive}`);
    }
  }

  providers.set(name, provider);
  return provider;
}

/**
 * Clear cached provider instances (useful for testing).
 */
export function clearProviders(): void {
  providers.clear();
}
