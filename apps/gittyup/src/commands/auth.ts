import chalk from 'chalk';
import type { Command } from 'commander';
import { APP_NAME } from '../config/index.js';
import { GittyupError } from '../core/errors.js';
import type { AuthModelsDocument, AuthStatusDocument } from '../output/contract.js';
import { emitJson } from '../output/json.js';
import { tokenRows } from './config.js';

export function registerAuth(program: Command): void {
  const authCmd = program.command('auth').description('GitHub / Copilot authentication');

  authCmd
    .command('login')
    .description('Authenticate with GitHub Copilot via OAuth device flow')
    .action(async () => {
      const { login } = await import('../auth/device-flow.js');
      try {
        const { username } = await login();
        console.log(chalk.green(`\n  ✓ Authenticated as ${chalk.bold(username)}`));
        console.log(chalk.dim('  Copilot token will be fetched on first AI call.\n'));
      } catch (err: any) {
        console.error(chalk.red(`  ✗ ${err.message}`));
        process.exit(1);
      }
    });

  authCmd
    .command('status')
    .description('Show authentication status and token source')
    .option('--json', 'Print { agent, github } token rows as one JSON line (sources, never tokens)')
    .action(async (opts: { json?: boolean }) => {
      if (opts.json) {
        const { resolveGitHubToken, getCopilotToken } = await import('../auth/token-manager.js');
        const { agent, github } = await tokenRows();
        let reachable: boolean | null = null;
        const source = await resolveGitHubToken();
        if (source) {
          reachable = await getCopilotToken(source.token, { fromEnv: source.source !== 'auth.json' })
            .then(() => true)
            .catch(() => false);
        }
        return emitJson({ agent: { ...agent, reachable }, github } satisfies AuthStatusDocument);
      }
      const { printAuthStatus } = await import('../auth/token-manager.js');
      console.log(chalk.bold('\n  Auth Status:\n'));
      await printAuthStatus();
      console.log();
    });

  authCmd
    .command('logout')
    .description('Remove stored credentials')
    .action(async () => {
      const { deleteAuthCredentials } = await import('../auth/token-manager.js');
      await deleteAuthCredentials();
      console.log(chalk.green('  ✓ Credentials removed'));
    });

  authCmd
    .command('models')
    .description('List available Copilot models')
    .option('--json', 'Print { models: [{ id, maxPromptTokens, maxOutputTokens }] } as one JSON line')
    .action(async (opts: { json?: boolean }) => {
      const { fetchCopilotModels, resolveGitHubToken } = await import('../auth/token-manager.js');
      if (opts.json && !(await resolveGitHubToken())) {
        throw new GittyupError(
          'AUTH_REQUIRED',
          `Could not fetch models. Run "${APP_NAME} auth login" first.`,
        );
      }
      const models = await fetchCopilotModels();
      if (opts.json) {
        if (!models) throw new GittyupError('GITHUB_FAILED', 'could not fetch Copilot models');
        return emitJson({
          models: models.map((m) => ({
            id: m.id,
            maxPromptTokens: m.capabilities?.limits?.max_prompt_tokens ?? null,
            maxOutputTokens: m.capabilities?.limits?.max_output_tokens ?? null,
          })),
        } satisfies AuthModelsDocument);
      }
      if (!models) {
        console.log(chalk.yellow(`  Could not fetch models. Run "${APP_NAME} auth login" first.`));
        return;
      }
      console.log(chalk.bold(`\n  Available Copilot Models (${models.length}):\n`));
      for (const m of models) {
        const limits = m.capabilities?.limits;
        const info = limits
          ? chalk.dim(
              ` (${limits.max_prompt_tokens ?? '?'}/${limits.max_output_tokens ?? '?'} tokens)`,
            )
          : '';
        console.log(`    ${chalk.white(m.id)}${info}`);
      }
      console.log();
    });
}
