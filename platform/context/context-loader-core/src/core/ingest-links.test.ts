/**
 * Note-to-note links through the real ingest() pipeline (prose-markdown).
 *
 * MatchingGraphBackend mirrors Neo4jBackend's edge contract — both endpoints
 * are MATCHed, so an edge written before its target node exists is silently
 * dropped. The plain InMemoryGraphBackend stores every edge and would hide
 * the ordering bugs these tests guard.
 */

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryGraphBackend } from '../backends/in-memory.ts';
import type { GraphEdge } from '../types.ts';
import type { EmbedderClient } from './embedder-client.ts';
import { type IngestSpecExt, ingest } from './ingest.ts';

class MatchingGraphBackend extends InMemoryGraphBackend {
  override async upsertEdge(edge: GraphEdge): Promise<void> {
    if (this.nodes.has(edge.from) && this.nodes.has(edge.to)) await super.upsertEdge(edge);
  }
}

const embedder: EmbedderClient = {
  dim: 4,
  async embed(texts: string[]): Promise<Float32Array[]> {
    return texts.map(() => new Float32Array([1, 0, 0, 0]));
  },
};

let vault: string;

beforeEach(() => {
  vault = mkdtempSync(join(tmpdir(), 'ingest-links-'));
});

function write(files: Record<string, string>): void {
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(vault, rel)), { recursive: true });
    writeFileSync(join(vault, rel), body);
  }
}

function run(backend: InMemoryGraphBackend, extra: Partial<IngestSpecExt> = {}) {
  return ingest({
    source: { type: 'prose-markdown', ref: { kind: 'path', path: vault } },
    backend,
    embedderClient: embedder,
    ...extra,
  });
}

const linkPairs = (backend: InMemoryGraphBackend): string[] =>
  backend
    .edgesByLabel('LinkedFrom')
    .map((e) => `${e.from} -> ${e.to}`)
    .sort();

describe('ingest() — note links', () => {
  it('resolves wikilinks and relative links to the target notes, whatever the walk order', async () => {
    // index and alpha link to each other, so whichever the walk reaches
    // first, one of its links points at a note not yet written.
    write({
      'index.md': '# Home\n\nStart at [[alpha]] or [Beta](projects/beta.md).\n',
      'projects/alpha.md': '# Alpha\n\nBack [home](../index.md).\n',
      'projects/beta.md': '# Beta\n\nSee [[Alpha]].\n',
    });
    const backend = new MatchingGraphBackend();
    await run(backend);
    expect(linkPairs(backend)).toEqual([
      'index.md -> projects/alpha.md',
      'index.md -> projects/beta.md',
      'projects/alpha.md -> index.md',
      'projects/beta.md -> projects/alpha.md',
    ]);
  });

  it('links an unchanged note once the note it points at is created', async () => {
    write({ 'a.md': '# A\n\nIdea for [[later]].\n' });
    const backend = new MatchingGraphBackend();
    await run(backend);
    expect(linkPairs(backend)).toEqual([]);

    write({ 'later.md': '# Later\n' });
    const second = await run(backend);
    expect(second.filesSkipped).toBe(1); // a.md itself was not re-ingested
    expect(linkPairs(backend)).toEqual(['a.md -> later.md']);
  });

  it('writes no edge for a link that resolves to nothing', async () => {
    write({ 'a.md': '# A\n\n[[missing]], [site](https://example.com), [img](diagram.png).\n' });
    // Plain backend keeps dangling edges, so a raw-target fallback would show.
    const backend = new InMemoryGraphBackend();
    await run(backend);
    expect(linkPairs(backend)).toEqual([]);
  });

  it('does not link a note to itself', async () => {
    write({ 'a.md': '# A\n\nSee [[a]], [top](a.md) and [[b]].\n', 'b.md': '# B\n' });
    const backend = new MatchingGraphBackend();
    await run(backend);
    expect(linkPairs(backend)).toEqual(['a.md -> b.md']);
  });

  it('writes no links when the run is aborted part-way', async () => {
    // A partial walk means a partial index: `[[Plan]]` could resolve to a
    // namesake because the real target wasn't reached, and MERGE never
    // removes that edge later. Every note links to every other here, so
    // any two ingested notes would produce edges if the link pass ran.
    write({
      'a.md': '# A\n\n[[b]] [[c]]\n',
      'b.md': '# B\n\n[[a]] [[c]]\n',
      'c.md': '# C\n\n[[a]] [[b]]\n',
    });
    const controller = new AbortController();
    let docsWritten = 0;
    const backend = new MatchingGraphBackend();
    await run(backend, {
      signal: controller.signal,
      onEvent: (e) => {
        if (e.kind === 'node-written' && e.label === 'Doc' && ++docsWritten === 2) {
          controller.abort();
        }
      },
    });
    expect(docsWritten).toBe(2);
    expect(linkPairs(backend)).toEqual([]);
  });
});
