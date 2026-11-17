import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { confirm } from '@inquirer/prompts';
import chalk from 'chalk';
import { readAgentFile } from '../agent-files.js';
import { defaultStarterConfig } from '../config.js';
import { detectShell, installShellAliases } from '../shell-aliases.js';
import { upsertSection } from './_shared/agents-md.js';
import { output } from './_shared/output.js';
import { isUnder, realOfNearest } from './_shared/real-path.js';
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
 * Why `init` must not create or write `path`, or undefined when it may. The
 * file itself must be absent or a regular file (a symlink, dangling or not,
 * would be written through), and the nearest existing ancestor must resolve
 * inside `root`, the real working directory: a linked parent directory such as
 * `.claude -> ../elsewhere` would carry mkdir and the write out of the
 * repository. Links that stay inside the repository are fine.
 */
function unsafeTarget(path: string, root: string): string | undefined {
  let st: ReturnType<typeof lstatSync> | undefined;
  try {
    st = lstatSync(path);
  } catch {
    st = undefined;
  }
  if (st?.isSymbolicLink()) return 'it is a symlink; init does not write through links';
  if (st && !st.isFile()) return 'it is not a regular file';
  const real = realOfNearest(path);
  if (real === null) return 'a parent directory is a dangling symlink';
  if (!isUnder(real, root)) {
    return `it resolves outside the repository (${real}); init writes only inside ${root}`;
  }
  return undefined;
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
 * slash commands. Skips integration files outside a git repo. Every project
 * file goes through `unsafeTarget` first, so none is written outside the
 * working directory or through a link (the opt-in shell aliases edit an rc file).
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
  const root = realpathSync(cwd);

  const written: string[] = [];
  const skipped: string[] = [];
  const refuse = (path: string, why: string): void => {
    console.error(chalk.yellow(`! skipped ${path}: ${why}`));
    skipped.push(path);
  };
  /** Write `body` to `path` unless it is unsafe, or exists and --force is off. */
  const place = (path: string, body: string): void => {
    const unsafe = unsafeTarget(path, root);
    if (unsafe) {
      refuse(path, unsafe);
    } else if (existsSync(path) && !force) {
      say(chalk.dim(`· skipped ${path} (exists; --force to overwrite)`));
      skipped.push(path);
    } else {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, body);
      say(chalk.green(`✓ ${path}`));
      written.push(path);
    }
  };

  // 1. The config (always)
  for (const configPath of configTargets(cwd)) {
    place(configPath, `${JSON.stringify(defaultStarterConfig(), null, 2)}\n`);
  }

  // 2. Claude Code slash commands (in git repos only)
  if (includeClaude && inGitRepo) {
    for (const [name, body] of Object.entries(CLAUDE_COMMANDS)) {
      place(join(cwd, '.claude', 'commands', `${name}.md`), body);
    }
  }

  // 2.5. Standalone Claude Code skill (in git repos only).
  if (includeSkill && inGitRepo) {
    place(join(cwd, '.claude', 'skills', 'pritty', 'SKILL.md'), PRITTY_SKILL);
  }

  // 2.6. The committer subagent (in git repos only; kept when present).
  if (includeAgent && inGitRepo) {
    place(join(cwd, '.claude', 'agents', 'pritty.md'), readAgentFile('pritty.md'));
  }

  // 2.7. The AGENTS.md section (in git repos only; replaced on every run).
  if (includeAgentsMd && inGitRepo) {
    const agentsPath = join(cwd, 'AGENTS.md');
    const unsafe = unsafeTarget(agentsPath, root);
    if (unsafe) {
      refuse(agentsPath, unsafe);
    } else {
      const existing = existsSync(agentsPath) ? readFileSync(agentsPath, 'utf8') : undefined;
      const upserted = upsertSection(existing, readAgentFile('AGENTS.section.md'));
      if (upserted.ok) {
        writeFileSync(agentsPath, upserted.text);
        say(chalk.green(`✓ ${agentsPath}`));
        written.push(agentsPath);
      } else {
        refuse(agentsPath, `its pritty markers are broken (${upserted.problem}); fix them by hand`);
      }
    }
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
    for (const [name, body] of Object.entries(COPILOT_PROMPTS)) {
      place(join(cwd, '.github', 'prompts', `${name}.prompt.md`), body);
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
