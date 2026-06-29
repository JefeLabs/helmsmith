/**
 * Gittyup's `connect` command — manages GitHub connections.
 *
 * Gittyup uses octokit for PR work and supports both PAT (env var)
 * and OAuth (via gittyup auth login). The Connection here surfaces
 * GitHub auth state. Future iterations can add per-repo connections
 * if richer integrations land (Linear, Jira, etc.).
 */

import { type Connection, runConnectView } from '@helmsmith/tui-view-components';
import { Command } from 'commander';

const githubConnection: Connection = {
  id: 'github',
  displayName: 'GitHub',
  description: 'Used by gittyup for cherry-pick / merge / PR orchestration across repos.',

  async getStatus() {
    const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
    if (!token) {
      return {
        state: 'disconnected',
        message: 'set GITHUB_TOKEN or run `gittyup auth login`',
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

export function registerConnect(program: Command): void {
  program
    .command('connect')
    .description('Open the interactive connections view (TUI)')
    .action(async () => {
      await runConnectView({
        appName: 'gittyup',
        required: [githubConnection],
      });
    });
}
