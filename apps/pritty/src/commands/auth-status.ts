import chalk from 'chalk';
import { readAuth } from '../auth.js';
import { output } from './_shared/output.js';

/**
 * `--json`: one line { providers: [{ id, scope, createdAt, expiresAt }] }.
 * Fields are picked one by one so a stored token can never reach the output.
 */
export async function runAuthStatus(options: { json?: boolean } = {}): Promise<void> {
  const { say, result } = output(options.json);
  const file = await readAuth();
  const providers = Object.entries(file.providers).map(([id, entry]) => ({
    id,
    scope: entry.scope ?? null,
    createdAt: entry.createdAt ?? null,
    expiresAt: entry.expiresAt ?? null,
  }));
  if (providers.length === 0) {
    say(chalk.dim('Not logged in. Run `pritty auth login`.'));
  } else {
    say(chalk.cyan(`Authenticated providers (${providers.length})`));
    for (const p of providers) {
      say(`  ${chalk.bold(p.id)}`);
      say(chalk.dim(`    scope:    ${p.scope ?? '(default)'}`));
      say(chalk.dim(`    created:  ${p.createdAt ?? '?'}`));
      if (p.expiresAt) say(chalk.dim(`    expires:  ${p.expiresAt}`));
    }
  }
  result({ providers });
}
