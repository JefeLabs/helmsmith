/**
 * Connection definitions for the view: pritty's GitHub Copilot login, adapted from
 * @helmsmith/pritty's auth surface to the `Connection` contract of tui-view-components.
 */
import { readAuth, login as runLogin, logout as runLogout } from '@helmsmith/pritty';
import type { Connection } from '@helmsmith/tui-view-components';

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
