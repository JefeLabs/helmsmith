/**
 * Hono app for the skillzkit API. Runtime-agnostic — the same `app`
 * is consumed by Bun.serve (server/bun.ts), AWS Lambda
 * (server/lambda.ts), and (future) other adapters. Storage is
 * injected so a single app instance works against memory, fs, S3,
 * etc. without rebuilding.
 *
 * Endpoints in this first cut are READ-only (task #3). Contribution
 * endpoints (POST /contributions, etc.) land in task #5 and will be
 * mounted conditionally when storage is writable.
 *
 * Path encoding note: command slugs contain colons (e.g.
 * `product:strategy:scaffold`). Per RFC 3986, colons are reserved in
 * path segments and clients SHOULD URL-encode them as `%3A`. Hono's
 * :slug param auto-decodes, so handlers receive the natural slug.
 */

import { Hono } from 'hono';
import { type AuthVerifier, extractBearerToken, NoAuthVerifier } from '../api/auth.js';
import type {
  ApiError,
  CommandSummary,
  ContributionKind,
  CreateContributionRequest,
  HealthResponse,
  SkillSummary,
  WorkflowSummary,
} from '../api/contracts.js';
import { submitContribution } from '../api/contribute.js';
import type { CatalogReadStorage, CatalogStorage } from '../api/storage/interface.js';
import type { ContributionReviewer } from '../api/validation.js';
import { loadCoreTags } from '../tags.js';

export interface AppOptions {
  storage: CatalogReadStorage;
  /** Reflect storage writability in /health for client diagnostics.
   *  When true, the storage is also expected to satisfy CatalogStorage
   *  (read+write) and contribute endpoints get mounted. */
  writable?: boolean;
  /** Bearer-token verifier for contribute endpoints. Defaults to
   *  NoAuthVerifier (every request is unauthenticated). Required for
   *  any deploy that exposes write endpoints. */
  authVerifier?: AuthVerifier;
  /** Optional layer-3 reviewer for contributions. Disabled by default. */
  reviewer?: ContributionReviewer;
  /** Path to the TAGS.md file used for the two-tier tag check during
   *  layer-1 validation. Optional - if missing, all tags are reported
   *  as extensions. */
  packageRoot?: string;
}

