import { confirm } from '@inquirer/prompts';

/**
 * A yes/no gate that is safe without a terminal. Returns true when `yes` is set, prompts
 * interactively on a TTY, and otherwise refuses: a non-interactive run (CI, a pipe) must
 * not silently proceed or hang waiting on a prompt that can never be answered (C1). On a
 * non-TTY refusal it sets a non-zero exit code so callers can simply `return`.
 */
export async function confirmGate(message: string, opts: { yes?: boolean } = {}): Promise<boolean> {
  if (opts.yes) return true;
  if (!process.stdin.isTTY) {
    console.error(
      'Refusing to continue without a terminal to confirm. Re-run with --yes to proceed non-interactively.',
    );
    process.exitCode = 1;
    return false;
  }
  return confirm({ message, default: true });
}
