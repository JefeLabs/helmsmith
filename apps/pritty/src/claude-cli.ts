/**
 * The `claude` provider: Claude Code's own binary, run headlessly on the
 * developer's login (a claude.ai subscription or whatever `claude` is
 * configured with). No API key passes through pritty.
 *
 * `@helmsmith/agent-adapter` has a claude-code-cli adapter too, but it
 * sandboxes $HOME on purpose and demands an API key, which is the one thing
 * this provider exists to avoid.
 */

import { spawn } from 'node:child_process';
import { accessSync, constants, statSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import type { AgentInput, AgentInvocationResult } from '@helmsmith/agent-adapter';

export const CLAUDE_CLI_TYPE = 'claude-cli' as const;

/** First executable named `claude` on PATH, or null. */
export function findClaudeBinary(pathEnv: string = process.env.PATH ?? ''): string | null {
  for (const dir of pathEnv.split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, 'claude');
    try {
      if (!statSync(candidate).isFile()) continue;
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // not here
    }
  }
  return null;
}

export interface ClaudeCliOptions {
  binary: string;
  model: string;
  /** The child is killed after this long; the caller's withTimeout fires first. */
  timeoutMs: number;
  cwd: string;
}

export interface ClaudeCliAdapter {
  readonly type: typeof CLAUDE_CLI_TYPE;
  invoke(input: AgentInput): Promise<AgentInvocationResult>;
}

/** One answer, no tools, no MCP servers, no session on disk, no skills. */
const HEADLESS_FLAGS = [
  '-p',
  '--output-format',
  'json',
  '--max-turns',
  '1',
  '--strict-mcp-config',
  '--mcp-config',
  '{"mcpServers":{}}',
  '--no-session-persistence',
  '--disable-slash-commands',
];

interface ResultMessage {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  result?: unknown;
}

function promptText(input: AgentInput): string {
  return input.messages
    .map((m) =>
      typeof m.content === 'string'
        ? m.content
        : m.content.map((b) => ('text' in b && typeof b.text === 'string' ? b.text : '')).join(''),
    )
    .join('\n\n');
}

function childEnv(): NodeJS.ProcessEnv {
  // Dropping the nesting guards lets `pritty commit` run from inside a Claude Code session.
  const { CLAUDECODE: _nested, CLAUDE_CODE_ENTRYPOINT: _entry, ...env } = process.env;
  return env;
}

function parseResult(stdout: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error(
      `claude returned no result message (unparseable output): ${stdout.slice(0, 200)}`,
    );
  }
  const messages: ResultMessage[] = Array.isArray(parsed) ? parsed : [parsed as ResultMessage];
  const result = messages.find((m) => m && typeof m === 'object' && m.type === 'result');
  if (!result) throw new Error('claude returned no result message');
  const text =
    typeof result.result === 'string' ? result.result : JSON.stringify(result.result ?? '');
  if (result.is_error || (result.subtype && result.subtype !== 'success')) {
    throw new Error(`claude reported ${result.subtype ?? 'error'}: ${text}`);
  }
  return text;
}

export function createClaudeCliAdapter(options: ClaudeCliOptions): ClaudeCliAdapter {
  return {
    type: CLAUDE_CLI_TYPE,
    invoke(input: AgentInput): Promise<AgentInvocationResult> {
      const started = Date.now();
      const args = [...HEADLESS_FLAGS, '--model', options.model];
      if (input.systemPrompt) args.push('--system-prompt', input.systemPrompt);
      args.push('--tools', '');
      return new Promise((resolve, reject) => {
        const child = spawn(options.binary, args, {
          cwd: options.cwd,
          env: childEnv(),
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: options.timeoutMs,
          killSignal: 'SIGTERM',
        });
        let stdout = '';
        let stderr = '';
        child.stdout.setEncoding('utf8').on('data', (d: string) => {
          stdout += d;
        });
        child.stderr.setEncoding('utf8').on('data', (d: string) => {
          stderr += d;
        });
        child.on('error', (err) =>
          reject(new Error(`cannot run ${options.binary}: ${err.message}`)),
        );
        child.on('close', (code, signal) => {
          if (signal) {
            reject(new Error(`claude was killed (${signal}) after ${options.timeoutMs} ms`));
            return;
          }
          if (code !== 0) {
            reject(new Error(`claude exited with code ${code}\n${stderr.trim().slice(-2000)}`));
            return;
          }
          try {
            resolve({
              content: parseResult(stdout),
              finishReason: 'stop',
              durationMs: Date.now() - started,
            });
          } catch (err) {
            reject(err);
          }
        });
        child.stdin.on('error', () => {
          // the child exited before reading; 'close' reports why
        });
        child.stdin.end(promptText(input));
      });
    },
  };
}