export function createApp(options: AppOptions): Hono {
  const {
    storage,
    writable = false,
    authVerifier = new NoAuthVerifier(),
    reviewer,
    packageRoot,
  } = options;
  const coreTags = packageRoot ? loadCoreTags(packageRoot) : new Set<string>();
  const app = new Hono();

  // ── health ─────────────────────────────────────────────────────
  app.get('/api/v1/health', async (c) => {
    const index = await storage.getIndex();
    const body: HealthResponse & { writable: boolean } = {
      status: 'ok',
      version: index.packageVersion,
      catalogGeneratedAt: index.generatedAt,
      itemCounts: {
        // Match CLI semantics — "commands" means kind=command only,
        // not the raw catalog.commands array (which also includes
        // workflow-kind and context-kind entries).
        commands: index.commands.filter((c) => c.kind === 'command').length,
        skills: index.skills.length,
        workflows: index.workflows.length,
      },
      writable,
    };
    return c.json(body);
  });

  // ── full catalog index ────────────────────────────────────────
  app.get('/api/v1/catalog', async (c) => {
    return c.json(await storage.getIndex());
  });

  // ── commands list ─────────────────────────────────────────────
  // Filters: ?kind=command|workflow|context, ?prefix=core:tools:,
  //          ?tag=accessibility, ?limit=<n>, ?offset=<n>
  app.get('/api/v1/commands', async (c) => {
    const index = await storage.getIndex();
    let commands: CommandSummary[] = index.commands;

    const kind = c.req.query('kind');
    if (kind) commands = commands.filter((cmd) => cmd.kind === kind);

    const prefix = c.req.query('prefix');
    if (prefix) commands = commands.filter((cmd) => cmd.slug.startsWith(prefix));

    const tag = c.req.query('tag');
    if (tag) commands = commands.filter((cmd) => (cmd.tags ?? []).includes(tag));

    const total = commands.length;
    const offset = Number.parseInt(c.req.query('offset') ?? '0', 10);
    const limit = c.req.query('limit');
    if (limit) {
      const n = Number.parseInt(limit, 10);
      commands = commands.slice(offset, offset + n);
    } else if (offset > 0) {
      commands = commands.slice(offset);
    }

    return c.json({ commands, total });
  });

  app.get('/api/v1/commands/:slug', async (c) => {
    const slug = c.req.param('slug');
    const cmd = await storage.getCommand(slug);
    if (!cmd) {
      return notFound(c, 'command', slug);
    }
    return c.json(cmd);
  });

  // ── skills ────────────────────────────────────────────────────
  app.get('/api/v1/skills', async (c) => {
    const index = await storage.getIndex();
    let skills: SkillSummary[] = index.skills;
    const tag = c.req.query('tag');
    if (tag) skills = skills.filter((s) => (s.tags ?? []).includes(tag));
    return c.json({ skills, total: skills.length });
  });

  app.get('/api/v1/skills/:name', async (c) => {
    const name = c.req.param('name');
    const skill = await storage.getSkill(name);
    if (!skill) return notFound(c, 'skill', name);
    return c.json(skill);
  });

  // ── workflows ─────────────────────────────────────────────────
  app.get('/api/v1/workflows', async (c) => {
    const index = await storage.getIndex();
    let workflows: WorkflowSummary[] = index.workflows;
    const tag = c.req.query('tag');
    if (tag) workflows = workflows.filter((w) => (w.tags ?? []).includes(tag));
    const domain = c.req.query('domain');
    if (domain) workflows = workflows.filter((w) => w.domain === domain);
    return c.json({ workflows, total: workflows.length });
  });

  app.get('/api/v1/workflows/:qualifiedName', async (c) => {
    const qualifiedName = c.req.param('qualifiedName');
    const wf = await storage.getWorkflow(qualifiedName);
    if (!wf) return notFound(c, 'workflow', qualifiedName);
    return c.json(wf);
  });

  // ── search ────────────────────────────────────────────────────
  // Same matching logic as `skillzkit search`: substring across slug/
  // name, description, and tags. Limit caps each kind independently
  // so a popular query returns a balanced result set.
  app.get('/api/v1/search', async (c) => {
    const q = (c.req.query('q') ?? '').toLowerCase();
    if (!q) {
      return apiError(c, 400, 'validation_failed', 'Missing required query parameter `q`');
    }
    const limit = Number.parseInt(c.req.query('limit') ?? '10', 10);
    const index = await storage.getIndex();
    const matches = (s: string) => s.toLowerCase().includes(q);
    const matchesTag = (tags: string[] | undefined) => (tags ?? []).some(matches);

    const commands = index.commands.filter(
      (cmd) =>
        cmd.kind === 'command' &&
        (matches(cmd.slug) || matches(cmd.description) || matchesTag(cmd.tags)),
    );
    const skills = index.skills.filter(
      (s) => matches(s.name) || matches(s.description) || matchesTag(s.tags),
    );
    const workflows = index.workflows.filter(
      (w) => matches(w.qualifiedName) || matches(w.description) || matchesTag(w.tags),
    );

    return c.json({
      query: q,
      commands: commands.slice(0, limit),
      skills: skills.slice(0, limit),
      workflows: workflows.slice(0, limit),
    });
  });

  // ── tags ──────────────────────────────────────────────────────
  // Aggregate tag counts across all artifacts. Mirrors the CLI's
  // `skillzkit tags`. Doesn't distinguish core vs extension at the
  // API layer — clients can fetch TAGS.md via /catalog metadata or
  // hardcode their own classification if needed.
  app.get('/api/v1/tags', async (c) => {
    const index = await storage.getIndex();
    const counts = new Map<string, number>();
    const bump = (tag: string) => counts.set(tag, (counts.get(tag) ?? 0) + 1);
    for (const cmd of index.commands) {
      if (cmd.kind === 'context') continue;
      for (const tag of cmd.tags ?? []) bump(tag);
    }
    for (const s of index.skills) {
      for (const tag of s.tags ?? []) bump(tag);
    }
    const tags = Array.from(counts.entries())
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
    return c.json({ tags, total: tags.length });
  });

  // ── contribute endpoints (only when storage is writable) ──────
  if (writable) {
    const writableStorage = storage as CatalogStorage;

    // POST /api/v1/contributions - submit a new artifact bundle
    app.post('/api/v1/contributions', async (c) => {
      const token = extractBearerToken(c.req.header('authorization'));
      if (!token) {
        return apiError(c, 401, 'unauthorized', 'Missing Bearer token');
      }
      const author = await authVerifier.verifyToken(token);
      if (!author) {
        return apiError(c, 401, 'unauthorized', 'Invalid or expired token');
      }

      let req: CreateContributionRequest;
      try {
        req = (await c.req.json()) as CreateContributionRequest;
      } catch {
        return apiError(c, 400, 'validation_failed', 'Request body is not valid JSON');
      }
      if (!req || typeof req !== 'object') {
        return apiError(c, 400, 'validation_failed', 'Request body must be a JSON object');
      }
      if (!req.kind || !req.slug || !Array.isArray(req.files)) {
        return apiError(
          c,
          400,
          'validation_failed',
          'Request must include `kind`, `slug`, and `files[]`',
        );
      }

      const index = await storage.getIndex();
      const result = await submitContribution(req, {
        storage: writableStorage,
        author,
        reviewer,
        catalog: index,
        coreTags,
      });

      if (result.kind === 'validation_failed') {
        return c.json(
          {
            code: 'validation_failed',
            message: 'One or more validation rules failed',
            details: { findings: result.findings },
          },
          422,
        );
      }
      if (result.kind === 'author_mismatch') {
        return c.json(
          {
            code: 'author_mismatch',
            message: `Slug ${result.slug} is owned by another author`,
            details: { ownerAuthorId: result.ownerAuthorId },
          },
          403,
        );
      }
      if (result.kind === 'version_conflict') {
        return c.json(
          {
            code: 'slug_conflict',
            message: `${result.slug}@${result.version} already exists`,
            details: result,
          },
          409,
        );
      }
      // accepted - return 201 with Location header
      c.header('Location', `/api/v1/contributions/${encodeURIComponent(result.response.id)}`);
      return c.json(result.response, 201);
    });

    // GET /api/v1/contributions/:id - look up a contribution by id
    // Id format: <kind>:<slug>@<version> - content-addressable, no
    // separate state store needed for the sync flow.
    app.get('/api/v1/contributions/:id', async (c) => {
      const id = c.req.param('id');
      const parsed = parseContributionId(id);
      if (!parsed) {
        return apiError(c, 400, 'validation_failed', `Malformed contribution id: ${id}`);
      }

      const versions = await listVersionsByKind(writableStorage, parsed.kind, parsed.slug);
      const versionEntry = versions.find((v) => v.version === parsed.version);
      if (!versionEntry) {
        return apiError(c, 404, 'not_found', `Contribution ${id} not found`);
      }
      return c.json({
        id,
        slug: parsed.slug,
        kind: parsed.kind,
        version: parsed.version,
        status: versionEntry.promoted ? 'promoted' : 'accepted',
        promoted: versionEntry.promoted,
        author: versionEntry.author,
        findings: [],
        createdAt: versionEntry.createdAt,
      });
    });

    // POST /api/v1/contributions/:id/promote - move the index pointer
    app.post('/api/v1/contributions/:id/promote', async (c) => {
      const token = extractBearerToken(c.req.header('authorization'));
      if (!token) {
        return apiError(c, 401, 'unauthorized', 'Missing Bearer token');
      }
      const author = await authVerifier.verifyToken(token);
      if (!author) {
        return apiError(c, 401, 'unauthorized', 'Invalid or expired token');
      }

      const id = c.req.param('id');
      const parsed = parseContributionId(id);
      if (!parsed) {
        return apiError(c, 400, 'validation_failed', `Malformed contribution id: ${id}`);
      }

      try {
        if (parsed.kind === 'command') {
          await writableStorage.promoteCommand(parsed.slug, parsed.version);
        } else if (parsed.kind === 'skill') {
          await writableStorage.promoteSkill(parsed.slug, parsed.version);
        } else {
          await writableStorage.promoteWorkflow(parsed.slug, parsed.version);
        }
      } catch (err) {
        return apiError(
          c,
          404,
          'not_found',
          (err as Error).message ?? 'Promotion target not found',
        );
      }
      return c.json({ id, status: 'promoted', promoted: true }, 200);
    });
  }

  // ── 404 fallback ──────────────────────────────────────────────
  app.notFound((c) =>
    apiError(c, 404, 'not_found', `No handler for ${c.req.method} ${c.req.path}`),
  );

  // ── error handler ─────────────────────────────────────────────
  app.onError((err, c) => {
    console.error(`[skillzkit-api] ${err.message}\n${err.stack ?? ''}`);
    return apiError(c, 500, 'internal_error', err.message);
  });

  return app;
}

