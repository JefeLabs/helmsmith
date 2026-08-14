/**
 * harness-core registers exactly the adapters bindingToSpec can emit — and
 * deliberately NOT bedrock-sdk, which would pull @aws-sdk into every consumer.
 */

import { registeredAdapterTypes } from '@helmsmith/agent-adapter';
import { describe, expect, it } from 'vitest';
import { registerBindingAdapters } from './register-binding-adapters.ts';

describe('registerBindingAdapters', () => {
  it('starts from an empty registry — importing adapter modules registers nothing', () => {
    // The externalization contract: imports are inert, registration is a
    // statement. If this fails, something regained an import-time side effect.
    expect(registeredAdapterTypes()).toEqual([]);
  });

  it('registers exactly the four types bindingToSpec emits', () => {
    registerBindingAdapters();
    expect(new Set(registeredAdapterTypes())).toEqual(
      new Set(['claude-sdk', 'openai-sdk', 'copilot-sdk', 'opencode-cli']),
    );
  });

  it('does not register bedrock-sdk', () => {
    registerBindingAdapters();
    expect(registeredAdapterTypes()).not.toContain('bedrock-sdk');
  });

  it('is safe to call twice', () => {
    registerBindingAdapters();
    registerBindingAdapters();
    expect(registeredAdapterTypes()).toHaveLength(4);
  });
});
