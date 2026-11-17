import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { confirm } from '@inquirer/prompts';
import chalk from 'chalk';
import { readAgentFile } from '../agent-files.js';
import { defaultStarterConfig } from '../config.js';
import { detectShell, installShellAliases } from '../shell-aliases.js';
import { upsertSection } from './_shared/agents-md.js';
import { output } from './_shared/output.js';
import { CLAUDE_COMMANDS, COPILOT_PROMPTS, PRITTY_SKILL } from './_shared/templates.js';

export interface InitOptions {
  force?: boolean;
  claude?: boolean;
  copilot?: boolean;
  aliases?: boolean;
  skill?: boolean;
  /** The `.claude/agents/pritty.md` committer subagent (default true). */
  agent?: boolean;
  /** The managed section in `AGENTS.md` (default true). */
  agentsMd?: boolean;
  /**
   * One JSON line { written, skipped, gitRepo } (absolute paths); implies
   * --no-aliases, since an unattended run should not edit a shell rc file.
   */
  json?: boolean;
}

/**
 * Where `init` writes the config: over the files already there (both, while
 * a repository keeps the old name for older pritty), else in `.helmsmith/`
 * when the repository keeps its helmsmith files there, else `.pritty.json`.
 * Never a second file beside an existing one: two configs that differ make
 * `loadConfig` refuse.
 */
function configTargets(cwd: string): string[] {
  const helmsmith = join(cwd, '.helmsmith', 'pritty.json');
  const legacy = join(cwd, '.pritty.json');
  const existing = [helmsmith, legacy].filter((p) => existsSync(p));
  if (existing.length > 0) return existing;
  return [existsSync(join(cwd, '.helmsmith')) ? helmsmith : legacy];
}

/**
 * Write a starter config (`.helmsmith/pritty.json` in a repository with a
 * `.helmsmith` folder, else `.pritty.json`) + Claude Code / VS Code Copilot
 * slash commands. Skips integration files outside a git repo.
 */
