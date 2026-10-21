import chalk from 'chalk';
import type { Command } from 'commander';
import type { AiMode } from '../config/index.js';
import { ManifestManager } from '../config/index.js';

export function registerConfig(program: Command): void {
  program
    .command('config')
    .description('View or update settings')
    .option('--ai <mode>', 'Set AI mode: auto | suggest | manual')
    .option('--model <id>', 'Set the AI model id used for conflict resolution')
    .option('--show', 'Show current config')
    .action(async (opts: { ai?: string; model?: string; show?: boolean }) => {
      const manifest = new ManifestManager();
      if (opts.ai) {
        manifest.updateSettings({ ai_mode: opts.ai as AiMode });
        manifest.save();
        console.log(chalk.green(`✓ AI mode set to: ${opts.ai}`));
      }
      if (opts.model) {
        manifest.updateSettings({ ai_model: opts.model });
        manifest.save();
        console.log(chalk.green(`✓ AI model set to: ${opts.model}`));
      }
      if (opts.show || (!opts.ai && !opts.model)) {
        const { resolveGitHubToken } = await import('../auth/token-manager.js');
        const settings = manifest.data.settings;
        const hasToken = (await resolveGitHubToken()) !== null;
        console.log(chalk.bold('\n  Current Settings:'));
        console.log(chalk.dim(`    AI Mode:         ${settings.ai_mode}`));
        console.log(chalk.dim(`    AI Model:        ${settings.ai_model ?? 'gpt-4o (default)'}`));
        console.log(
          chalk.dim(
            `    GitHub Token:     ${hasToken ? chalk.green('✓ detected') : chalk.red('✗ not found')}`,
          ),
        );
        console.log(chalk.dim(`    Conflict Prefix:  ${settings.conflict_branch_prefix}`));
        console.log(chalk.dim(`    Manifest:         ${manifest.manifestPath}\n`));
      }
    });
}
