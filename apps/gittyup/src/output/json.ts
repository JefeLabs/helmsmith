/**
 * The `--json` output contract (spec §3.1, §3.5):
 *
 *   success → stdout carries exactly one line, the compact JSON document;
 *   failure → stdout stays empty, stderr's last line is the error body,
 *             exit 2 (refused) or 1 (broken).
 *
 * `enterJsonMode()` runs once in `cli.ts`, before commander parses. It keeps
 * the real stdout writer for the document and sends every `console.log` /
 * `console.info` to stderr, so a print deep in shared code can never corrupt
 * the document a caller parses.
 */
import { format } from 'node:util';
import { exitCodeFor, GittyupError, toErrorBody } from '../core/errors.js';

/** True when `--json` appears among the CLI args (before any `--` terminator). */
export function wantsJson(argv: readonly string[]): boolean {
  for (const arg of argv) {
    if (arg === '--') return false;
    if (arg === '--json') return true;
  }
  return false;
}

export interface JsonIo {
  writeOut(s: string): void;
  writeErr(s: string): void;
  exit(code: number): never;
}

export interface JsonOutput {
  emit(doc: unknown): void;
  fail(err: unknown): never;
}

export function createJsonOutput(io: JsonIo): JsonOutput {
  let emitted = false;
  return {
    emit(doc) {
      if (emitted) throw new GittyupError('INTERNAL', 'emitJson called twice');
      emitted = true;
      io.writeOut(`${JSON.stringify(doc)}\n`);
    },
    fail(err) {
      const body = toErrorBody(err);
      io.writeErr(`${JSON.stringify(body)}\n`);
      return io.exit(exitCodeFor(body.code));
    },
  };
}

/** Route `log`/`info` on `target` to `writeErr`, formatted like console.log. Returns a restore. */
export function redirectConsoleToStderr(
  target: Pick<Console, 'log' | 'info'>,
  writeErr: (s: string) => void,
): () => void {
  const { log, info } = target;
  const toErr = (...args: unknown[]) => writeErr(`${format(...args)}\n`);
  target.log = toErr;
  target.info = toErr;
  return () => {
    target.log = log;
    target.info = info;
  };
}

let active: JsonOutput | null = null;

/** Switch the process into JSON mode. Call once, before any command runs. */
export function enterJsonMode(): void {
  const writeOut = process.stdout.write.bind(process.stdout);
  const writeErr = (s: string) => {
    process.stderr.write(s);
  };
  redirectConsoleToStderr(console, writeErr);
  active = createJsonOutput({
    writeOut: (s) => {
      writeOut(s);
    },
    writeErr,
    exit: (code) => process.exit(code),
  });
}

function current(): JsonOutput {
  if (!active) throw new GittyupError('INTERNAL', 'not in JSON mode');
  return active;
}

/** Print the command's one JSON document on stdout. */
export function emitJson(doc: unknown): void {
  current().emit(doc);
}

/** Print the error body on stderr and exit 2 (refused) or 1 (broken). */
export function failJson(err: unknown): never {
  return current().fail(err);
}
