/**
 * `pritty agent-guard` — the PreToolUse hook for the committer subagent.
 *
 * Claude Code cannot restrict a subagent's Bash commands through its `tools`
 * field, so a hook pipes each call's JSON payload here. Exit 0 allows the call;
 * exit 2 blocks it and the stderr text goes back to the subagent. Any other
 * exit code counts as "allow", so every failure path here exits 2.
 *
 * The Bash check is an allowlist, not a denylist: the command is tokenized and
 * only plain words and "double-quoted text without expansions" survive, so no
 * shell (bash or zsh) can expand, glob, substitute or chain anything.
 */
import { execFileSync } from 'node:child_process';
import { lstatSync, realpathSync } from 'node:fs';
import { basename, dirname, join, resolve, sep } from 'node:path';

export type GuardVerdict = { allow: true } | { allow: false; reason: string };

/** The absolute scratch directory (`<git dir>/pritty`) for `cwd`, or null outside a repository. */
export type ScratchResolver = (cwd: string) => string | null;

const ALLOWED_FORMS =
  'Allowed: git status|diff|log|show|rev-parse|ls-files, git add -- <paths>, pritty commit|pr|categorize with their documented flags, pritty --version|--help.';

const GIT_READ = new Set(['status', 'diff', 'log', 'show', 'rev-parse', 'ls-files']);

type FlagSpec = { value: ReadonlySet<string>; bool: ReadonlySet<string>; paths: boolean };
const spec = (value: string[], bool: string[], paths = false): FlagSpec => ({
  value: new Set(value),
  bool: new Set(bool),
  paths,
});
const PRITTY_FLAGS: Record<string, FlagSpec> = {
  commit: spec(
    [
      '--label',
      '--type',
      '--scope',
      '--message',
      '--body',
      '--input',
      '--output',
      '--commit-style',
    ],
    ['--breaking', '--dry-run', '--json'],
    true,
  ),
  pr: spec(
    ['--title', '--body', '--input', '--base', '--output'],
    ['--dry-run', '--draft', '--json', '--check', '--no-footer'],
  ),
  categorize: spec(['--output'], ['--all', '--json']),
};

const refuse = (reason: string): GuardVerdict => ({ allow: false, reason });

export const defaultScratchResolver: ScratchResolver = (cwd) => {
  try {
    const out = execFileSync(
      'git',
      ['rev-parse', '--path-format=absolute', '--git-path', 'pritty'],
      {
        cwd,
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 10_000,
      },
    )
      .toString()
      .trim();
    return out || null;
  } catch {
    return null;
  }
};

/** Real path of `p` even when it does not exist yet: the nearest existing ancestor, realpath'd. Null for a dangling symlink. */
function realOfNearest(p: string): string | null {
  const rest: string[] = [];
  let cur = resolve(p);
  for (;;) {
    try {
      return join(realpathSync(cur), ...rest.reverse());
    } catch {
      try {
        lstatSync(cur);
        return null; // exists but cannot be resolved: a dangling symlink
      } catch {
        // does not exist: climb
      }
    }
    const parent = dirname(cur);
    if (parent === cur) return null;
    rest.push(basename(cur));
    cur = parent;
  }
}

function insideScratch(path: string, cwd: string, scratch: ScratchResolver): boolean {
  const dir = scratch(cwd);
  if (!dir) return false;
  const realDir = realOfNearest(dir);
  const real = realOfNearest(resolve(cwd, path));
  if (realDir === null || real === null) return false;
  return real.startsWith(realDir + sep);
}

type Token = { text: string; quoted: boolean };

const PLAIN = /^[A-Za-z0-9._/:@%^,+=-]$/;

