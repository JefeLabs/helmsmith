/**
 * Jira CLI adapter — shells out to Atlassian's `acli` binary
 * (https://developer.atlassian.com/cloud/acli/). Pattern proven in
 * pr-automation:
 *
 *   acli jira workitem view <KEY> --json
 *
 * Auth is delegated to acli's own config (`acli jira auth login`).
 * Pritty doesn't touch credentials — the CLI handles that, which is
 * the appeal of this adapter (no env-var setup, no token rotation).
 *
 * Install: `toolz install acli` on macOS (Atlassian's brew tap).
 * Linux/Windows users follow Atlassian's docs.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { TicketSystemAdapter, ValidationResult } from './index.js';

const runArgs = promisify(execFile);

interface AcliResponse {
  key?: string;
  summary?: string;
  status?: { name?: string } | string;
  // acli's exact field shape varies by version; we look for the most
  // common ones and ignore the rest.
}

export class JiraCliAdapter implements TicketSystemAdapter {
  readonly name = 'jira-cli' as const;

  async isAvailable(): Promise<boolean> {
    try {
      await runArgs('acli', ['jira', '--version'], { timeout: 5_000 });
      return true;
    } catch {
      return false;
    }
  }

  async validate(ticket: string): Promise<ValidationResult | null> {
    if (!(await this.isAvailable())) return null;

    let stdout = '';
    let stderr = '';
    try {
      const result = await runArgs('acli', ['jira', 'workitem', 'view', ticket, '--json'], {
        timeout: 30_000,
        maxBuffer: 4 * 1024 * 1024,
      });
      stdout = result.stdout;
      stderr = result.stderr;
    } catch (err) {
      const e = err as NodeJS.ErrnoException & {
        stdout?: string;
        stderr?: string;
      };
      const combined = `${e.stderr ?? ''} ${e.message ?? ''}`.toLowerCase();
      if (combined.includes('not found') || combined.includes('404')) {
        return { exists: false, error: `${ticket} not found in Jira` };
      }
      // 401 / network / config error → fail open
      return null;
    }

    // acli sometimes returns a 0 exit but writes "not found" to stderr
    if (stderr.toLowerCase().includes('not found')) {
      return { exists: false, error: `${ticket} not found in Jira` };
    }
    if (stderr.toLowerCase().includes('unauthorized')) {
      return null;
    }

    let data: AcliResponse;
    try {
      data = JSON.parse(stdout.trim()) as AcliResponse;
    } catch {
      // Some acli versions emit non-JSON even with --json on edge cases.
      // Treat as unparseable; trust the binary's exit code = exists.
      return { exists: true };
    }

    const status = typeof data.status === 'object' ? data.status?.name : data.status;

    return {
      exists: true,
      ...(data.summary ? { title: data.summary } : {}),
      ...(status ? { status } : {}),
    };
  }
}
