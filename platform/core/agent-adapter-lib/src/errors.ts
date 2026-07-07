/**
 * Typed adapter errors.
 *
 * Per slice 13b: every adapter classifies upstream failures into one of
 * these subclasses before throwing. Consumers (orchestrator, TUI,
 * runtime-fallback layer in slice 13c) `instanceof`-check to drive
 * distinct behavior:
 *
 *   - AuthError       → invalid/missing/expired credentials. Action: re-auth.
 *   - BillingError    → insufficient credits, plan limits hit. Action: top up.
 *   - RateLimitError  → too many requests. Action: backoff + retry, or
 *                       fall through to next provider in accept-list.
 *   - ConfigError     → model not found, bad provider config. Action: fix
 *                       catalog (rare in normal operation).
 *   - NetworkError    → connection issues, timeouts, DNS. Action: retry
 *                       (transient) or check connectivity.
 *   - ProviderError   → unclassified upstream failure. Default for anything
 *                       the classifier doesn't recognize.
 *
 * Each subclass extends AdapterError, which extends Error. The hierarchy
 * is open: future error types (e.g. ContentFilterError when a model
 * refuses) get added by extending AdapterError. Consumers that don't
 * recognize a new subclass fall through to instanceof AdapterError.
 *
 * The classify*() helpers turn provider-specific error shapes into the
 * right subclass. Adapters call them inside try/catch around their
 * upstream calls.
 */

/** Base class for every classified adapter error. Extends Error so
 *  existing string-message handling still works for callers that don't
 *  yet inspect the type. */
export class AdapterError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = 'AdapterError';
    if (options?.cause !== undefined) {
      // ES2022 Error.cause; safe to set via property even on older
      // targets that lack the constructor option.
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

/** Credentials are missing, expired, revoked, or syntactically invalid.
 *  Maps to HTTP 401 from most providers. Action: re-authenticate. */
export class AuthError extends AdapterError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'AuthError';
  }
}

/** Account-level billing/quota issues. Map to HTTP 400 or 402 with
 *  body messages like "Your credit balance is too low" (Anthropic) or
 *  "You exceeded your current quota" (OpenAI). Distinct from
 *  RateLimitError because billing won't recover via backoff — needs
 *  human action (top up credits, change plan). */
export class BillingError extends AdapterError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'BillingError';
  }
}

/** Too many requests — either per-second rate limit or per-day token
 *  limit. Maps to HTTP 429. Distinct from BillingError because backoff
 *  + retry is the right action; the request will eventually succeed. */
export class RateLimitError extends AdapterError {
  /** Suggested wait time in seconds before retrying, when the provider
   *  returns a Retry-After header or equivalent. Optional; consumers
   *  that don't see it should pick their own backoff. */
  public readonly retryAfterSeconds?: number;

  constructor(message: string, options?: { cause?: unknown; retryAfterSeconds?: number }) {
    super(message, { cause: options?.cause });
    this.name = 'RateLimitError';
    if (options?.retryAfterSeconds !== undefined) {
      this.retryAfterSeconds = options.retryAfterSeconds;
    }
  }
}

/** Catalog-level configuration error: model not found, invalid model
 *  id for the provider, opencode provider not configured, etc. Maps to
 *  HTTP 404 or "ProviderModelNotFoundError" / "Model not found" body
 *  patterns. Action: fix the catalog or registry. */
export class ConfigError extends AdapterError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ConfigError';
  }
}

/** Network-layer failure: DNS, TCP, TLS, timeout, connection reset.
 *  Distinct from ProviderError (which the server returned) because
 *  the request never made it to the upstream. Action: retry or check
 *  connectivity. */
export class NetworkError extends AdapterError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'NetworkError';
  }
}

/** Catch-all for upstream errors the classifier doesn't recognize.
 *  Includes 5xx, malformed responses, and provider-specific errors
 *  outside the buckets above. Consumers should treat as terminal
 *  (don't retry) — unlike NetworkError or RateLimitError which signal
 *  "try again". */
export class ProviderError extends AdapterError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ProviderError';
  }
}

/**
 * Classify an upstream HTTP error into the right subclass based on
 * status code + response-body fingerprints. Used by HTTP-level adapters
 * (OpenAi, Copilot, Bedrock when it lands).
 *
 * Heuristics:
 *   - 401 → AuthError ("invalid_api_key", "unauthorized")
 *   - 402 → BillingError ("payment_required")
 *   - 400 with body containing "credit" / "balance" / "quota" → BillingError
 *   - 400 with body containing "model" + ("not found" | "does not exist") → ConfigError
 *   - 404 → ConfigError
 *   - 429 → RateLimitError (parses Retry-After if present)
 *   - 500-599 → ProviderError
 *   - everything else → ProviderError (terminal)
 */
