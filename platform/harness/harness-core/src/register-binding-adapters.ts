/**
 * The adapter set harness-core's `bindingToSpec` can produce.
 *
 * Kept beside the mapper that defines it, so the inventory and the mapping
 * cannot drift: every `return { type: ... }` in binding-to-spec.ts must have a
 * registrar here.
 *
 * bedrock-sdk is deliberately ABSENT. bindingToSpec throws for bedrock bindings
 * and tells the caller to register it themselves — registering it here would
 * pull @aws-sdk into every harness-core consumer, which is the forced-provider
 * tax the adapter externalization exists to remove.
 *
 * Call this once at your composition root (an app or CLI entry point), not from
 * library code. Idempotent.
 */

import { registerClaudeSdk } from '@helmsmith/agent-adapter/adapters/claude-sdk';
import { registerCopilotSdk } from '@helmsmith/agent-adapter/adapters/copilot-sdk';
import { registerOpenAiSdk } from '@helmsmith/agent-adapter/adapters/openai-sdk';
import { registerOpenCodeCli } from '@helmsmith/agent-adapter/adapters/opencode-cli';

export function registerBindingAdapters(): void {
  registerClaudeSdk();
  registerOpenAiSdk();
  registerCopilotSdk();
  registerOpenCodeCli();
}
