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
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
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
    // Don't trust the exit code: the pencil CLI exits 0 even when the export
    // fails (e.g. "bounding box invalid") and writes nothing. Verify the
    // artifact actually landed, otherwise this is a silent no-op.
    if (!existsSync(pngPath) || statSync(pngPath).size === 0) {
      return { ok: false, reason: 'no-output-written' };
    }
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
}

/**
 * Write the system's `.pen`/`.lib.pen` docs to disk. Deterministic and
 * dependency-free — no renderer, no auth, no network. PNG previews are a
 * separate, opt-in step (`renderSystemPngs`) so this hot path can never
 * silently fail on a broken / auth-gated / AI-coupled headless render.
 */
export function writeSystem(sys: SystemBundle, outDir: string): WriteResult {
  const files: string[] = [];
  const write = (rel: string, json: string): void => {
    const abs = join(outDir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, json);
    files.push(rel);
  };

  for (const f of sys.foundations) write(f.libPath, f.lib.toJSON());
  for (const c of sys.components) write(c.path, c.doc.toJSON());
  for (const t of sys.templates) write(t.libPath, t.lib.toJSON());
  write(sys.base.path, sys.base.doc.toJSON());

  return { files };
}

export interface RenderResult {
  /** Rendered `.png` files. */
  pngs: string[];
  /** PNGs skipped, with reason. */
  skippedPngs: string[];
}

/**
 * Render a preview PNG for each visual doc, from a throwaway flattened
 * (self-contained) copy. Opt-in and isolated from `writeSystem`: the headless
 * Pencil export is auth-gated and AI-coupled, so it may legitimately render
 * nothing — callers surface `skippedPngs` rather than failing the emit. Does
 * not require `writeSystem` to have run; it renders from the in-memory docs.
 */
export function renderSystemPngs(
  sys: SystemBundle,
  tokens: TokenSet,
  outDir: string,
  render: Renderer = pencilRender,
): RenderResult {
  const res: RenderResult = { pngs: [], skippedPngs: [] };

  const renderPng = (doc: { toObject(): unknown }, pngRel: string): void => {
    const tmpAbs = join(outDir, pngRel.replace(/\.png$/, '.__render.pen'));
    mkdirSync(dirname(tmpAbs), { recursive: true });
    const obj = doc.toObject() as unknown as Record<string, unknown>;
    writeFileSync(tmpAbs, JSON.stringify(flattenForRender(obj, tokens)));
    const r = render(tmpAbs, join(outDir, pngRel));
    rmSync(tmpAbs, { force: true });
    if (r.ok) res.pngs.push(pngRel);
    else res.skippedPngs.push(`${pngRel} (${r.reason})`);
  };

  for (const f of sys.foundations) renderPng(f.preview, f.libPath.replace(/\.lib\.pen$/, '.png'));
  for (const c of sys.components) renderPng(c.doc, c.path.replace(/\.lib\.pen$/, '.png'));
  for (const t of sys.templates) renderPng(t.lib, t.libPath.replace(/\.lib\.pen$/, '.png'));
  renderPng(sys.base.doc, 'base.png');

  return res;
}