/** Plain words and double-quoted text only; null when anything else appears. `<` is its own token. */
function tokenize(cmd: string): Token[] | null {
  const tokens: Token[] = [];
  let i = 0;
  while (i < cmd.length) {
    if (cmd[i] === ' ') {
      i++;
      continue;
    }
    if (cmd[i] === '<') {
      if (cmd[i + 1] !== ' ') return null;
      tokens.push({ text: '<', quoted: false });
      i++;
      continue;
    }
    if (cmd[i] === '=' || cmd[i] === '~') return null; // zsh =cmd and ~ expansion
    let text = '';
    let quoted = false;
    while (i < cmd.length && cmd[i] !== ' ') {
      const c = cmd[i] as string;
      if (PLAIN.test(c)) {
        text += c;
        i++;
      } else if (c === '"') {
        const end = cmd.indexOf('"', i + 1);
        if (end < 0) return null;
        const body = cmd.slice(i + 1, end);
        if (/[$`\\!\n\r]/.test(body)) return null;
        text += body;
        quoted = true;
        i = end + 1;
      } else {
        return null;
      }
    }
    tokens.push({ text, quoted });
  }
  return tokens;
}

const isOutputFlag = (t: string): boolean => t === '--output' || t.startsWith('--output=');

function judgePritty(sub: string, rest: string[], redirect: boolean): GuardVerdict {
  const flags = PRITTY_FLAGS[sub];
  if (!flags) return refuse(`"pritty ${sub}" is not allowed. ${ALLOWED_FORMS}`);
  let input = false;
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i] as string;
    if (arg === '--') {
      if (!flags.paths) return refuse(`"pritty ${sub}" takes no paths. ${ALLOWED_FORMS}`);
      break; // everything after is a path (plain words, already vetted)
    }
    const eq = arg.indexOf('=');
    const name = eq < 0 ? arg : arg.slice(0, eq);
    if (flags.bool.has(name) && eq < 0) continue;
    if (flags.value.has(name)) {
      let value: string | undefined;
      if (eq >= 0) value = arg.slice(eq + 1);
      else {
        value = rest[++i];
        if (value === undefined) return refuse(`${name} needs a value.`);
      }
      if (name === '--input' && value === 'json') input = true;
      continue;
    }
    return refuse(`"${arg}" is not an allowed flag for pritty ${sub}. ${ALLOWED_FORMS}`);
  }
  if (redirect && !input) return refuse('Input redirection needs --input=json.');
  return { allow: true };
}

export function judgeBash(
  command: string,
  cwd: string,
  scratch: ScratchResolver = defaultScratchResolver,
): GuardVerdict {
  const tokens = tokenize(command.trim());
  if (!tokens) {
    return refuse(
      'Only plain words and double-quoted text (no $, `, \\, !, quotes inside) are allowed: no operators, globs, braces, expansions, single quotes or redirects.',
    );
  }
  if (tokens.length === 0) return refuse(`An empty command is not allowed. ${ALLOWED_FORMS}`);

  let args = tokens.map((t) => t.text);
  let redirect = false;
  const lt = tokens.findIndex((t) => t.text === '<' && !t.quoted);
  if (lt >= 0) {
    const path = tokens[lt + 1];
    const ok =
      lt === tokens.length - 2 &&
      path !== undefined &&
      !path.quoted &&
      args[0] === 'pritty' &&
      (args[1] === 'commit' || args[1] === 'pr') &&
      insideScratch(path.text, cwd, scratch);
    if (!ok) {
      return refuse(
        'Input redirection is only allowed as `pritty commit|pr … --input=json < <path>` with one plain path inside .git/pritty/.',
      );
    }
    redirect = true;
    args = args.slice(0, -2);
  }

  const [program, sub, ...rest] = args;

  if (program === 'git' && sub !== undefined) {
    if (GIT_READ.has(sub)) {
      if (rest.some((a) => isOutputFlag(a) || a === '--ext-diff')) {
        return refuse(
          'git --output and --ext-diff write files or run programs and are not allowed.',
        );
      }
      return { allow: true };
    }
    if (sub === 'add') {
      if (rest[0] === '--' && rest.length >= 2) return { allow: true };
      return refuse('Stage files only as `git add -- <paths>` with at least one path.');
    }
  }

  if (program === 'pritty' && sub !== undefined) {
    if (sub === '--version' || sub === '--help') {
      return rest.length === 0 ? { allow: true } : refuse(`${sub} takes no arguments.`);
    }
    if (sub in PRITTY_FLAGS) return judgePritty(sub, rest, redirect);
  }

  return refuse(`"${command.trim()}" is not allowed. ${ALLOWED_FORMS}`);
}

export function judgeHookPayload(
  payload: string,
  scratch: ScratchResolver = defaultScratchResolver,
): GuardVerdict {
  let data: unknown;
  try {
    data = JSON.parse(payload);
  } catch {
    return refuse('The hook payload is not valid JSON.');
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return refuse('The hook payload is not a JSON object.');
  }
  const { tool_name: tool, tool_input: input, cwd } = data as Record<string, unknown>;
  if (typeof tool !== 'string') return refuse('The hook payload has no tool_name.');
  const fields =
    typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {};

  if (tool === 'Bash') {
    if (typeof fields.command !== 'string' || typeof cwd !== 'string') {
      return refuse('The Bash payload is missing tool_input.command or cwd.');
    }
    return judgeBash(fields.command, cwd, scratch);
  }
  if (tool === 'Write' || tool === 'Edit' || tool === 'MultiEdit') {
    if (typeof fields.file_path !== 'string' || typeof cwd !== 'string') {
      return refuse('The file payload is missing tool_input.file_path or cwd.');
    }
    return insideScratch(fields.file_path, cwd, scratch)
      ? { allow: true }
      : refuse('Writes are only allowed inside the repository .git/pritty/ directory.');
  }
  return { allow: true };
}

export async function runAgentGuard(
  io: { readStdin(): Promise<string>; err(line: string): void },
  scratch: ScratchResolver = defaultScratchResolver,
): Promise<0 | 2> {
  try {
    const verdict = judgeHookPayload(await io.readStdin(), scratch);
    if (verdict.allow) return 0;
    io.err(verdict.reason);
    return 2;
  } catch (err) {
    io.err(`agent-guard failed closed: ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  }
}
