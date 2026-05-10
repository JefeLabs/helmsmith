/**
 * Gitradar's `connect` command.
 *
 * Gitradar uses octokit with a GitHub PAT for enrichment (PR review
 * counts, contributor metadata). The PAT is read from the `GITHUB_TOKEN`
 * (or `GH_TOKEN`) env var; there's no persisted local credential.
 *
 * The Connection here just reports whether the env var is set. A
 * future iteration could prompt for the PAT and write it to a local
 * file, but for now env-var-only matches gitradar's existing flow.
 */

import { type Connection, runConnectView } from '@ecruz165/tui-view-components';

const githubPatConnection: Connection = {
  id: 'github-pat',
  displayName: 'GitHub PAT',
  description:
    'Personal access token for octokit enrichment. Reads from GITHUB_TOKEN or GH_TOKEN env vars.',

  async getStatus() {
    const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
    if (!token) return { state: 'disconnected' };
    return {
      state: 'connected',
      identity: `${token.slice(0, 4)}…${token.slice(-4)}`,
    };
  },

  async login() {
    throw new Error(
      'Set GITHUB_TOKEN or GH_TOKEN in your environment, then re-run gitradar connect.',
    );
  },

  async logout() {
    throw new Error(
      'GitHub PAT is sourced from env vars — unset GITHUB_TOKEN / GH_TOKEN to logout.',
    );
  },
};

export async function runConnect(): Promise<void> {
  await runConnectView({
    appName: 'gitradar',
    optional: [githubPatConnection],
  });
}
