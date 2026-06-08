import { describe, expect, it } from 'vitest';
import { PenDocument } from './document.ts';

// normalizePencilNode runs inside toObject() and rewrites emitted nodes into the
// dialect Pencil's own save path produces — emitting the un-normalized form
// renders but crashes the app when the doc is resolved on click. These tests
// drive it through the public toObject() surface (no internals exported).

// helper: run a single node through toObject and return the normalized copy
function normalized(node: Record<string, unknown>): Record<string, unknown> {
  return new PenDocument().add(node as never).toObject().children[0] as Record<string, unknown>;
}

describe('normalizePencilNode (via toObject)', () => {
  it('forces text fontWeight to the "normal" keyword (400 / absent both crash)', () => {
    expect(normalized({ id: 't', type: 'text', content: 'hi', fontWeight: '400' }).fontWeight).toBe('normal');
    expect(normalized({ id: 't', type: 'text', content: 'hi' }).fontWeight).toBe('normal');
    expect(normalized({ id: 't', type: 'text', content: 'hi', fontWeight: '700' }).fontWeight).toBe('700');
  });

  it('strips redundant defaults Pencil omits on save', () => {
    const n = normalized({ id: 'f', type: 'frame', gap: 0, cornerRadius: 0, alignItems: 'start' });
    expect(n).not.toHaveProperty('gap');
    expect(n).not.toHaveProperty('cornerRadius');
    expect(n).not.toHaveProperty('alignItems');
    expect(normalized({ id: 't', type: 'text', content: '' })).not.toHaveProperty('content');
  });

  it('gives an ellipse explicit x/y and drops full-circle arc params', () => {
    const n = normalized({ id: 'e', type: 'ellipse', startAngle: 0, sweepAngle: 360 });
    expect(n).toMatchObject({ x: 0, y: 0 });
    expect(n).not.toHaveProperty('startAngle');
    expect(n).not.toHaveProperty('sweepAngle');
  });

  it('collapses symmetric padding to the compact form', () => {
    expect(normalized({ id: 'a', type: 'frame', padding: [8, 8, 8, 8] }).padding).toBe(8);
    expect(normalized({ id: 'b', type: 'frame', padding: [8, 16, 8, 16] }).padding).toEqual([8, 16]);
  });

  it('enables gradient fills (a disabled gradient renders nothing)', () => {
    const n = normalized({ id: 'g', type: 'frame', fill: { type: 'gradient', stops: [] } });
    expect((n.fill as Record<string, unknown>).enabled).toBe(true);
  });

  it('recurses into children', () => {
    const root = new PenDocument()
      .add({ id: 'root', type: 'frame', children: [{ id: 'kid', type: 'text', content: 'x', fontWeight: '400' }] } as never)
      .toObject().children[0] as Record<string, unknown>;
    expect((root.children as Record<string, unknown>[])[0].fontWeight).toBe('normal');
  });
});

describe('pathToRelative (via toObject)', () => {
  const geom = (d: string) => normalized({ id: 'p', type: 'path', geometry: d }).geometry as string;

  it('rewrites absolute commands to relative (no uppercase remains)', () => {
    const out = geom('M0 0 L10 0 L10 10 Z');
    expect(out).not.toMatch(/[A-Z]/); // every command lower-cased = relative
    expect(out).toMatch(/^m0 0/);
  });

  it('bails to the original string on an unknown command', () => {
    const bad = 'X5 5 L1 1';
    expect(geom(bad)).toBe(bad);
  });

  // TODO(you): drop in the actual Font Awesome path that crashed the app — the
  // mixed absolute/relative form from the builder.ts comment (e.g. `…l0 144L48
  // 224…`). The strongest regression guard is the real string you hit:
  //   it('handles the FA <name> glyph that crashed on click', () => {
  //     const out = geom('<paste the real d= string here>');
  //     expect(out).not.toMatch(/[A-Z]/);
  //   });
});