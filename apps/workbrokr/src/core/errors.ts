export type ErrorCode =
  | 'MANIFEST_NOT_FOUND'
  | 'MANIFEST_INVALID'
  | 'AREA_UNKNOWN'
  | 'TASK_INVALID'
  | 'TYPE_UNKNOWN'
  | 'MODE_UNKNOWN'
  | 'MODE_MISMATCH'
  | 'SCOPE_REQUIRES_TASK'
  | 'SCOPE_OUTSIDE_AREA'
  | 'MAIN_CHECKOUT'
  | 'WORKTREE_INVALID'
  | 'PROTECTED_BRANCH'
  | 'EFFORT_OPEN'
  | 'EFFORT_NOT_FOUND'
  | 'SCOPE_CONFLICT'
  | 'COMMONS_LOCKED'
  | 'NO_FREE_SLOT'
  | 'LEASE_NOT_FOUND'
  | 'PORT_RANGE_TAKEN'
  | 'SYNC_CONFLICT'
  | 'DIRTY_WORKTREE'
  | 'UNPUSHED'
  | 'HEALTH_TIMEOUT'
  | 'SERVICE_FAILED'
  | 'STORYBROKR_FAILED'
  | 'GIT_FAILED'
  | 'PUSH_REJECTED'
  | 'PRITTY_FAILED'
  | 'PR_CLOSED'
  | 'INTERNAL';

const REFUSALS = new Set<ErrorCode>([
  'MANIFEST_INVALID',
  'AREA_UNKNOWN',
  'TASK_INVALID',
  'TYPE_UNKNOWN',
  'MODE_UNKNOWN',
  'MODE_MISMATCH',
  'SCOPE_REQUIRES_TASK',
  'SCOPE_OUTSIDE_AREA',
  'MAIN_CHECKOUT',
  'WORKTREE_INVALID',
  'PROTECTED_BRANCH',
  'EFFORT_OPEN',
  'EFFORT_NOT_FOUND',
  'SCOPE_CONFLICT',
  'COMMONS_LOCKED',
  'NO_FREE_SLOT',
  'LEASE_NOT_FOUND',
  'PORT_RANGE_TAKEN',
  'SYNC_CONFLICT',
  'DIRTY_WORKTREE',
  'UNPUSHED',
  'PR_CLOSED',
]);

/** 2 = refused (a rule said no), 1 = something broke. */
export function exitCodeFor(code: ErrorCode): 1 | 2 {
  return REFUSALS.has(code) ? 2 : 1;
}

export class WorkkitError extends Error {
  readonly code: ErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'WorkkitError';
    this.code = code;
    if (details) this.details = details;
  }
}

export interface ErrorBody {
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

/** Shape every surface (CLI --json, MCP) returns for a failure. */
export function toErrorBody(err: unknown): ErrorBody {
  if (err instanceof WorkkitError) {
    return err.details
      ? { code: err.code, message: err.message, details: err.details }
      : { code: err.code, message: err.message };
  }
  return { code: 'INTERNAL', message: err instanceof Error ? err.message : String(err) };
}
