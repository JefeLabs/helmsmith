/**
 * Save-to-server client. Talks to the harness catalog surface —
 * `GET /v1/catalog` / `PUT /v1/catalog` — through the dev proxy (`/harness`
 * → HARNESS_URL, see vite.config.ts). The endpoint pair is the seam:
 * a controlplane implementing the same wire shape (the JSON Schema
 * artifact defines it) is just a different base URL.
 */
import type { Catalog, UnsupportedFeature } from '@helmsmith/flow-spec';

export interface SaveResult {
  flowCount: number;
  warnings: UnsupportedFeature[];
}

export async function loadServerCatalog(
  base: string,
  fetchFn: typeof fetch = fetch,
): Promise<Catalog> {
  const res = await fetchFn(`${base}/v1/catalog`);
  const body = (await res.json()) as { catalog?: Catalog; error?: string };
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
  const body = (await res.json()) as Partial<SaveResult> & { error?: string };
  if (!res.ok) {
    throw new Error(body.error ?? `save failed (${res.status})`);
  }
  return { flowCount: body.flowCount ?? catalog.flows.length, warnings: body.warnings ?? [] };
}
