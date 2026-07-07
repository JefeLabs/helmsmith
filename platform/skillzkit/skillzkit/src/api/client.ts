/**
 * Typed HTTP client for the skillzkit REST API. Used by the TUI in
 * team mode to fetch the remote catalog instead of the bundled
 * catalog.json. Lives in `lib/api/` rather than `tui/` so other
 * consumers (a future remote-mode CLI, an integration test, etc.)
 * can use the same typed surface.
 *
 * Auth model: read endpoints are anonymous in this first cut — no
 * Bearer token sent. The decrypted API key is only used for write
 * (contribute) operations, where the PIN prompt is already
 * acceptable friction. The client accepts an `apiKey` constructor
 * option so future read-side auth can slot in without breaking
 * callers.
 *
 * Network model: all calls use the global `fetch` (Bun + Node 22+).
 * A 10s default request timeout via AbortSignal prevents the TUI
 * from hanging indefinitely on a misconfigured apiUrl. Callers can
 * override via the `signal` option per-request.
 */

import type {
  ApiError,
  CatalogIndex,
  Command,
  ContributionResponse,
  CreateContributionRequest,
  HealthResponse,
  ListCommandsResponse,
  ListSkillsResponse,
  ListWorkflowsResponse,
  SearchResponse,
  Skill,
  Workflow,
} from './contracts.js';

export interface ClientOptions {
  /** Base URL of the API, e.g. "https://skillz.example.com". No trailing slash. */
  baseUrl: string;
  /** Optional bearer token for authenticated endpoints (writes). */
  apiKey?: string;
  /** Override the default request timeout (10s). 0 disables. */
  timeoutMs?: number;
}

export interface ListCommandsFilters {
  kind?: 'command' | 'workflow' | 'context';
  prefix?: string;
  tag?: string;
  limit?: number;
  offset?: number;
}

export class SkillzkitApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ApiError['code'] | 'network_error',
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'SkillzkitApiError';
  }
}

export class SkillzkitApiClient {
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly timeoutMs: number;

  constructor(options: ClientOptions) {
    // Strip trailing slash so we can concatenate cleanly with leading-slash paths
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  /* ── read endpoints ──────────────────────────────────────────── */

  getHealth(): Promise<HealthResponse> {
    return this.get('/api/v1/health');
  }

  getCatalog(): Promise<CatalogIndex> {
    return this.get('/api/v1/catalog');
  }

  listCommands(filters: ListCommandsFilters = {}): Promise<ListCommandsResponse> {
    const params = new URLSearchParams();
    if (filters.kind) params.set('kind', filters.kind);
    if (filters.prefix) params.set('prefix', filters.prefix);
    if (filters.tag) params.set('tag', filters.tag);
    if (filters.limit !== undefined) params.set('limit', String(filters.limit));
    if (filters.offset !== undefined) params.set('offset', String(filters.offset));
    const qs = params.toString();
    return this.get(`/api/v1/commands${qs ? `?${qs}` : ''}`);
  }

  getCommand(slug: string): Promise<Command> {
    return this.get(`/api/v1/commands/${encodeURIComponent(slug)}`);
  }

  listSkills(tag?: string): Promise<ListSkillsResponse> {
    const qs = tag ? `?tag=${encodeURIComponent(tag)}` : '';
    return this.get(`/api/v1/skills${qs}`);
  }

  getSkill(name: string): Promise<Skill> {
    return this.get(`/api/v1/skills/${encodeURIComponent(name)}`);
  }

  listWorkflows(filters: { tag?: string; domain?: string } = {}): Promise<ListWorkflowsResponse> {
    const params = new URLSearchParams();
    if (filters.tag) params.set('tag', filters.tag);
    if (filters.domain) params.set('domain', filters.domain);
    const qs = params.toString();
    return this.get(`/api/v1/workflows${qs ? `?${qs}` : ''}`);
  }

  getWorkflow(qualifiedName: string): Promise<Workflow> {
    return this.get(`/api/v1/workflows/${encodeURIComponent(qualifiedName)}`);
  }

  search(query: string, limit?: number): Promise<SearchResponse> {
    const params = new URLSearchParams({ q: query });
    if (limit !== undefined) params.set('limit', String(limit));
    return this.get(`/api/v1/search?${params.toString()}`);
  }

  /* ── write endpoints (contribute) ───────────────────────────── */

  /**
   * Submit a new contribution. Requires the client to be configured
   * with an apiKey - the server's auth verifier rejects requests
   * without a Bearer token.
   *
   * Throws SkillzkitApiError on:
   *   - 401 (no/invalid token) - code "unauthorized"
   *   - 403 (different author owns this slug) - code "author_mismatch"
   *   - 409 (this version already exists) - code "slug_conflict"
   *   - 422 (layer-1/2/3 validation flagged the bundle) - code
   *     "validation_failed", with findings on err.details.findings
   *
   * On success, returns the ContributionResponse with the assigned
   * version, content-addressable id, and recorded author.
   */
  createContribution(req: CreateContributionRequest): Promise<ContributionResponse> {
    return this.post('/api/v1/contributions', req);
  }

  /**
   * Look up a contribution by content-addressable id (the
   * `<kind>:<slug>@<version>` form returned by createContribution).
   * Read endpoint - no auth required.
   *
   * Throws SkillzkitApiError on 404 (id format is malformed or the
   * version doesn't exist).
   */
  getContribution(id: string): Promise<ContributionResponse> {
    return this.get(`/api/v1/contributions/${encodeURIComponent(id)}`);
  }

  /**
   * Promote a stored contribution to "live" - updates the catalog
   * index pointer for that slug to this version. Requires apiKey
   * (typically a maintainer/admin token, though the API doesn't
   * enforce that yet).
   *
   * Throws SkillzkitApiError on 404 (no such version) or 401.
   */
  promoteContribution(id: string): Promise<{ id: string; promoted: true }> {
    return this.post(`/api/v1/contributions/${encodeURIComponent(id)}/promote`);
  }

  /* ── internal ───────────────────────────────────────────────── */

  /**
   * GET helper with timeout, JSON parsing, and error normalization.
   * On non-2xx, attempts to parse an ApiError envelope and throws
   * SkillzkitApiError with the body's code+message; on parse failure
   * or network error, throws with a synthetic "network_error" code
   * so callers can distinguish reachability problems from API
   * validation failures.
   */
  private get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  /**
   * POST helper - same response handling as get(), with an optional
   * JSON body. Used by the contribute + promote endpoints.
   */
  private post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  /**
   * Shared HTTP request implementation. Same error-normalization +
   * timeout semantics across all methods so the surface area is
   * uniform.
   */
  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      Accept: 'application/json',
    };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    const signal = this.timeoutMs > 0 ? AbortSignal.timeout(this.timeoutMs) : undefined;

    const init: RequestInit = { method, headers, signal };
    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }

    let res: Response;
    try {
      res = await fetch(url, init);
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      throw new SkillzkitApiError(0, 'network_error', `Could not reach ${url}: ${msg}`);
    }

    if (!res.ok) {
      let errBody: ApiError | undefined;
      try {
        errBody = (await res.json()) as ApiError;
      } catch {
        // Non-JSON error body - fall through to a synthetic envelope.
      }
      throw new SkillzkitApiError(
        res.status,
        errBody?.code ?? 'internal_error',
        errBody?.message ?? `${res.status} ${res.statusText} from ${url}`,
        errBody?.details,
      );
    }

    return (await res.json()) as T;
  }
}
