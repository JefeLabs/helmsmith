/**
 * M0 placeholder. Each command verb is wired and discoverable via
 * `--help`, but its behaviour lands in a later milestone. This keeps
 * the scaffold runnable while signalling exactly where real work goes.
 */
export function notImplemented(verb: string, milestone: string): void {
  console.error(
    `\n  '${verb}' is scaffolded but not implemented yet.\n` +
      `  Lands in ${milestone} — see .plan/05-build-sequence.md.\n`,
  );
  process.exitCode = 1;
}
