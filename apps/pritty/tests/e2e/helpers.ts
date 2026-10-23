import { execFileSync, spawn } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { gitIn, write } from '../../src/testing/repo.js';

/** The published entry point, so the bin stub is exercised, not just dist/cli.js. */
const BIN = resolve(import.meta.dirname, '../../bin/pritty.mjs');

const GIT = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();

export interface Sandbox {
  /** Temp root (realpath'd: macOS tmpdir is a symlink); cleanup() removes it. */
  root: string;
  /** HOME for the CLI. */
  home: string;
  /** PRITTY_HOME for the CLI: auth.json and cache.json land here. */
  prittyHome: string;
  /** First PATH entry for the CLI: `git`, plus `claude` once installFakeClaude() ran. */
  bin: string;
  cleanup(): void;
}

export function makeSandbox(): Sandbox {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'pritty-e2e-')));
  const sb: Sandbox = {
    root,
    home: join(root, 'home'),
    prittyHome: join(root, 'pritty-home'),
    bin: join(root, 'bin'),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
  mkdirSync(sb.home);
  mkdirSync(sb.bin);
  symlinkSync(GIT, join(sb.bin, 'git'));
  return sb;
}

/**
 * A repository at `<root>/<name>` on `main`, with its identity in its own
 * config (the CLI runs with no global git config) and one commit holding a
 * README and, when given, `.pritty.json`.
 */
export function makeRepo(
  sb: Sandbox,
  opts: { config?: Record<string, unknown>; name?: string } = {},
): string {
  const dir = join(sb.root, opts.name ?? 'repo');
  mkdirSync(dir);
  gitIn(dir, 'init', '-q', '-b', 'main');
  gitIn(dir, 'config', 'user.name', 't');
  gitIn(dir, 'config', 'user.email', 't@x');
  gitIn(dir, 'config', 'commit.gpgsign', 'false');
  write(dir, 'README.md', 'hello\n');
  if (opts.config) write(dir, '.pritty.json', `${JSON.stringify(opts.config, null, 2)}\n`);
  gitIn(dir, 'add', '-A');
  gitIn(dir, 'commit', '-q', '-m', 'init');
  return dir;
}

export interface CliResult {
  stdout: string;
  stderr: string;
  /** Exit code; 1 when the process died by signal or timed out. */
  exitCode: number;
  timedOut: boolean;
}

/**
 * Run `node bin/pritty.mjs <args>` in `cwd`. The environment is built from
 * scratch, not inherited: PATH is the sandbox bin plus /usr/bin:/bin, so the
 * developer's real `claude`, `gh` login and tokens are out of reach and
 * nothing in these tests can call a model or GitHub; HOME and PRITTY_HOME
 * point into the sandbox. stdin is closed at once, so a prompt fails on EOF
 * instead of waiting. Never throws on a non-zero exit.
 */
export function runCli(
  sb: Sandbox,
  cwd: string,
  args: string[],
  opts: { env?: Record<string, string>; timeoutMs?: number } = {},
): Promise<CliResult> {
  const env: NodeJS.ProcessEnv = {
    PATH: [sb.bin, '/usr/bin', '/bin'].join(delimiter),
    HOME: sb.home,
    PRITTY_HOME: sb.prittyHome,
    TMPDIR: tmpdir(),
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    NO_COLOR: '1',
    ...opts.env,
  };
  return new Promise((resolvePromise) => {
    const child = spawn(process.execPath, [BIN, ...args], {
      cwd,
      env,
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    child.stdout.on('data', (d) => {
      stdout += d;
    });
    child.stderr.on('data', (d) => {
      stderr += d;
    });
    child.stdin.end();

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        if (child.pid) process.kill(-child.pid, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    }, opts.timeoutMs ?? 20_000);

    child.on('close', (code) => {
      clearTimeout(timer);
      resolvePromise({ stdout, stderr, exitCode: code ?? 1, timedOut });
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolvePromise({ stdout, stderr: `${stderr}${err.message}`, exitCode: 1, timedOut });
    });
  });
}

/** The single JSON line a `--json` run prints on stdout; fails if there is any other output. */
export function jsonLine<T>(r: CliResult): T {
  const lines = r.stdout.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length !== 1) {
    throw new Error(`expected exactly one stdout line, got ${lines.length}:\n${r.stdout}`);
  }
  return JSON.parse(lines[0]!) as T;
}

export interface ClaudeCall {
  argv: string[];
  /** The prompt, as pritty piped it in. */
  stdin: string;
  cwd: string;
}

export interface FakeClaude {
  /** What the model says on every call: the `result` of claude's JSON output. */
  answer(text: string): void;
  /** Every call exits with `code` after writing `stderr`, instead of answering. */
  fail(code: number, stderr: string): void;
  calls(): ClaudeCall[];
}

const FAKE_CLAUDE = `
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
const [dir, ...argv] = process.argv.slice(2);
let stdin = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) stdin += chunk;
appendFileSync(join(dir, 'calls.jsonl'), JSON.stringify({ argv, stdin, cwd: process.cwd() }) + '\\n');
if (existsSync(join(dir, 'fail.json'))) {
  const { code, stderr } = JSON.parse(readFileSync(join(dir, 'fail.json'), 'utf8'));
  process.stderr.write(stderr);
  process.exit(code);
}
const answer = join(dir, 'answer.txt');
const result = existsSync(answer) ? readFileSync(answer, 'utf8') : '';
process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result }));
`;

const shQuote = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;

/**
 * Put a stand-in for Claude Code's `claude` binary on the sandbox PATH (the
 * `claude` provider runs whatever `claude` it finds there). It records each
 * call's argv, stdin and cwd, then prints the envelope `claude -p
 * --output-format json` prints, carrying the configured answer.
 */
export function installFakeClaude(sb: Sandbox): FakeClaude {
  const dir = join(sb.root, 'fake-claude');
  mkdirSync(dir);
  const script = join(dir, 'claude.mjs');
  writeFileSync(script, FAKE_CLAUDE);
  const launcher = join(sb.bin, 'claude');
  writeFileSync(
    launcher,
    `#!/bin/sh\nexec ${shQuote(process.execPath)} ${shQuote(script)} ${shQuote(dir)} "$@"\n`,
  );
  chmodSync(launcher, 0o755);
  return {
    answer: (text) => writeFileSync(join(dir, 'answer.txt'), text),
    fail: (code, stderr) => writeFileSync(join(dir, 'fail.json'), JSON.stringify({ code, stderr })),
    calls: () => {
      const log = join(dir, 'calls.jsonl');
      if (!existsSync(log)) return [];
      return readFileSync(log, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as ClaudeCall);
    },
  };
}

export const head = (repo: string): string => gitIn(repo, 'rev-parse', 'HEAD').trim();