export function classifyHttpError(args: {
  status: number;
  body?: string;
  retryAfter?: string | null;
  cause?: unknown;
  context?: string;
}): AdapterError {
  const { status, body = '', retryAfter, cause, context } = args;
  const ctxPrefix = context ? `${context}: ` : '';
  const tail = body.slice(0, 300);
  const lower = body.toLowerCase();

  if (status === 401) {
    return new AuthError(`${ctxPrefix}auth failed (401): ${tail}`, { cause });
  }
  if (status === 402) {
    return new BillingError(`${ctxPrefix}billing failed (402): ${tail}`, { cause });
  }
  if (status === 400) {
    if (
      lower.includes('credit') ||
      lower.includes('balance') ||
      lower.includes('quota') ||
      lower.includes('insufficient')
    ) {
      return new BillingError(`${ctxPrefix}billing failed (400): ${tail}`, { cause });
    }
    if (
      lower.includes('model') &&
      (lower.includes('not found') ||
        lower.includes('does not exist') ||
        lower.includes('not_found'))
    ) {
      return new ConfigError(`${ctxPrefix}config error (400): ${tail}`, { cause });
    }
    return new ProviderError(`${ctxPrefix}upstream rejected (400): ${tail}`, { cause });
  }
  if (status === 404) {
    return new ConfigError(`${ctxPrefix}not found (404): ${tail}`, { cause });
  }
  if (status === 429) {
    const retryAfterSeconds = parseRetryAfter(retryAfter);
    return new RateLimitError(`${ctxPrefix}rate-limited (429): ${tail}`, {
      cause,
      ...(retryAfterSeconds !== undefined ? { retryAfterSeconds } : {}),
    });
  }
  if (status >= 500 && status < 600) {
    return new ProviderError(`${ctxPrefix}upstream error (${status}): ${tail}`, { cause });
  }
  return new ProviderError(`${ctxPrefix}upstream returned ${status}: ${tail}`, { cause });
}

/**
 * Classify a network-layer error (fetch threw before we got a response).
 * Most fetch failures land here — DNS, TCP refused, TLS failure, abort.
 */
export function classifyNetworkError(err: unknown, context?: string): NetworkError {
  const message = err instanceof Error ? err.message : String(err);
  const ctxPrefix = context ? `${context}: ` : '';
  return new NetworkError(`${ctxPrefix}network error: ${message}`, { cause: err });
}

// ---------------------------------------------------------------------------
// Phase A additions — new surface errors (additive; existing classes unchanged)
// ---------------------------------------------------------------------------

/**
 * The provided workdir is not inside a git working tree.
 *
 * Thrown by createAgent() when `git -C <workdir> rev-parse
 * --is-inside-work-tree` returns a non-zero exit code.
 *
 * Remediation: run `git init` in the target directory, or pass a path that
 * is already a valid git working tree (bare repos and non-git directories
 * are not accepted).
 */
export class WorkdirNotARepoError extends AdapterError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'WorkdirNotARepoError';
  }
}

/**
 * A required CLI binary could not be found on PATH or at the given path.
 *
 * Thrown by resolveBinary() in child-process.ts when the binary is absent.
 *
 * Remediation: install the tool (e.g. `npm i -g @anthropic-ai/claude-code`)
 * or pass an explicit `binaryPath` in the spec to override PATH resolution.
 */
export class BinaryNotFoundError extends AdapterError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'BinaryNotFoundError';
  }
}

/**
 * A required credential could not be resolved for the given provider.
 *
 * Thrown at createAgent() time (not mid-stream) when a CLI adapter that
 * sandboxes $HOME/TMPDIR cannot reach the tool's own credential store and
 * the CredentialBroker returned nothing usable.
 *
 * Remediation: authenticate with the underlying tool first (e.g. `claude
 * /login`, `gh auth login`), then ensure the CredentialBroker is wired up
 * to propagate the resolved token to the adapter via containerEnv.
 */
export class MissingCredentialError extends AdapterError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'MissingCredentialError';
  }
}

/**
 * The requested spec type does not support a capability that the call
 * requires.
 *
 * Thrown at createAgent() time (PRD §13 D3: fail fast at construction).
 * Hosts that want graceful degradation should check agent.capabilities
 * before constructing; the lib never silently drops user input.
 *
 * Remediation: choose an adapter type that supports the required capability,
 * or remove the capability requirement from your invocation.
 */
export class CapabilityMismatchError extends AdapterError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'CapabilityMismatchError';
  }
}

function parseRetryAfter(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  // Retry-After can be either delta-seconds (integer) or HTTP date
  const asNum = Number(trimmed);
  if (Number.isFinite(asNum) && asNum >= 0) return asNum;
  const asDate = Date.parse(trimmed);
  if (!Number.isNaN(asDate)) {
    const delta = Math.max(0, Math.round((asDate - Date.now()) / 1000));
    return delta;
  }
  return undefined;
}
