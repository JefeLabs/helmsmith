/**
 * Write an emitted system to disk + render faithful PNGs.
 *
 * Each artifact is written as its final file (`.lib.pen`, or `base.pen`), and
 * its PNG is produced by Pencil's OWN headless renderer — a render, not an AI
 * run, so zero LLM tokens. Because `--export` only handles self-contained docs,
 * the PNG is rendered from a throwaway FLATTENED copy (imports inlined); the
 * persisted `.lib.pen` keeps its imports (option A).
 *
 * Rendering is AUTH-GATED: if the CLI isn't authenticated (or absent), the
 * `.lib.pen`/`.pen` files still emit deterministically and the PNG is skipped
 * with a reason — generation never hard-fails on auth.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { TokenSet } from '../design-system/tokens.ts';
import { flattenForRender } from './flatten.ts';
import type { SystemBundle } from './system.ts';

export interface RenderOutcome {
  ok: boolean;
  reason?: string;
}

/** Renders a `.pen` to a `.png`. Injectable for tests. */
export type Renderer = (penPath: string, pngPath: string) => RenderOutcome;

/** Default renderer — Pencil's headless export (faithful, no LLM, auth-gated). */
export function pencilRender(penPath: string, pngPath: string): RenderOutcome {
  const bin = process.env.PENCIL_BIN ?? '/opt/homebrew/bin/pencil';
  try {
    execFileSync(bin, ['--in', penPath, '--export', pngPath], { stdio: 'pipe', timeout: 180_000 });
    return { ok: true };
  } catch (e) {
    const err = e as { stderr?: Buffer; stdout?: Buffer; message?: string; code?: string };
    const msg = `${err.stderr ?? ''}${err.stdout ?? ''}${err.message ?? ''}`;
    if (err.code === 'ENOENT') return { ok: false, reason: 'pencil-cli-not-found' };
    if (/Authentication required|PENCIL_CLI_KEY|not authenticated/i.test(msg)) {
      return { ok: false, reason: 'not-authenticated' };
    }
    return { ok: false, reason: (msg.trim() || 'render-failed').slice(0, 160) };
  }
}

export interface WriteResult {
  /** Persisted `.lib.pen` (+ `base.pen`) files. */
  files: string[];
  /** Rendered `.png` files. */
  pngs: string[];
  /** PNGs skipped, with reason. */
  skippedPngs: string[];
}

export function writeSystem(
  sys: SystemBundle,
  tokens: TokenSet,
  outDir: string,
  render: Renderer = pencilRender,
): WriteResult {
  const res: WriteResult = { files: [], pngs: [], skippedPngs: [] };

  const write = (rel: string, json: string): void => {
    const abs = join(outDir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, json);
  };

  // Render a doc's PNG from a throwaway flattened (self-contained) copy.
  const renderPng = (doc: { toObject(): unknown }, pngRel: string): void => {
    const tmpRel = pngRel.replace(/\.png$/, '.__render.pen');
    const obj = doc.toObject() as unknown as Record<string, unknown>;
    write(tmpRel, JSON.stringify(flattenForRender(obj, tokens)));
    const r = render(join(outDir, tmpRel), join(outDir, pngRel));
    rmSync(join(outDir, tmpRel), { force: true });
    if (r.ok) res.pngs.push(pngRel);
    else res.skippedPngs.push(`${pngRel} (${r.reason})`);
  };

  // Foundations: token lib (not visual) + its decision-page PNG.
  for (const f of sys.foundations) {
    write(f.libPath, f.lib.toJSON());
    res.files.push(f.libPath);
    renderPng(f.preview, f.libPath.replace(/\.lib\.pen$/, '.png'));
  }

  // Components + templates: persist .lib.pen, render the (flattened) lib → PNG.
  for (const c of sys.components) {
    write(c.path, c.doc.toJSON());
    res.files.push(c.path);
    renderPng(c.doc, c.path.replace(/\.lib\.pen$/, '.png'));
  }
  for (const t of sys.templates) {
    write(t.libPath, t.lib.toJSON());
    res.files.push(t.libPath);
    renderPng(t.lib, t.libPath.replace(/\.lib\.pen$/, '.png'));
  }

  // Base: the consumer entry doc stays a .pen; render it too.
  write(sys.base.path, sys.base.doc.toJSON());
  res.files.push(sys.base.path);
  renderPng(sys.base.doc, 'base.png');

  return res;
}