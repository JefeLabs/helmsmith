import chalk from "chalk";
import { confirm } from "@inquirer/prompts";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defaultStarterConfig } from "../config.js";
import { detectShell, installShellAliases } from "../shell-aliases.js";
import {
  CLAUDE_COMMANDS,
  COPILOT_PROMPTS,
  PRITTY_SKILL,
} from "./_shared/templates.js";

export interface InitOptions {
  force?: boolean;
  claude?: boolean;
  copilot?: boolean;
  aliases?: boolean;
  skill?: boolean;
}

/**
 * Write a starter .pritty.json + Claude Code / VS Code Copilot
 * slash commands. Skips integration files outside a git repo.
 */
export async function runInit(options: InitOptions = {}): Promise<void> {
  const cwd = process.cwd();
  const force = options.force ?? false;
  const includeClaude = options.claude !== false;
  const includeCopilot = options.copilot !== false;
  const includeAliases = options.aliases !== false;
  const includeSkill = options.skill !== false;
  const inGitRepo = existsSync(join(cwd, ".git"));

  let written = 0;
  let skipped = 0;

  // 1. .pritty.json (always)
  const configPath = join(cwd, ".pritty.json");
  if (existsSync(configPath) && !force) {
    console.log(
      chalk.dim(`· skipped ${configPath} (exists; --force to overwrite)`),
    );
    skipped++;
  } else {
    writeFileSync(
      configPath,
      JSON.stringify(defaultStarterConfig(), null, 2) + "\n",
    );
    console.log(chalk.green(`✓ ${configPath}`));
    written++;
  }

  // 2. Claude Code slash commands (in git repos only)
  if (includeClaude && inGitRepo) {
    const claudeDir = join(cwd, ".claude", "commands");
    for (const [name, body] of Object.entries(CLAUDE_COMMANDS)) {
      const path = join(claudeDir, `${name}.md`);
      if (existsSync(path) && !force) {
        console.log(
          chalk.dim(`· skipped ${path} (exists; --force to overwrite)`),
        );
        skipped++;
        continue;
      }
      mkdirSync(claudeDir, { recursive: true });
      writeFileSync(path, body);
      console.log(chalk.green(`✓ ${path}`));
      written++;
    }
  }

  // 2.5. Standalone Claude Code skill (in git repos only).
  if (includeSkill && inGitRepo) {
    const skillDir = join(cwd, ".claude", "skills", "pritty");
    const skillPath = join(skillDir, "SKILL.md");
    if (existsSync(skillPath) && !force) {
      console.log(
        chalk.dim(`· skipped ${skillPath} (exists; --force to overwrite)`),
      );
      skipped++;
    } else {
      mkdirSync(skillDir, { recursive: true });
      writeFileSync(skillPath, PRITTY_SKILL);
      console.log(chalk.green(`✓ ${skillPath}`));
      written++;
    }
  }

  // 3. VS Code Copilot Chat prompts (in git repos only)
  if (includeCopilot && inGitRepo) {
    const promptDir = join(cwd, ".github", "prompts");
    for (const [name, body] of Object.entries(COPILOT_PROMPTS)) {
      const path = join(promptDir, `${name}.prompt.md`);
      if (existsSync(path) && !force) {
        console.log(
          chalk.dim(`· skipped ${path} (exists; --force to overwrite)`),
        );
        skipped++;
        continue;
      }
      mkdirSync(promptDir, { recursive: true });
      writeFileSync(path, body);
      console.log(chalk.green(`✓ ${path}`));
      written++;
    }
  }

  // 4. Optional shell aliases — interactive opt-in (default N).
  if (includeAliases) {
    const shell = detectShell();
    if (shell) {
      const wantAliases = await confirm({
        message: `Add shell aliases (${chalk.bold("commit")} → ${chalk.bold("pritty commit")}, ${chalk.bold("pr")} → ${chalk.bold("pritty pr")}) to ~/.${shell === "fish" ? "config/fish/config.fish" : `${shell}rc`}?`,
        default: false,
      });
      if (wantAliases) {
        try {
          const result = installShellAliases(shell);
          console.log(
            chalk.green(
              `✓ ${result.replaced ? "Updated" : "Added"} shell aliases in ${result.rcPath}`,
            ),
          );
          console.log(
            chalk.dim(
              `  Run \`source ${result.rcPath}\` or open a new terminal to use them.`,
            ),
          );
          written++;
        } catch (err) {
          console.error(chalk.red(`✗ ${(err as Error).message}`));
        }
      }
    } else {
      console.log(
        chalk.dim(
          `\nUnrecognized shell ($SHELL=${process.env.SHELL ?? "(unset)"}); skipping alias prompt. Add manually: \`alias commit="pritty commit"\` \`alias pr="pritty pr"\``,
        ),
      );
    }
  }

  // 5. Summary
  if (!inGitRepo && (includeClaude || includeCopilot)) {
    console.log(
      chalk.dim(
        `\nNot a git repository (no .git/ found) — skipped Claude Code & Copilot integration files.`,
      ),
    );
  }
  console.log("");
  console.log(
    chalk.cyan(
      `${written} written, ${skipped} skipped${force ? " (force overwrites enabled)" : ""}`,
    ),
  );
  if (inGitRepo && (includeClaude || includeCopilot)) {
    console.log("");
    console.log(chalk.dim("Try it:"));
    if (includeClaude) console.log(chalk.dim("  Claude Code:  /commit  /pr"));
    if (includeCopilot) console.log(chalk.dim("  VS Code Chat: /commit  /pr"));
  }
}
