import type { AIProviderName } from '../auth/index.js';
import {
  getProvider,
  readAuthFile,
  writeAuthFile,
  AI_PROVIDERS,
  resolveGitHubToken,
} from '../auth/index.js';

export interface AuthLoginOpts {
  provider?: string;
  force?: boolean;
}

export interface AuthLoginResult {
  providerName: AIProviderName;
  displayName: string;
}

export interface AuthStatusEntry {
  name: AIProviderName;
  isActive: boolean;
  authenticated: boolean;
  displayName: string;
  source: string;
}

export interface AuthStatusResult {
  activeProvider: string;
  entries: AuthStatusEntry[];
}

export interface AuthSwitchResult {
  providerName: AIProviderName;
}

export interface AuthLogoutResult {
  providerName: AIProviderName;
  envWarning?: string;
}

/**
 * Resolve which provider to use: from flag, or prompt interactively.
 */
export function resolveProviderName(provider?: string): AIProviderName | null {
  if (!provider) return null;
  if (!AI_PROVIDERS.includes(provider as AIProviderName)) {
    throw new Error(`Unknown provider "${provider}". Valid: ${AI_PROVIDERS.join(', ')}`);
  }
  return provider as AIProviderName;
}

/**
 * Execute auth login: authenticate with an AI provider.
 */
export async function executeAuthLogin(
  providerName: AIProviderName,
  opts: { force?: boolean } = {},
): Promise<AuthLoginResult> {
  const provider = getProvider(providerName);

  // Check if already authenticated (unless --force)
  if (!opts.force) {
    const existing = await provider.resolveAuth();
    if (existing && (existing.source.startsWith('auth.json') || existing.source.startsWith('env:'))) {
      throw new Error(
        `Already authenticated with ${providerName} (source: ${existing.source}). ` +
          `Use --force to re-authenticate.`,
      );
    }
  }

  const result = await provider.login({ force: opts.force });

  // Set as active provider
  const authFile = await readAuthFile();
  authFile.active_provider = providerName;
  await writeAuthFile(authFile);

  return { providerName, displayName: result.displayName };
}

/**
 * Execute auth status: check authentication status for all providers.
 */
export async function executeAuthStatus(): Promise<AuthStatusResult> {
  const authFile = await readAuthFile();
  const entries: AuthStatusEntry[] = [];

  for (const name of AI_PROVIDERS) {
    const provider = getProvider(name);
    const authResult = await provider.resolveAuth();
    const isActive = name === authFile.active_provider;

    if (authResult) {
      const displayName = name === 'copilot'
        ? authFile.copilot?.username ? `@${authFile.copilot.username}` : 'authenticated'
        : authFile[name]?.display_name ?? 'authenticated';
      entries.push({ name, isActive, authenticated: true, displayName, source: authResult.source });
    } else {
      entries.push({ name, isActive, authenticated: false, displayName: '', source: '' });
    }
  }

  return { activeProvider: authFile.active_provider, entries };
}

/**
 * Execute auth switch: change active provider without re-authenticating.
 */
export async function executeAuthSwitch(
  providerArg: string,
): Promise<AuthSwitchResult> {
  if (!AI_PROVIDERS.includes(providerArg as AIProviderName)) {
    throw new Error(`Unknown provider "${providerArg}". Valid: ${AI_PROVIDERS.join(', ')}`);
  }

  const providerName = providerArg as AIProviderName;
  const provider = getProvider(providerName);
  const authResult = await provider.resolveAuth();

  if (!authResult) {
    throw new Error(
      `Not authenticated with ${providerName}. Run "auth login --provider ${providerName}" first.`,
    );
  }

  const authFile = await readAuthFile();
  authFile.active_provider = providerName;
  await writeAuthFile(authFile);

  return { providerName };
}

/**
 * Execute auth logout: revoke stored credentials for a provider.
 */
export async function executeAuthLogout(
  opts: { provider?: string } = {},
): Promise<AuthLogoutResult> {
  const authFile = await readAuthFile();
  const providerName = (opts.provider ?? authFile.active_provider) as AIProviderName;

  if (!AI_PROVIDERS.includes(providerName)) {
    throw new Error(`Unknown provider "${providerName}". Valid: ${AI_PROVIDERS.join(', ')}`);
  }

  // Check for env-based Copilot tokens
  let envWarning: string | undefined;
  if (providerName === 'copilot') {
    const tokenSource = await resolveGitHubToken();
    if (tokenSource && tokenSource.source !== 'auth.json') {
      envWarning =
        `Token is provided via environment variable (${tokenSource.source}). ` +
        'Unset the variable to fully log out.';
    }
  }

  const provider = getProvider(providerName);
  await provider.logout();

  return { providerName, envWarning };
}