/* ── helpers ─────────────────────────────────────────────────── */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function notFound(c: any, kind: string, id: string) {
  return apiError(c, 404, 'not_found', `${kind} not found: ${id}`);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function apiError(c: any, status: number, code: ApiError['code'], message: string) {
  const body: ApiError = { code, message };
  return c.json(body, status);
}

/**
 * Parse a contribution id of the form `<kind>:<slug>@<version>`.
 * Returns null on malformed input. Kind must be one of the three
 * artifact kinds; slug can contain colons (since command slugs are
 * colon-separated themselves); version is everything after the last
 * `@`.
 */
function parseContributionId(
  id: string,
): { kind: ContributionKind; slug: string; version: string } | null {
  const atIdx = id.lastIndexOf('@');
  if (atIdx === -1) return null;
  const beforeAt = id.slice(0, atIdx);
  const version = id.slice(atIdx + 1);
  if (!version) return null;

  const colonIdx = beforeAt.indexOf(':');
  if (colonIdx === -1) return null;
  const kindStr = beforeAt.slice(0, colonIdx);
  const slug = beforeAt.slice(colonIdx + 1);
  if (!slug) return null;
  if (kindStr !== 'command' && kindStr !== 'skill' && kindStr !== 'workflow') {
    return null;
  }
  return { kind: kindStr, slug, version };
}

async function listVersionsByKind(storage: CatalogStorage, kind: ContributionKind, slug: string) {
  if (kind === 'command') return await storage.listCommandVersions(slug);
  if (kind === 'skill') return await storage.listSkillVersions(slug);
  return await storage.listWorkflowVersions(slug);
}
