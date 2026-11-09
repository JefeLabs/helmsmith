/**
 * Error codes for the `--json` contract (spec
 * docs/superpowers/specs/2026-11-07-gittyup-json-mode-design.md §3.2).
 *
 * A JSON caller branches on `code`; `message` is for people. Refusals (a rule
 * said no, nothing was touched) exit 2; anything broken exits 1 — the same
 * split workbrokr and storybrokr use.
 */

export type ErrorCode =
  | 'USAGE'
  | 'CONFIRMATION_REQUIRED'
  | 'INTERACTIVE_ONLY'
  | 'TARGET_REQUIRED'
  | 'TARGET_UNKNOWN'
  | 'GROUP_EXISTS'
  | 'GROUP_NOT_FOUND'
  | 'REPO_EXISTS'
  | 'REPO_NOT_FOUND'
  | 'PATH_NOT_FOUND'
  | 'MANIFEST_INVALID'
  | 'AUTH_REQUIRED'
  | 'GIT_FAILED'
  | 'GITHUB_FAILED'
  | 'INTERNAL';

const REFUSALS = new Set<ErrorCode>([
  'USAGE',
  'CONFIRMATION_REQUIRED',
  'INTERACTIVE_ONLY',
  'TARGET_REQUIRED',
  'TARGET_UNKNOWN',
  'GROUP_EXISTS',
  'GROUP_NOT_FOUND',
  'REPO_EXISTS',
  'REPO_NOT_FOUND',
  'PATH_NOT_FOUND',
  'MANIFEST_INVALID',
  'AUTH_REQUIRED',
]);

/** 2 = refused (a rule said no), 1 = something broke. */
export function exitCodeFor(code: ErrorCode): 1 | 2 {
  return REFUSALS.has(code) ? 2 : 1;
}

export class GittyupError extends Error {
  readonly code: ErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'GittyupError';
    this.code = code;
    if (details) this.details = details;
  }
}

export interface ErrorBody {
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

export function toErrorBody(err: unknown): ErrorBody {
  if (err instanceof GittyupError) {
    return err.details
      ? { code: err.code, message: err.message, details: err.details }
      : { code: err.code, message: err.message };
  }
  return { code: 'INTERNAL', message: err instanceof Error ? err.message : String(err) };
}
