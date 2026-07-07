/**
 * Resolved invocation options → `opencode run` flags (Phase D).
 *
 * Verified against the REAL `opencode` CLI v1.17.5 (`opencode run --help`):
 *   run                         headless subcommand; takes the prompt as a
 *                               positional `[message..]` (NOT over stdin).
 *   --format json               newline-delimited raw JSON events on stdout
 *                               (the real flag — the PRD assumed `--print --json`,
 *                               which does NOT exist on opencode v1.17.5).
 *   --pure                      run without external plugins (deterministic;
 *                               matches the OLD adapter's plugin suppression).
 *   --thinking                  surface reasoning blocks (reasoning models put
 *                               their answer in reasoning; without this the
 *                               `reasoning` events are hidden).
 *   --model <provider/model>    e.g. `anthropic/claude-opus-4-7`.
 *   --attach <url>              attach to a long-running `opencode serve`.
 *   --dir <path>               directory to run in (REQUIRED in --attach mode,
 *                               since cwd is not transferred to the remote).
 *   --dangerously-skip-permissions
 *                               auto-approve built-in tool permissions so the
 *                               agent can run tools autonomously in headless
 *                               mode (opt-in; off by default).
 *
 * The prompt positional is appended by the adapter (see index.ts), AFTER these
 * flags, mirroring `opencode run [flags] <message>`.
 */

/** The CLI binary name (resolved via PATH or spec.binaryPath in the adapter). */
export const OPENCODE_BINARY = 'opencode';

export interface OpencodeFlagArgs {
  /** Fully-resolved `provider/model` string. */
  model: string;
  /** When set, attach to a running `opencode serve` instance via --attach. */
  serverUrl?: string;
  /** Working directory; forwarded as --dir only in --attach mode. */
  workdir?: string;
  /** Auto-approve built-in tool permissions (headless autonomous tool use). */
  dangerouslySkipPermissions?: boolean;
  /** Surface reasoning/thinking blocks. Defaults to true. */
  thinking?: boolean;
}

/**
 * Build the argv (excluding the binary + the trailing prompt positional) for a
 * headless `opencode run --format json` round-trip.
 */
export function buildOpencodeFlags(args: OpencodeFlagArgs): string[] {
  const flags: string[] = ['run', '--format', 'json', '--pure'];

  if (args.thinking !== false) flags.push('--thinking');

  flags.push('--model', args.model);

  if (args.serverUrl) {
    flags.push('--attach', args.serverUrl);
    // cwd does not transfer to the remote server — pin the run dir explicitly.
    if (args.workdir) flags.push('--dir', args.workdir);
  }

  if (args.dangerouslySkipPermissions) {
    flags.push('--dangerously-skip-permissions');
  }

  return flags;
}
