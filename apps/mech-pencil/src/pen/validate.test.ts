import { describe, expect, it } from 'vitest';
import { PenDocument } from './document.ts';
import type { Document } from './schema.ts';
import { validateDocument } from './validate.ts';

describe('validateDocument', () => {
  it('accepts a minimal well-formed document', () => {
    const doc = new PenDocument()
      .add({ id: 'root', type: 'frame', width: 100, height: 100 })
      .toObject();
    expect(validateDocument(doc).ok).toBe(true);
  });

  it('rejects the wrong version literal', () => {
    const doc = { version: '2.9', children: [] } as unknown as Document;
    const r = validateDocument(doc);
    expect(r.ok).toBe(false);
    expect(r.issues[0].path).toBe('version');
  });

  it('flags duplicate ids within the same parent (breaks descendants paths)', () => {
    const doc = new PenDocument()
      .add(
        { id: 'a', type: 'rectangle' },
        { id: 'a', type: 'rectangle' },
      )
      .toObject();
    const r = validateDocument(doc);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.message.includes('duplicate id'))).toBe(true);
  });

  it('flags a bare ref with no matching local reusable component', () => {
    const doc = new PenDocument()
      .add({ id: 'inst', type: 'ref', ref: 'missing' })
      .toObject();
    expect(validateDocument(doc).ok).toBe(false);
  });

  it('rejects a node id containing "/" (reserved as the descendants separator)', () => {
    const doc = new PenDocument()
      .add({ id: 'card/title', type: 'text', content: 'x' })
      .toObject();
    const r = validateDocument(doc);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.message.includes("contains '/'"))).toBe(true);
  });

  it('rejects a cross-file ref to an UNDECLARED import alias', () => {
    const doc = new PenDocument()
      .add({ id: 'inst', type: 'ref', ref: 'ds:button' })
      .toObject();
    const r = validateDocument(doc);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.message.includes('unknown import alias'))).toBe(true);
  });

  it('allows a cross-file ref to a DECLARED import (Pencil resolves it)', () => {
    const doc = new PenDocument()
      .importLib('ds', './design-system.lib.pen')
      .add({ id: 'inst', type: 'ref', ref: 'ds:button' })
      .toObject();
    expect(validateDocument(doc).ok).toBe(true);
  });

  it('rejects descendants on a cross-file ref (they do not cross files)', () => {
    const doc = new PenDocument()
      .importLib('ds', './design-system.lib.pen')
      .add({ id: 'inst', type: 'ref', ref: 'ds:button', descendants: { 'ds:label': { content: 'x' } } })
      .toObject();
    const r = validateDocument(doc);
    expect(r.ok).toBe(false);
    expect(r.issues.some((i) => i.message.includes('descendant'))).toBe(true);
  });

  it('resolves a local ref to a reusable component', () => {
    const doc = new PenDocument()
      .add({ id: 'button', type: 'frame', reusable: true })
      .add({ id: 'inst', type: 'ref', ref: 'button' })
      .toObject();
    expect(validateDocument(doc).ok).toBe(true);
  });

  it('flags an undeclared $variable, accepts it once declared', () => {
    const undeclared = new PenDocument()
      .add({ id: 'r', type: 'rectangle', fill: '$color.accent' })
      .toObject();
    expect(validateDocument(undeclared).ok).toBe(false);

    const declared = new PenDocument()
      .variable('color.accent', { type: 'color', value: '#0485f7' })
      .add({ id: 'r', type: 'rectangle', fill: '$color.accent' })
      .toObject();
    expect(validateDocument(declared).ok).toBe(true);
  });
});
