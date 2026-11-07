import chalk from 'chalk';
import { login as authLogin, getAuthPath } from '../auth.js';
import { consoleIo, type Io, output } from './_shared/output.js';

export interface AuthLoginOptions {
  /** One JSON line { provider, scope, path } on stdout; the device-flow prompt goes to stderr. */
  json?: boolean;
}

export interface AuthLoginDeps {
  login: (o: {
    onPrompt: (info: { verificationUri: string; userCode: string; expiresIn: number }) => void;
  }) => Promise<{ provider: string; scope?: string }>;
  authPath: () => string;
  io?: Io;
}

export async function runAuthLogin(
  options: AuthLoginOptions = {},
  deps: AuthLoginDeps = { login: authLogin, authPath: getAuthPath },
): Promise<void> {
  const io = deps.io ?? consoleIo;
  const { say, result } = output(options.json, io);
  try {
    const r = await deps.login({
      onPrompt: ({ verificationUri, userCode }) => {
        say('');
        say(chalk.cyan('Open this URL in a browser:'));
        say(`  ${chalk.bold(verificationUri)}`);
        say('');
        say(chalk.cyan('Enter this code:'));
        say(`  ${chalk.bold.yellow(userCode)}`);
        say('');
        say(chalk.dim('Waiting for authorization...'));
      },
    });
    const path = deps.authPath();
    say(chalk.green(`✓ Logged in (provider: ${r.provider})`));
    say(chalk.dim(`  scope:  ${r.scope ?? '(default)'}`));
    say(chalk.dim(`  stored: ${path}`));
    result({ provider: r.provider, scope: r.scope ?? null, path });
  } catch (err) {
    io.err(chalk.red(`✗ Login failed: ${(err as Error).message}`));
    process.exit(1);
  }
}
