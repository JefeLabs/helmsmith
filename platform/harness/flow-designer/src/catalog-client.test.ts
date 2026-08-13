import type { Catalog } from '@helmsmith/flow-spec';
import { describe, expect, it } from 'vitest';
import { loadServerCatalog, saveServerCatalog } from './catalog-client.ts';

const CATALOG: Catalog = {
  flows: [
    { id: 'f', nodes: [{ id: 't', kind: 'trigger', config: { kind: 'manual' } }], edges: [] },
  ],
};

function jsonResponse(v: unknown, status = 200): Response {
  return new Response(JSON.stringify(v), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('catalog client (save-to-server)', () => {
  it('loads the catalog from GET /v1/catalog', async () => {
    const calls: string[] = [];
    const fetchFn = (async (url: RequestInfo | URL) => {
      calls.push(String(url));
      return jsonResponse({ catalog: CATALOG });
    }) as typeof fetch;
    const catalog = await loadServerCatalog('/harness', fetchFn);
    expect(catalog).toEqual(CATALOG);
    expect(calls).toEqual(['/harness/v1/catalog']);
  });

  it('saves via PUT /v1/catalog and returns the warning list', async () => {
    let sent: unknown;
    const fetchFn = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body));
      expect(init?.method).toBe('PUT');
      return jsonResponse({ flowCount: 1, warnings: [{ feature: 'expression-js' }] });
    }) as typeof fetch;
    const result = await saveServerCatalog('/harness', CATALOG, fetchFn);
    expect(sent).toEqual(CATALOG);
    expect(result.flowCount).toBe(1);
    expect(result.warnings).toHaveLength(1);
  });

  it('surfaces the server validator error on rejection', async () => {
    const fetchFn = (async () =>
      jsonResponse(
        { error: 'PUT /v1/catalog: flows[0].nodes must be a non-empty array' },
        400,
      )) as typeof fetch;
    await expect(saveServerCatalog('/harness', CATALOG, fetchFn)).rejects.toThrow(
      /nodes must be a non-empty array/,
    );
  });

  it('surfaces connection-level failures readably', async () => {
    const fetchFn = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;
    await expect(loadServerCatalog('/harness', fetchFn)).rejects.toThrow(/fetch failed/);
  });
});