export async function runInit(options: InitOptions = {}): Promise<void> {
  const { say, result } = output(options.json);
  const cwd = process.cwd();
  const force = options.force ?? false;
  const includeClaude = options.claude !== false;
  const includeCopilot = options.copilot !== false;
  const includeAliases = options.aliases !== false && !options.json;
  const includeSkill = options.skill !== false;
  const includeAgent = options.agent !== false;
  const includeAgentsMd = options.agentsMd !== false;
  const inGitRepo = existsSync(join(cwd, '.git'));

  const written: string[] = [];
  const skipped: string[] = [];

  // 1. The config (always)
  for (const configPath of configTargets(cwd)) {
    if (existsSync(configPath) && !force) {
      say(chalk.dim(`· skipped ${configPath} (exists; --force to overwrite)`));
      skipped.push(configPath);
      continue;
    }
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, `${JSON.stringify(defaultStarterConfig(), null, 2)}\n`);
    say(chalk.green(`✓ ${configPath}`));
    written.push(configPath);
  }

  // 2. Claude Code slash commands (in git repos only)
  if (includeClaude && inGitRepo) {
    const claudeDir = join(cwd, '.claude', 'commands');
    for (const [name, body] of Object.entries(CLAUDE_COMMANDS)) {
      const path = join(claudeDir, `${name}.md`);
      if (existsSync(path) && !force) {
        say(chalk.dim(`· skipped ${path} (exists; --force to overwrite)`));
        skipped.push(path);
        continue;
      }
      mkdirSync(claudeDir, { recursive: true });
      writeFileSync(path, body);
      say(chalk.green(`✓ ${path}`));
      written.push(path);
    }
  }

  // 2.5. Standalone Claude Code skill (in git repos only).
  if (includeSkill && inGitRepo) {
    const skillDir = join(cwd, '.claude', 'skills', 'pritty');
    const skillPath = join(skillDir, 'SKILL.md');
    if (existsSync(skillPath) && !force) {
      say(chalk.dim(`· skipped ${skillPath} (exists; --force to overwrite)`));
      skipped.push(skillPath);
    } else {
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(skillPath, PRITTY_SKILL);
      say(chalk.green(`✓ ${skillPath}`));
      written.push(skillPath);
    }
  }

  // 2.6. The committer subagent (in git repos only; kept when present).
  if (includeAgent && inGitRepo) {
    const agentPath = join(cwd, '.claude', 'agents', 'pritty.md');
    if (existsSync(agentPath) && !force) {
      say(chalk.dim(`· skipped ${agentPath} (exists; --force to overwrite)`));
      skipped.push(agentPath);
    } else {
      mkdirSync(dirname(agentPath), { recursive: true });
      writeFileSync(agentPath, readAgentFile('pritty.md'));
      say(chalk.green(`✓ ${agentPath}`));
      written.push(agentPath);
    }
  }

  // 2.7. The AGENTS.md section (in git repos only; replaced on every run).
  if (includeAgentsMd && inGitRepo) {
    const agentsPath = join(cwd, 'AGENTS.md');
    const existing = existsSync(agentsPath) ? readFileSync(agentsPath, 'utf8') : undefined;
    writeFileSync(agentsPath, upsertSection(existing, readAgentFile('AGENTS.section.md')));
    say(chalk.green(`✓ ${agentsPath}`));
    written.push(agentsPath);
    if (existsSync(join(cwd, 'CLAUDE.md'))) {
      say(
        chalk.dim(
          '  CLAUDE.md is untouched. To have Claude Code read AGENTS.md, add a line `@AGENTS.md` to CLAUDE.md.',
        ),
      );
    }
  }

  // 3. VS Code Copilot Chat prompts (in git repos only)
  if (includeCopilot && inGitRepo) {
    const promptDir = join(cwd, '.github', 'prompts');
    for (const [name, body] of Object.entries(COPILOT_PROMPTS)) {
      const path = join(promptDir, `${name}.prompt.md`);
      if (existsSync(path) && !force) {
        say(chalk.dim(`· skipped ${path} (exists; --force to overwrite)`));
        skipped.push(path);
        continue;
      }
      mkdirSync(promptDir, { recursive: true });
      writeFileSync(path, body);
      say(chalk.green(`✓ ${path}`));
      written.push(path);
    }
  }

  // 4. Optional shell aliases — interactive opt-in (default N).
  if (includeAliases) {
    const shell = detectShell();
    if (shell) {
      const wantAliases = await confirm({
        message: `Add shell aliases (${chalk.bold('commit')} → ${chalk.bold('pritty commit')}, ${chalk.bold('pr')} → ${chalk.bold('pritty pr')}) to ~/.${shell === 'fish' ? 'config/fish/config.fish' : `${shell}rc`}?`,
        default: false,
      });
      if (wantAliases) {
        try {
          const installed = installShellAliases(shell);
          say(
            chalk.green(
              `✓ ${installed.replaced ? 'Updated' : 'Added'} shell aliases in ${installed.rcPath}`,
            ),
          );
          say(
            chalk.dim(`  Run \`source ${installed.rcPath}\` or open a new terminal to use them.`),
          );
          written.push(installed.rcPath);
        } catch (err) {
          console.error(chalk.red(`✗ ${(err as Error).message}`));
        }
      }
    } else {
      say(
        chalk.dim(
          `\nUnrecognized shell ($SHELL=${process.env.SHELL ?? '(unset)'}); skipping alias prompt. Add manually: \`alias commit="pritty commit"\` \`alias pr="pritty pr"\``,
        ),
      );
    }
  }

  // 5. Summary
  if (!inGitRepo && (includeClaude || includeCopilot || includeAgent || includeAgentsMd)) {
    say(
      chalk.dim(
        `\nNot a git repository (no .git/ found) — skipped Claude Code & Copilot integration files.`,
      ),
    );
  }
  say('');
  say(
    chalk.cyan(
      `${written.length} written, ${skipped.length} skipped${force ? ' (force overwrites enabled)' : ''}`,
    ),
  );
  if (inGitRepo && (includeClaude || includeCopilot)) {
    say('');
    say(chalk.dim('Try it:'));
    if (includeClaude) say(chalk.dim('  Claude Code:  /commit  /pr'));
    if (includeCopilot) say(chalk.dim('  VS Code Chat: /commit  /pr'));
  }
  result({ written, skipped, gitRepo: inGitRepo });
}
