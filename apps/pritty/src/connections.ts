/**
 * Connection definitions for pritty's `connect` view.
 *
 * Pritty primarily uses GitHub Copilot for AI calls. This file
 * adapts pritty's auth.ts (which wraps `@jefelabs/agent-auth`'s
 * AuthStore + loginGitHubCopilot) to the `Connection` contract
 * consumed by tui-view-components.
 */

import type { Connection } from '@jefelabs/tui-view-components';
import { readAuth, login as runLogin, logout as runLogout } from './auth.js';

export const githubCopilotConnection: Connection = {
  id: 'github-copilot',
  displayName: 'GitHub Copilot',
  description: 'AI provider used by pritty for commit/PR generation.',

  async getStatus() {
    const auth = await readAuth();
    const entry = auth.providers['github-copilot'];
    if (!entry?.apiKey) return { state: 'disconnected' };
    if (entry.expiresAt) {
      const expiresMs = new Date(entry.expiresAt).getTime();
      if (!Number.isNaN(expiresMs) && expiresMs < Date.now()) {
        return { state: 'expired', message: 'token expired' };
      }
    }
    return {
      state: 'connected',
      identity: entry.scope ? `scope: ${entry.scope}` : undefined,
    };
  },

  async login(progress) {
    progress?.('Starting GitHub device flow…');
    const result = await runLogin({
      onPrompt: ({ verificationUri, userCode, expiresIn }) => {
        progress?.(
          `Visit ${verificationUri} and enter code ${userCode} (expires in ${Math.round(
            expiresIn / 60,
          )} min)`,
        );
      },
    });
    return {
      state: 'connected',
      identity: result.scope ? `scope: ${result.scope}` : undefined,
    };
  },

  async logout() {
    await runLogout();
  },
};
