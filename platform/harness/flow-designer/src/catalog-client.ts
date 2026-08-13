/**
 * Save-to-server client. Talks to the harness catalog surface —
 * `GET /v1/catalog` / `PUT /v1/catalog` — through the dev proxy (`/harness`
 * → HARNESS_URL, see vite.config.ts). The endpoint pair is the seam:
 * a controlplane implementing the same wire shape (the JSON Schema
 * artifact defines it) is just a different base URL.
 */
import type { Catalog, UnsupportedFeature } from '@helmsmith/flow-spec';
import type { LayoutMap } from './layout-store.ts';

export interface SaveResult {
  flowCount: number;
  warnings: UnsupportedFeature[];
}

/** Error responses from a dev proxy can carry empty/HTML bodies —
 *  parse leniently so status codes surface instead of JSON.parse noise. */
async function bodyOf(res: Response): Promise<Record<string, unknown>> {
  try {
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function loadServerCatalog(
  base: string,
  fetchFn: typeof fetch = fetch,
): Promise<Catalog> {
  const res = await fetchFn(`${base}/v1/catalog`);
  const body = (await bodyOf(res)) as { catalog?: Catalog; error?: string };
  if (!res.ok || !body.catalog) {
    throw new Error(body.error ?? `load failed (${res.status})`);
  }
  return body.catalog;
}

export async function saveServerCatalog(
  base: string,
  catalog: Catalog,
  fetchFn: typeof fetch = fetch,
): Promise<SaveResult> {
  const res = await fetchFn(`${base}/v1/catalog`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(catalog),
  });
  const body = (await bodyOf(res)) as Partial<SaveResult> & { error?: string };
  if (!res.ok) {
    throw new Error(body.error ?? `save failed (${res.status})`);
  }
  return { flowCount: body.flowCount ?? catalog.flows.length, warnings: body.warnings ?? [] };
}

/**
 * Layout sidecar transport — GET/PUT /v1/catalog/layout. Deliberately
 * BEST-EFFORT in both directions: layout is an editor convenience, so
 * a server without the route (e.g. a controlplane that hasn't added
 * it), a network failure, or a malformed body must never block the
 * catalog operations they ride along with. Load resolves null on any
 * failure; save resolves false.
 */
export async function loadServerLayout(
  base: string,
  fetchFn: typeof fetch = fetch,
): Promise<LayoutMap | null> {
  try {
    const res = await fetchFn(`${base}/v1/catalog/layout`);
    if (!res.ok) return null;
    const body = (await res.json()) as { layouts?: LayoutMap };
    return body.layouts && typeof body.layouts === 'object' ? body.layouts : null;
  } catch {
    return null;
  }
}

export async function saveServerLayout(
  base: string,
  layouts: LayoutMap,
  fetchFn: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const res = await fetchFn(`${base}/v1/catalog/layout`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(layouts),
    });
    return res.ok;
  } catch {
    return false;
  }
}
