import chalk from 'chalk';
import { APP_NAME } from '../config/branding.js';
import type { AiMode, ConflictFile, ConflictSession, RepoConfig } from '../config/schema.js';
import { diffStat, extractLastFencedBlock, stripOuterFence } from './ai-text.js';
import type { GitOperations } from './git-operations.js';
import { checkResolution, ResolutionRejected } from './resolution-gate.js';
import { inquirerPrompts, type ResolverPrompts } from './resolver-prompts.js';

/** Options for a resolution session; prompts and the AI callback are injectable. */
export interface ResolverOptions {
  /** Default: inquirer. Tests pass `scriptedPrompts(...)`. */
  prompts?: ResolverPrompts;
  /** Skip the confirmation before an AI auto resolution is written. */
  yes?: boolean;
  /** Shown in menu copy; default 'AI'. */
  modelName?: string;
  onAiResolve?: (file: ConflictFile, mode: 'auto' | 'suggest') => Promise<string | null>;
  onFileResolved?: (repoName: string, filePath: string) => void;
  onSessionComplete?: (session: ConflictSession) => void;
}

type MenuAction = 'ai-auto' | 'ai-suggest' | 'ours' | 'theirs' | 'manual' | 'view-full' | 'skip';

const PREVIEW_LINES = 8;

/**
 * Interactive conflict resolution session. Walks each conflicted file and
 * offers AI, ours/theirs, manual edit, or skip. Every write goes through
 * `GitOperations.applyResolution`, so nothing here can write a fragment,
 * markers, or prose.
 */
export class ConflictResolver {
  private readonly prompts: ResolverPrompts;
  private readonly modelName: string;

