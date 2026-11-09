/**
 * The GitHub row in `gittyup connect`. Kept out of commands/connect.ts so it
 * can be tested without loading the TUI stack (only the `Connection` type
 * comes from @helmsmith/tui-view-components).
 */
import type { Connection } from '@helmsmith/tui-view-components';
import { requireGitHubToken } from './token-manager.js';

export const githubConnection: Connection = {
  id: 'github',
  displayName: 'GitHub',
  description: 'Used by gittyup for cherry-pick / merge / PR orchestration across repos.',

  // The same lookup gittyup's GitHub calls use (env → `auth login` →
  // `gh auth token` → git credential), so this row can't disagree with them.
  async getStatus() {
    let token: string;
    try {
      ({ token } = await requireGitHubToken());
    } catch {
      return {
        state: 'disconnected',
        message: 'run `gittyup auth login` or `gh auth login`, or set GITHUB_TOKEN',
      };
    }
    return {
      state: 'connected',
      identity: `${token.slice(0, 4)}…${token.slice(-4)}`,
    };
  },

  async login() {
    throw new Error('Run `gittyup auth login` for OAuth, or set GITHUB_TOKEN in your environment.');
  },

  async logout() {
    throw new Error('Run `gittyup auth logout` instead.');
  },
};
