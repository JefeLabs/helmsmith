import { confirm, editor, select } from '@inquirer/prompts';
import chalk from 'chalk';
import { APP_NAME } from '../config/branding.js';
import type { AiMode, ConflictFile, ConflictSession, RepoConfig } from '../config/schema.js';
import { GitOperations } from './git-operations.js';

/** Callbacks for pluggable AI resolution and progress reporting. */
export interface ResolutionCallbacks {
  onAiResolve?: (file: ConflictFile, mode: 'auto' | 'suggest') => Promise<string | null>;
  onFileResolved?: (repoName: string, filePath: string) => void;
  onSessionComplete?: (session: ConflictSession) => void;
}

/**
 * Interactive conflict resolution session.
 * Walks through each conflicted file and offers resolution strategies
 * including AI-assisted merge, ours/theirs, manual edit, and escalation.
 */
export class ConflictResolver {
  private git: GitOperations;
  private repo: RepoConfig;
  private aiMode: AiMode;
  private callbacks: ResolutionCallbacks;

  constructor(
    git: GitOperations,
    repo: RepoConfig,
    aiMode: AiMode,
    callbacks: ResolutionCallbacks = {},
  ) {
    this.git = git;
    this.repo = repo;
    this.aiMode = aiMode;
    this.callbacks = callbacks;
  }

  /** Start the interactive resolution session. */
  async startSession(
    operation: 'merge' | 'cherry-pick',
    sourceBranch: string,
    targetBranch: string,
  ): Promise<ConflictSession> {
    const files = await this.git.getConflictedFiles();
    const session: ConflictSession = {
      repo: this.repo,
      operation,
      sourceBranch,
      targetBranch,
      conflictBranch: '',
      files,
      resolvedFiles: [],
      status: 'in-progress',
    };

    console.log(chalk.yellow('\n╔══════════════════════════════════════════════════════════════╗'));
    console.log(chalk.yellow('║  CONFLICT RESOLUTION SESSION                                ║'));
    console.log(chalk.yellow('╚══════════════════════════════════════════════════════════════╝'));
    console.log(chalk.dim(`  Repo:      ${this.repo.name}`));
    console.log(chalk.dim(`  Operation: ${operation} ${sourceBranch} → ${targetBranch}`));
    console.log(chalk.dim(`  Files:     ${files.length} conflicted`));
    console.log(chalk.dim(`  AI Mode:   ${this.aiMode}\n`));

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      console.log(chalk.cyan(`─── File ${i + 1}/${files.length}: ${file.path} ───`));

      const resolved = await this.resolveFile(file);
      if (resolved) {
        session.resolvedFiles.push(file.path);
        this.callbacks.onFileResolved?.(this.repo.name, file.path);
        console.log(chalk.green(`  ✓ Resolved: ${file.path}`));
      } else {
        console.log(chalk.red(`  ✗ Skipped: ${file.path}`));
      }
      console.log();
    }

    if (session.resolvedFiles.length === files.length) {
      session.status = 'resolved';
      console.log(chalk.green.bold('All conflicts resolved!'));

      const shouldCommit = await confirm({ message: 'Commit the resolution?', default: true });
      if (shouldCommit) {
        const hash = await this.git.commitResolution(
          `resolve: ${operation} ${sourceBranch} → ${targetBranch} via ${APP_NAME}`,
        );
        console.log(chalk.green(`  Committed: ${hash}`));
      }
    } else {
      const unresolved = files.length - session.resolvedFiles.length;
      console.log(chalk.yellow(`${unresolved} file(s) still unresolved.`));

      const action = await select({
        message: 'How would you like to proceed?',
        choices: [
          { name: 'Continue resolving remaining files', value: 'retry' as const },
          { name: 'Abort and rollback', value: 'abort' as const },
          { name: 'Leave as-is (partial resolution)', value: 'leave' as const },
          { name: 'Escalate: create conflict branch for later', value: 'escalate' as const },
        ],
      });

      switch (action) {
        case 'retry':
          return this.startSession(operation, sourceBranch, targetBranch);
        case 'abort':
          if (operation === 'merge') await this.git.abortMerge();
          else await this.git.cherryPickAbort();
          session.status = 'pending';
          break;
        case 'escalate': {
          const branchName = await this.git.createConflictBranch(
            'conflict-resolution',
            `${this.repo.name}-${targetBranch}`,
          );
          session.conflictBranch = branchName;
          session.status = 'escalated';
          console.log(chalk.yellow(`  Escalated to branch: ${branchName}`));
          break;
        }
        default:
          session.status = 'in-progress';
      }
    }

