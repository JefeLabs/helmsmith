/**
 * bindingToSpec — convert a `ResolvedBinding` (from agent-auth's
 * BindingResolver) into an `AgentSpec` for `@helmsmith/agent-adapter`'s
 * `createAgent`.
 *
 * This is the binding-aware replacement for the lib's removed
 * `bindingToAdapter`. Where the old helper returned a constructed adapter, the
 * new surface separates spec-construction (here) from adapter-construction
 * (`createAgent({ spec, workdir, credentialBroker })`). The dispatch table is
 * ported verbatim from the old `bindingToAdapter`:
 *
 *   direct anthropic   → claude-sdk
 *   openai             → openai-sdk
 *   github-copilot     → copilot-sdk
 *   google             → opencode-cli (no direct Gemini routing in the catalog)
 *   local-*            → opencode-cli with a configured endpoint
 *   bedrock            → throws (binding carries no AWS region; the catalog
 *                        gap is unchanged from the old helper)
 *
 * Endpoint URLs for local providers come from the caller via
 * `options.localEndpoint`; the resolver itself is endpoint-agnostic.
 */

import type { AgentSpec, OpenCodeCliSpec } from '@helmsmith/agent-adapter';
import type { ResolvedBinding, ToolId } from '@helmsmith/agent-auth';

export interface BindingToSpecOptions {
  /**
   * Endpoint resolver for local providers. Receives the provider id (e.g.
   * 'local-qwen') and returns the HTTP endpoint URL for that local model
   * server, or undefined if not configured. Defaults to
   * `defaultLocalEndpointResolver`, which reads from env vars.
   */
  localEndpoint?: (providerId: string) => string | undefined;
  /**
   * URL of a long-running `opencode serve` instance to attach to. When set,
   * any binding that resolves to opencode-cli passes `serverUrl` through to
   * the spec so invocations use `opencode run --attach <url>`.
   */
  opencodeServerUrl?: string;
}

/**
 * Default endpoint resolver. Reads from process.env per provider id. Returns
 * undefined when nothing is configured — `bindingToSpec` then throws with an
 * actionable error.
 */
export function defaultLocalEndpointResolver(providerId: string): string | undefined {
  if (providerId === 'local-qwen') {
    return process.env.AGENTX_LOCAL_QWEN_ENDPOINT;
  }
  return undefined;
}

/**
 * True iff this binding resolves to an opencode-cli spec — i.e., it requires a
 * running `opencode serve` to share. Used by harness-pipeline at boot time for
 * lazy resource acquisition: pure-anthropic pipelines skip the opencode-server
 * spawn entirely. Keep in sync with `bindingToSpec`'s dispatch.
 */
export function bindingNeedsOpenCode(binding: ResolvedBinding): boolean {
  if (binding.tool !== undefined) {
    return binding.tool === 'opencode-cli';
  }
  if (binding.kind === 'local') return true;
  // Cloud defaults: only google routes to opencode-cli among cloud providers.
  return binding.provider.id === 'google';
}

/**
 * Map a `ResolvedBinding` to the concrete `AgentSpec` `createAgent` consumes.
 */
export function bindingToSpec(
  binding: ResolvedBinding,
  options: BindingToSpecOptions = {},
): AgentSpec {
  if (binding.tool !== undefined) {
    return dispatchByTool(binding.tool, binding, options);
  }
  return dispatchByProviderDefault(binding, options);
}

function modelIdOf(binding: ResolvedBinding): string {
  return binding.model.vendorModelId ?? binding.model.id;
}

