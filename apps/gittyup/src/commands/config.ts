import chalk from 'chalk';
import type { Command } from 'commander';
import type { AiMode } from '../config/index.js';
import { AiModeSchema, ManifestManager } from '../config/index.js';
import { GittyupError } from '../core/errors.js';
import type { ConfigDocument, TokenRow } from '../output/contract.js';
import { emitJson } from '../output/json.js';

const DEFAULT_AI_MODEL = 'gpt-4o';

/**
 * The two token lookups a caller cares about (spec §4 "auth status"): `agent` is
 * what the AI resolver uses (env, auth.json); `github` is what GitHub API calls
 * use (adds `gh auth token` and git credential). Sources only, never tokens.
 */
export async function tokenRows(): Promise<{ agent: TokenRow; github: TokenRow }> {
  const { resolveGitHubToken, requireGitHubToken } = await import('../auth/token-manager.js');
  const agentSource = await resolveGitHubToken();
  let github: TokenRow = { available: false, source: null };
  try {
    github = { available: true, source: (await requireGitHubToken()).source };
  } catch (err) {
    if (!(err instanceof GittyupError && err.code === 'AUTH_REQUIRED')) throw err;
  }
  return {
    agent: { available: agentSource !== null, source: agentSource?.source ?? null },
    github,
  };
}

export function registerConfig(program: Command): void {
  program
    .command('config')
    .description('View or update settings')
    .option('--ai <mode>', 'Set AI mode: auto | suggest | manual')
    .option('--model <id>', 'Set the AI model id used for conflict resolution')
    .option('--show', 'Show current config')
    .option('--json', 'Print { manifest, settings, agent, github } as one JSON line')
    .action(async (opts: { ai?: string; model?: string; show?: boolean; json?: boolean }) => {
      const manifest = new ManifestManager();
      if (opts.json && opts.ai && !AiModeSchema.safeParse(opts.ai).success) {
        throw new GittyupError('USAGE', `--ai must be one of auto, suggest, manual (got "${opts.ai}")`, {
          ai: opts.ai,
        });
      }
      if (opts.ai) {
        manifest.updateSettings({ ai_mode: opts.ai as AiMode });
        manifest.save();
        if (!opts.json) console.log(chalk.green(`✓ AI mode set to: ${opts.ai}`));
      }
      if (opts.model) {
        manifest.updateSettings({ ai_model: opts.model });
        manifest.save();
        if (!opts.json) console.log(chalk.green(`✓ AI model set to: ${opts.model}`));
      }
      if (opts.json) {
        const settings = manifest.data.settings;
        return emitJson({
          manifest: { path: manifest.manifestPath, location: manifest.configLocation },
          settings: {
            aiMode: settings.ai_mode,
            aiModel: settings.ai_model ?? DEFAULT_AI_MODEL,
            aiModelIsDefault: settings.ai_model === undefined,
            conflictBranchPrefix: settings.conflict_branch_prefix,
          },
          ...(await tokenRows()),
        } satisfies ConfigDocument);
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