    this.callbacks.onSessionComplete?.(session);
    return session;
  }

  // ─── Individual File Resolution ───────────────────────────────────

  private async resolveFile(file: ConflictFile): Promise<boolean> {
    this.showConflictPreview(file);
    const choices = this.buildResolutionChoices();

    const action = await select({ message: `How to resolve ${chalk.bold(file.path)}?`, choices });

    switch (action) {
      case 'ours':
        await this.git.resolveUseOurs(file.path);
        return true;
      case 'theirs':
        await this.git.resolveUseTheirs(file.path);
        return true;
      case 'ai-auto': {
        const resolved = await this.callbacks.onAiResolve?.(file, 'auto');
        if (resolved) {
          await this.git.resolveFile(file.path, resolved);
          return true;
        }
        console.log(chalk.yellow('  AI could not auto-resolve. Falling back to manual.'));
        return this.resolveFile(file);
      }
      case 'ai-suggest': {
        const suggestion = await this.callbacks.onAiResolve?.(file, 'suggest');
        if (suggestion) {
          console.log(chalk.dim('\n── AI Suggested Resolution ──'));
          console.log(suggestion);
          console.log(chalk.dim('── End Suggestion ──\n'));

          const accept = await select({
            message: 'Accept this suggestion?',
            choices: [
              { name: 'Accept as-is', value: 'accept' as const },
              { name: 'Accept and edit', value: 'edit' as const },
              { name: 'Reject, resolve manually', value: 'reject' as const },
            ],
          });
          if (accept === 'accept') {
            await this.git.resolveFile(file.path, suggestion);
            return true;
          }
          if (accept === 'edit') return this.manualEdit(file, suggestion);
          return this.resolveFile(file);
        }
        console.log(chalk.yellow('  AI did not return a suggestion.'));
        return this.resolveFile(file);
      }
      case 'manual':
        return this.manualEdit(file);
      case 'skip':
        return false;
      case 'view-full':
        this.showFullConflict(file);
        return this.resolveFile(file);
      default:
        return false;
    }
  }

  // ─── UI Helpers ───────────────────────────────────────────────────

  private showConflictPreview(file: ConflictFile): void {
    const maxLines = 8;
    const oursLines = file.oursContent.split('\n').slice(0, maxLines);
    const theirsLines = file.theirsContent.split('\n').slice(0, maxLines);

    console.log(chalk.red('  <<<< OURS (current branch):'));
    for (const l of oursLines) console.log(chalk.red(`    ${l}`));
    if (file.oursContent.split('\n').length > maxLines)
      console.log(
        chalk.dim(`    ... (${file.oursContent.split('\n').length - maxLines} more lines)`),
      );

    console.log(chalk.green('  >>>> THEIRS (incoming):'));
    for (const l of theirsLines) console.log(chalk.green(`    ${l}`));
    if (file.theirsContent.split('\n').length > maxLines)
      console.log(
        chalk.dim(`    ... (${file.theirsContent.split('\n').length - maxLines} more lines)`),
      );
    console.log();
  }

  private showFullConflict(file: ConflictFile): void {
    console.log(chalk.red('\n════ OURS (full) ════'));
    console.log(file.oursContent);
    console.log(chalk.blue('\n════ BASE ════'));
    console.log(file.baseContent || chalk.dim('(no base available)'));
    console.log(chalk.green('\n════ THEIRS (full) ════'));
    console.log(file.theirsContent);
    console.log();
  }

  private buildResolutionChoices(): Array<{ name: string; value: string }> {
    const choices: Array<{ name: string; value: string }> = [];
    if (this.aiMode === 'auto' || this.aiMode === 'suggest') {
      choices.push(
        { name: '🤖 AI auto-resolve (Claude merges both sides)', value: 'ai-auto' },
        { name: '💡 AI suggest (Claude proposes, you approve)', value: 'ai-suggest' },
      );
    }
    choices.push(
      { name: '⬅️  Keep OURS (current branch version)', value: 'ours' },
      { name: '➡️  Keep THEIRS (incoming version)', value: 'theirs' },
      { name: '✏️  Manual edit', value: 'manual' },
      { name: '👁️  View full conflict', value: 'view-full' },
      { name: '⏭️  Skip this file', value: 'skip' },
    );
    return choices;
  }

  private async manualEdit(file: ConflictFile, startingContent?: string): Promise<boolean> {
    const content = await editor({
      message: `Edit ${file.path} (will open your $EDITOR):`,
      default: startingContent ?? file.oursContent,
    });
    if (!content?.trim()) {
      console.log(chalk.yellow('  Empty content, skipping.'));
      return false;
    }
    await this.git.resolveFile(file.path, content);
    return true;
  }
}