function localOpenCodeSpec(
  binding: ResolvedBinding,
  options: BindingToSpecOptions,
): OpenCodeCliSpec {
  const providerId = binding.provider.id;
  const resolve = options.localEndpoint ?? defaultLocalEndpointResolver;
  const endpoint = resolve(providerId);
  if (!endpoint) {
    throw new Error(
      `bindingToSpec: no endpoint configured for local provider "${providerId}". ` +
        `Set AGENTX_LOCAL_QWEN_ENDPOINT or pass options.localEndpoint.`,
    );
  }
  const localModelId = modelIdOf(binding);
  return {
    type: 'opencode-cli',
    endpoint,
    endpointProviderId: providerId,
    model: `${providerId}/${localModelId}`,
    ...(options.opencodeServerUrl ? { serverUrl: options.opencodeServerUrl } : {}),
  };
}

function cloudOpenCodeSpec(
  binding: ResolvedBinding,
  options: BindingToSpecOptions,
): OpenCodeCliSpec {
  const providerId = binding.provider.id;
  return {
    type: 'opencode-cli',
    provider: providerId,
    model: `${providerId}/${modelIdOf(binding)}`,
    ...(options.opencodeServerUrl ? { serverUrl: options.opencodeServerUrl } : {}),
  };
}

/**
 * Dispatch when the binding spec named a tool explicitly (3-part form).
 * Validates the (tool, provider) combination — not every tool adapts every
 * provider.
 */
function dispatchByTool(
  tool: ToolId,
  binding: ResolvedBinding,
  options: BindingToSpecOptions,
): AgentSpec {
  const providerId = binding.provider.id;
  const modelId = modelIdOf(binding);

  switch (tool) {
    case 'claude-sdk':
      if (providerId !== 'anthropic') {
        throw new Error(
          `bindingToSpec: tool=claude-sdk requires provider=anthropic, got ${providerId}`,
        );
      }
      return { type: 'claude-sdk', model: modelId };

    case 'openai-api':
      if (providerId !== 'openai') {
        throw new Error(
          `bindingToSpec: tool=openai-api requires provider=openai, got ${providerId}`,
        );
      }
      return { type: 'openai-sdk', model: modelId };

    case 'copilot-api':
      if (providerId !== 'github-copilot') {
        throw new Error(
          `bindingToSpec: tool=copilot-api requires provider=github-copilot, got ${providerId}`,
        );
      }
      return { type: 'copilot-sdk', model: modelId };

    case 'opencode-cli':
      if (providerId === 'github-copilot' || providerId === 'bedrock') {
        throw new Error(
          `bindingToSpec: tool=opencode-cli does not support provider=${providerId} ` +
            `(opencode 1.4 has no native ${providerId} routing). ` +
            `Use the provider's dedicated tool instead.`,
        );
      }
      return binding.kind === 'local'
        ? localOpenCodeSpec(binding, options)
        : cloudOpenCodeSpec(binding, options);

    default: {
      const _exhaustive: never = tool;
      throw new Error(`bindingToSpec: unhandled tool "${String(_exhaustive)}"`);
    }
  }
}

/**
 * Dispatch when the binding spec didn't name a tool (2-part shorthand). Picks
 * the default tool for each provider — same routing the old helper did.
 */
function dispatchByProviderDefault(
  binding: ResolvedBinding,
  options: BindingToSpecOptions,
): AgentSpec {
  if (binding.kind === 'local') {
    return localOpenCodeSpec(binding, options);
  }

  const providerId = binding.provider.id;
  const modelId = modelIdOf(binding);

  if (providerId === 'anthropic') {
    return { type: 'claude-sdk', model: modelId };
  }
  if (providerId === 'openai') {
    return { type: 'openai-sdk', model: modelId };
  }
  if (providerId === 'github-copilot') {
    return { type: 'copilot-sdk', model: modelId };
  }
  if (providerId === 'google') {
    return cloudOpenCodeSpec(binding, options);
  }
  if (providerId === 'bedrock') {
    throw new Error(
      `bindingToSpec: bedrock bindings carry no AWS region — construct a ` +
        `{ type: 'bedrock-sdk', model, region } spec directly, or remove ` +
        `bedrock:* entries from this agent's accepts list.`,
    );
  }
  throw new Error(`bindingToSpec: unhandled provider id "${providerId}"`);
}
