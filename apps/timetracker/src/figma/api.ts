/**
 * Minimal Figma REST client (fetch-based, zero deps). Only the endpoints the
 * tracker needs: version/comment polling, team/project file discovery, and
 * webhook management (v2). Auth is a personal access token via X-FIGMA-TOKEN.
 *
 * Rate limits: Figma throttles per token; on 429 the client honours
 * Retry-After (falling back to exponential backoff) up to MAX_RETRIES, then
 * throws — the poller treats a throw as "try again next tick", so a throttled
 * poll degrades to latency, never to crash or data loss (events re-fetch).
 */
import { log } from '../logger.js';

const MAX_RETRIES = 3;

export class FigmaApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'FigmaApiError';
  }
}

export interface FigmaApiUser {
  id: string;
  handle: string;
}

export interface FigmaVersion {
  id: string;
  created_at: string;
  label?: string;
  description?: string;
  user: FigmaApiUser;
}

export interface FigmaComment {
  id: string;
  created_at: string;
  user: FigmaApiUser;
  message?: string;
  parent_id?: string;
}

export interface FigmaProject {
  id: string;
  name: string;
}

export interface FigmaProjectFile {
  key: string;
  name: string;
  last_modified?: string;
}

export interface FigmaWebhook {
  id: string;
  event_type: string;
  endpoint: string;
  status?: string;
}

/** The five team-scoped webhook event types the tracker subscribes to (§2). */
export const WEBHOOK_EVENT_TYPES = [
  'FILE_UPDATE',
  'FILE_VERSION_UPDATE',
  'FILE_COMMENT',
  'LIBRARY_PUBLISH',
  'FILE_DELETE',
] as const;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class FigmaApi {
  constructor(
    private readonly token: string,
    private readonly baseUrl = 'https://api.figma.com',
  ) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: { 'X-FIGMA-TOKEN': this.token, 'Content-Type': 'application/json' },
      });
      if (res.status === 429 && attempt < MAX_RETRIES) {
        const retryAfter = Number(res.headers.get('Retry-After'));
        const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : 2 ** attempt * 1000;
        log.warn(`figma api throttled (429) — retrying ${path} in ${waitMs}ms`);
        await sleep(waitMs);
        continue;
      }
      if (!res.ok) {
        throw new FigmaApiError(`figma api ${res.status} on ${path}`, res.status);
      }
      return (await res.json()) as T;
    }
  }

  /** The token's own identity — used to verify setup and label the sentinel. */
  getMe(): Promise<FigmaApiUser & { email?: string }> {
    return this.request('/v1/me');
  }

  async getTeamProjects(teamId: string): Promise<FigmaProject[]> {
    const r = await this.request<{ projects: FigmaProject[] }>(`/v1/teams/${teamId}/projects`);
    return r.projects;
  }

  async getProjectFiles(projectId: string): Promise<FigmaProjectFile[]> {
    const r = await this.request<{ files: FigmaProjectFile[] }>(`/v1/projects/${projectId}/files`);
    return r.files;
  }

  /** Version history, newest first (who saved, when) — the polling backbone. */
  async getFileVersions(fileKey: string): Promise<FigmaVersion[]> {
    const r = await this.request<{ versions: FigmaVersion[] }>(`/v1/files/${fileKey}/versions`);
    return r.versions;
  }

  async getFileComments(fileKey: string): Promise<FigmaComment[]> {
    const r = await this.request<{ comments: FigmaComment[] }>(`/v1/files/${fileKey}/comments`);
    return r.comments;
  }

  // ── webhooks (v2) — Professional+ plans only ─────────────────────────

  async listTeamWebhooks(teamId: string): Promise<FigmaWebhook[]> {
    const r = await this.request<{ webhooks: FigmaWebhook[] }>(`/v2/teams/${teamId}/webhooks`);
    return r.webhooks;
  }

  createWebhook(opts: {
    teamId: string;
    eventType: string;
    endpoint: string;
    passcode: string;
    description?: string;
  }): Promise<{ id: string }> {
    return this.request('/v2/webhooks', {
      method: 'POST',
      body: JSON.stringify({
        event_type: opts.eventType,
        team_id: opts.teamId,
        endpoint: opts.endpoint,
        passcode: opts.passcode,
        description: opts.description ?? 'timetracker figma tracker',
      }),
    });
  }

  async deleteWebhook(webhookId: string): Promise<void> {
    await this.request(`/v2/webhooks/${webhookId}`, { method: 'DELETE' });
  }

  /**
   * Idempotent startup registration (§6): create any of the five event-type
   * webhooks that don't already point at `endpoint`. Returns created count.
   */
  async ensureTeamWebhooks(teamId: string, endpoint: string, passcode: string): Promise<number> {
    const existing = await this.listTeamWebhooks(teamId);
    const have = new Set(
      existing.filter((w) => w.endpoint === endpoint).map((w) => w.event_type),
    );
    let created = 0;
    for (const eventType of WEBHOOK_EVENT_TYPES) {
      if (have.has(eventType)) continue;
      await this.createWebhook({ teamId, eventType, endpoint, passcode });
      created++;
    }
    return created;
  }
}
