import { spawnSync } from 'node:child_process';
import type { AuthFile } from '@helmsmith/agent-auth';

export interface ResolvedToken {
  token: string;
  /** Where it came from, for the one line pritty prints about identity. */
  source: string;
  /** Set when the source is known to be weak for the job. */
  warning?: string;
}

export interface TokenResolveOptions {
  env: Record<string, string | undefined>;
  /** `.pritty.json` → `github.account`: the `gh` login to use for this repository. */
  account?: string | undefined;
  exec: (cmd: string, args: string[]) => { status: number | null; stdout: string };
  readAuth: () => Promise<AuthFile>;
}

const GITHUB_LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

/**
 * The GitHub token for the REST API, most explicit first:
 *   1. GH_TOKEN, then GITHUB_TOKEN (the order `gh` itself uses)
 *   2. `gh auth token --user <github.account>` when the repository names an account
 *   3. `gh auth token` (the active gh login)
 *   4. the Copilot device-flow token from pritty's auth.json — last, because it
 *      is global across repositories and its read:user scope cannot open PRs
 * Returns null when none exists.
 */
export async function resolveGitHubToken(o: TokenResolveOptions): Promise<ResolvedToken | null> {
  for (const name of ['GH_TOKEN', 'GITHUB_TOKEN'] as const) {
    const v = o.env[name]?.trim();
    if (v) return { token: v, source: name };
  }
  if (o.account !== undefined) {
    if (!GITHUB_LOGIN.test(o.account)) {
      throw new Error(
        `.pritty.json github.account is not a GitHub login: ${JSON.stringify(o.account)}`,
      );
    }
    const r = o.exec('gh', ['auth', 'token', '--user', o.account]);
    const v = r.status === 0 ? r.stdout.trim() : '';
    if (v) return { token: v, source: `gh auth token --user ${o.account}` };
  }
  const active = o.exec('gh', ['auth', 'token']);
  const activeToken = active.status === 0 ? active.stdout.trim() : '';
  if (activeToken) return { token: activeToken, source: 'gh auth token' };
  const auth = await o.readAuth();
  const copilot = auth.providers['github-copilot']?.apiKey;
  if (copilot) {
    return {
      token: copilot,
      source: 'copilot',
      warning:
        'using the Copilot device-flow token: it is shared by every repository and its read:user scope may not be allowed to open pull requests. Set GH_TOKEN, log in with gh, or set github.account in .pritty.json.',
    };
  }
  return null;
}

/** Real process environment, `gh` on PATH, pritty's auth file. */
export function defaultTokenResolveOptions(
  readAuth: () => Promise<AuthFile>,
  account: string | undefined,
): TokenResolveOptions {
  return {
    env: process.env,
    account,
    exec: (cmd, args) => {
      const r = spawnSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      return { status: r.error ? 1 : r.status, stdout: r.stdout ?? '' };
    },
    readAuth,
  };
}
