export type ErrorCode =
  | 'HOST_NOT_FOUND'
  | 'HOST_INVALID'
  | 'COMPONENT_NOT_FOUND'
  | 'INSTANCE_CAP_REACHED'
  | 'NO_FREE_PORT'
  | 'BOOT_FAILED'
  | 'BOOT_TIMEOUT'
  | 'INSTANCE_NOT_FOUND'
  | 'DAEMON_UNAVAILABLE'
  | 'INTERNAL';

const STATUS: Record<ErrorCode, number> = {
  HOST_NOT_FOUND: 404,
  HOST_INVALID: 422,
  COMPONENT_NOT_FOUND: 404,
  INSTANCE_CAP_REACHED: 429,
  NO_FREE_PORT: 503,
  BOOT_FAILED: 502,
  BOOT_TIMEOUT: 504,
  INSTANCE_NOT_FOUND: 404,
  DAEMON_UNAVAILABLE: 503,
  INTERNAL: 500,
};

export function httpStatusFor(code: ErrorCode): number {
  return STATUS[code];
}

export class StorybrokrError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly logTail?: string[];

  constructor(code: ErrorCode, message: string, logTail?: string[]) {
    super(message);
    this.name = 'StorybrokrError';
    this.code = code;
    this.status = STATUS[code];
    if (logTail) this.logTail = logTail;
  }
}

export interface ErrorBody {
  code: ErrorCode;
  message: string;
  logTail?: string[];
}

/** Shape every surface (HTTP, CLI --json, MCP) returns for a failure. */
export function toErrorBody(err: unknown): ErrorBody {
  if (err instanceof StorybrokrError) {
    return err.logTail
      ? { code: err.code, message: err.message, logTail: err.logTail }
      : { code: err.code, message: err.message };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { code: 'INTERNAL', message };
}