  constructor(
    private readonly git: GitOperations,
    private readonly repo: RepoConfig,
    private readonly aiMode: AiMode,
    private readonly options: ResolverOptions = {},
  ) {
    this.prompts = options.prompts ?? inquirerPrompts;
    this.modelName = options.modelName ?? 'AI';
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
        this.options.onFileResolved?.(this.repo.name, file.path);
        console.log(chalk.green(`  ✓ Resolved: ${file.path}`));
      } else {
        console.log(chalk.red(`  ✗ Skipped: ${file.path}`));
      }
      console.log();
    }

    if (session.resolvedFiles.length === files.length) {
      session.status = 'resolved';
      console.log(chalk.green.bold('All conflicts resolved!'));

      const shouldCommit = await this.prompts.confirm({
        message: 'Commit the resolution?',
        default: true,
      });
      if (shouldCommit) {
        const hash = await this.git.commitResolution(
          `resolve: ${operation} ${sourceBranch} → ${targetBranch} via ${APP_NAME}`,
        );
        console.log(chalk.green(`  Committed: ${hash}`));
      }
    } else {
      const unresolved = files.length - session.resolvedFiles.length;
      console.log(chalk.yellow(`${unresolved} file(s) still unresolved.`));

      const action = await this.prompts.select({
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

    this.options.onSessionComplete?.(session);
    return session;
  }

  // ─── Individual File Resolution ───────────────────────────────────

  private async resolveFile(file: ConflictFile): Promise<boolean> {
    this.showConflictPreview(file);
    const action = await this.prompts.select<MenuAction>({
      message: `How to resolve ${chalk.bold(file.path)}?`,
      choices: this.buildResolutionChoices(file),
    });

    switch (action) {
      case 'ours':
        await this.git.resolveUseOurs(file);
        return true;
      case 'theirs':
        await this.git.resolveUseTheirs(file);
        return true;
      case 'ai-auto':
        return this.aiAuto(file);
      case 'ai-suggest':
        return this.aiSuggest(file);
      case 'manual':
        return this.manualEdit(file, file.markedContent);
      case 'view-full':
        this.showFullConflict(file);
        return this.resolveFile(file);
      default:
        return false;
    }
  }

  /** AI writes the complete file; the user sees a line diff and confirms (unless `yes`). */
  private async aiAuto(file: ConflictFile): Promise<boolean> {
    const reply = await this.options.onAiResolve?.(file, 'auto');
    if (!reply) {
      console.log(chalk.yellow('  AI could not auto-resolve. Falling back to the menu.'));
      return this.resolveFile(file);
    }

    const content = stripOuterFence(reply);
    const verdict = checkResolution(content, file);
    if (!verdict.ok) {
      console.log(chalk.yellow(`  ✗ AI resolution refused: ${verdict.reason}`));
      return this.resolveFile(file);
    }

    const { added, removed } = diffStat(file.ours ?? '', content);
    console.log(chalk.dim(`  AI resolution: +${added} −${removed} lines vs OURS`));
    if (!this.options.yes) {
      const write = await this.prompts.confirm({
        message: `Write this resolution to ${file.path}?`,
        default: true,
      });
      if (!write) return this.resolveFile(file);
    }
    return this.tryApply(file, content);
  }

  /** AI explains, then proposes the complete file in a final fenced block. */
  private async aiSuggest(file: ConflictFile): Promise<boolean> {
    const reply = await this.options.onAiResolve?.(file, 'suggest');
    const block = reply ? extractLastFencedBlock(reply) : null;
    if (!block) {
      console.log(chalk.yellow('  AI did not return a usable suggestion.'));
      return this.resolveFile(file);
    }

    console.log(chalk.dim('\n── AI rationale ──'));
    console.log(block.rationale || chalk.dim('(none)'));
    console.log(chalk.dim('── Proposed file ──'));
    console.log(block.code);
    console.log(chalk.dim('── End ──\n'));

    const accept = await this.prompts.select({
      message: 'Accept this suggestion?',
      choices: [
        { name: 'Accept as-is', value: 'accept' as const },
        { name: 'Accept and edit', value: 'edit' as const },
        { name: 'Reject, back to the menu', value: 'reject' as const },
      ],
    });
    if (accept === 'accept') {
      return (await this.tryApply(file, block.code)) || this.resolveFile(file);
    }
    if (accept === 'edit') return this.manualEdit(file, block.code);
    return this.resolveFile(file);
  }

  /** Open the editor on `initial`; refuse markers/fragments and offer to reopen. */
  private async manualEdit(file: ConflictFile, initial: string): Promise<boolean> {
    let content = initial;
    while (true) {
      content = await this.prompts.editor({
        message: `Edit ${file.path} (will open your $EDITOR):`,
        default: content,
      });
      if (await this.tryApply(file, content)) return true;
      const reopen = await this.prompts.confirm({ message: 'Reopen the editor?', default: true });
      if (!reopen) return false;
    }
  }

  /** The single write; prints the gate's reason and returns false when refused. */
  private async tryApply(file: ConflictFile, content: string): Promise<boolean> {
    try {
      await this.git.applyResolution(file, content);
      return true;
    } catch (err) {
      if (err instanceof ResolutionRejected) {
        console.log(chalk.yellow(`  ✗ Resolution refused: ${err.reason}`));
        return false;
      }
      throw err;
    }
  }

  // ─── UI Helpers ───────────────────────────────────────────────────

  private showConflictPreview(file: ConflictFile): void {
    if (file.hunks.length === 0) {
      console.log(chalk.dim('  (no textual conflict hunks: one side deleted the file, or binary)'));
      console.log(chalk.dim(`  ours:   ${file.ours === undefined ? 'deleted' : 'present'}`));
      console.log(chalk.dim(`  theirs: ${file.theirs === undefined ? 'deleted' : 'present'}\n`));
      return;
    }
    file.hunks.forEach((hunk, i) => {
      console.log(chalk.dim(`  ─── hunk ${i + 1}/${file.hunks.length} ───`));
      printSide(chalk.red, '<<<< OURS (current branch):', hunk.ours);
      printSide(chalk.green, '>>>> THEIRS (incoming):', hunk.theirs);
    });
    console.log();
  }

  private showFullConflict(file: ConflictFile): void {
    console.log(chalk.dim('\n════ CONFLICTED WORKING COPY ════'));
    console.log(file.markedContent);
    console.log();
  }

  private buildResolutionChoices(file: ConflictFile): Array<{ name: string; value: MenuAction }> {
    const choices: Array<{ name: string; value: MenuAction }> = [];
    const textual = file.hunks.length > 0;
    if (textual && (this.aiMode === 'auto' || this.aiMode === 'suggest')) {
      choices.push(
        { name: `🤖 AI auto-resolve (${this.modelName} writes the merged file)`, value: 'ai-auto' },
        { name: `💡 AI suggest (${this.modelName} proposes, you approve)`, value: 'ai-suggest' },
      );
    }
    choices.push(
      { name: '⬅️  Keep OURS (current branch version)', value: 'ours' },
      { name: '➡️  Keep THEIRS (incoming version)', value: 'theirs' },
    );
    if (textual) {
      choices.push(
        { name: '✏️  Manual edit', value: 'manual' },
        { name: '👁️  View full conflict', value: 'view-full' },
      );
    }
    choices.push({ name: '⏭️  Skip this file', value: 'skip' });
    return choices;
  }
}

function printSide(color: (s: string) => string, header: string, text: string): void {
  const lines = text.split('\n');
  console.log(color(`  ${header}`));
  for (const l of lines.slice(0, PREVIEW_LINES)) console.log(color(`    ${l}`));
  if (lines.length > PREVIEW_LINES) {
    console.log(chalk.dim(`    ... (${lines.length - PREVIEW_LINES} more lines)`));
  }
}
