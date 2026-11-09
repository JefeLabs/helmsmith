/**
 * Gittyup's `connect` command — manages GitHub connections.
 *
 * Gittyup uses octokit for PR work and supports both PAT (env var)
 * and OAuth (via gittyup auth login). The Connection here surfaces
 * GitHub auth state. Future iterations can add per-repo connections
 * if richer integrations land (Linear, Jira, etc.).
 */

import { runConnectView } from '@helmsmith/tui-view-components';
import type { Command } from 'commander';
import { githubConnection } from '../auth/github-connection.js';

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
