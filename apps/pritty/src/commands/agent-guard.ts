/**
 * `pritty agent-guard` — the PreToolUse hook for the committer subagent.
 *
 * Claude Code cannot restrict a subagent's Bash commands through its `tools`
 * field, so a hook pipes each call's JSON payload here. Exit 0 allows the call;
 * exit 2 blocks it and the stderr text goes back to the subagent. The guard is
 * deliberately strict: anything ambiguous is refused.
 */
import { resolve, sep } from 'node:path';

export type GuardVerdict = { allow: true } | { allow: false; reason: string };

const ALLOWED_FORMS =
  'Allowed: git status|diff|log|show|rev-parse|ls-files, git add -- <paths>, pritty commit|pr|categorize, pritty --version|--help.';

const GIT_READ = new Set(['status', 'diff', 'log', 'show', 'rev-parse', 'ls-files']);
const PRITTY_SUBCOMMANDS = new Set(['commit', 'pr', 'categorize']);

const refuse = (reason: string): GuardVerdict => ({ allow: false, reason });

/** The `.git/pritty/` scratch directory (with trailing separator) under `cwd`. */
const scratchPrefix = (cwd: string): string => resolve(cwd, '.git/pritty') + sep;

const insideScratch = (path: string, cwd: string): boolean =>
  resolve(cwd, path).startsWith(scratchPrefix(cwd));

const hasControlChar = (s: string): boolean =>
  [...s].some((c) => {
    const n = c.charCodeAt(0);
    return n < 0x20 || n === 0x7f;
  });

export function judgeBash(command: string, cwd: string): GuardVerdict {
  const cmd = command.trim();

  if (cmd.includes('\n') || cmd.includes('\r')) return refuse('A newline is not allowed.');
  // Only plain ASCII spaces separate tokens; tabs, NBSP and other whitespace are ambiguous.
  if (/[^\S ]/u.test(cmd) || hasControlChar(cmd)) {
    return refuse('Unusual whitespace or control characters are not allowed.');
  }
  for (const bad of ['&&', '||', ';', '|', '&', '>', '`', '$(', '${']) {
    if (cmd.includes(bad)) {
      return refuse(`"${bad}" is not allowed in a command. Run one plain command at a time.`);
    }
  }

  const tokens = cmd.split(' ').filter(Boolean);

  const redirects = tokens.filter((t) => t.includes('<')).length;
  let args = tokens;
  if (cmd.includes('<')) {
    const ok =
      redirects === 1 &&
      (cmd.match(/</g) ?? []).length === 1 &&
      tokens.length >= 5 &&
      tokens[0] === 'pritty' &&
      (tokens[1] === 'commit' || tokens[1] === 'pr') &&
      tokens.includes('--input=json') &&
      tokens[tokens.length - 2] === '<';
    const path = tokens[tokens.length - 1] ?? '';
    if (!ok || /["'\\]/.test(path) || !insideScratch(path, cwd)) {
      return refuse(
        'Input redirection is only allowed as `pritty commit|pr … --input=json < <path>` with a path inside .git/pritty/.',
      );
    }
    args = tokens.slice(0, -2);
  }

  const [program, sub, ...rest] = args;

  if (program === 'git' && sub !== undefined) {
    if (GIT_READ.has(sub)) {
      if (rest.some((a) => a === '--output' || a.startsWith('--output='))) {
        return refuse('git --output writes files and is not allowed.');
      }
      return { allow: true };
    }
    if (sub === 'add') {
      if (rest[0] === '--' && rest.length >= 2) return { allow: true };
      return refuse('Stage files only as `git add -- <paths>` with at least one path.');
    }
  }

  if (program === 'pritty' && sub !== undefined) {
    if (PRITTY_SUBCOMMANDS.has(sub) || sub === '--version' || sub === '--help') {
      return { allow: true };
    }
  }

  return refuse(`"${cmd}" is not allowed. ${ALLOWED_FORMS}`);
}

type HookPayload = {
  tool_name?: unknown;
  tool_input?: unknown;
  cwd?: unknown;
};

export function judgeHookPayload(payload: string): GuardVerdict {
  let data: unknown;
  try {
    data = JSON.parse(payload);
  } catch {
    return refuse('The hook payload is not valid JSON.');
  }
  if (typeof data !== 'object' || data === null) {
    return refuse('The hook payload is not a JSON object.');
  }
  const { tool_name: tool, tool_input: input, cwd } = data as HookPayload;
  const fields =
    typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {};

  if (tool === 'Bash') {
    if (typeof fields.command !== 'string' || typeof cwd !== 'string') {
      return refuse('The Bash payload is missing tool_input.command or cwd.');
    }
    return judgeBash(fields.command, cwd);
  }
  if (tool === 'Write' || tool === 'Edit' || tool === 'MultiEdit') {
    if (typeof fields.file_path !== 'string' || typeof cwd !== 'string') {
      return refuse('The file payload is missing tool_input.file_path or cwd.');
    }
    return insideScratch(fields.file_path, cwd)
      ? { allow: true }
      : refuse(`Writes are only allowed inside ${scratchPrefix(cwd)}.`);
  }
  return { allow: true };
}

export async function runAgentGuard(io: {
  readStdin(): Promise<string>;
  err(line: string): void;
}): Promise<0 | 2> {
  const verdict = judgeHookPayload(await io.readStdin());
  if (verdict.allow) return 0;
  io.err(verdict.reason);
  return 2;
}
