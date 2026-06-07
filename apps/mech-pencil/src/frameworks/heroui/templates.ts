/**
 * Page templates — primary / secondary / tertiary / modal — each built per
 * viewport (desktop / tablet / mobile). Composed from local component refs
 * (`ctx.component(id)`) + foundation tokens (`ctx.token`), so a template lib
 * imports only the foundation libs it touches and keeps local copies of the
 * components it instantiates. Layout adapts to the viewport width (sidebar
 * collapses on mobile, grids reflow).
 */

import { frame, ref, text } from '../../pen/builder.ts';
import type { Child } from '../../pen/schema.ts';
import type { MockupContext } from '../_core/adapter.ts';

export interface Viewport {
  id: string;
  width: number;
  height: number;
}

export const VIEWPORTS: Viewport[] = [
  { id: 'desktop', width: 1440, height: 900 },
  { id: 'tablet', width: 834, height: 1112 },
  { id: 'mobile', width: 390, height: 844 },
];

export interface PageTemplate {
  /** primary | secondary | tertiary | modal */
  id: string;
  name: string;
  /** Component ids the template instantiates (local copies emitted alongside). */
  uses: string[];
  build: (ctx: MockupContext, vp: Viewport) => Child;
}

const isMobile = (vp: Viewport) => vp.width < 600;

function mk(prefix: string) {
  let n = 0;
  return (p: string) => `${prefix}-${p}-${n++}`;
}

function topbar(ctx: MockupContext, id: (p: string) => string, title: string): Child {
  return frame(id('topbar'), {
    name: 'TopBar', layout: 'horizontal', width: 'fill_container', height: 56,
    fill: ctx.token('color.surface'), padding: [0, 16], justifyContent: 'space_between', alignItems: 'center',
  }, [
    text(id('brand'), title, { fill: ctx.token('color.foreground'), fontFamily: ctx.token('font.display'), fontSize: 16, fontWeight: '700' }),
    ref(id('tb-btn'), ctx.component('button')),
  ]);
}

function screen(ctx: MockupContext, id: (p: string) => string, vp: Viewport, name: string, body: Child[]): Child {
  return frame(id('screen'), {
    name: `${name} · ${vp.id}`, width: vp.width, height: vp.height, fill: ctx.token('color.background'),
    theme: { mode: 'light' }, layout: 'vertical', gap: 0,
  }, body);
}

function buildPrimary(ctx: MockupContext, vp: Viewport): Child {
  const id = mk(`primary-${vp.id}`);
  const cards = [0, 1, 2, 3].map((i) => ref(id(`card-${i}`), ctx.component('card'), { width: 'fill_container' }));
  const content = frame(id('content'), { name: 'Content', layout: 'vertical', width: 'fill_container', gap: ctx.token('space.6'), padding: ctx.token('space.6') }, [
    text(id('title'), 'Dashboard', { fill: ctx.token('color.foreground'), fontFamily: ctx.token('font.display'), fontSize: ctx.token('font.h2.size'), fontWeight: '700' }),
    frame(id('grid'), { name: 'Grid', layout: isMobile(vp) ? 'vertical' : 'horizontal', width: 'fill_container', gap: ctx.token('grid.gutter') }, cards),
  ]);
  const body = isMobile(vp)
    ? content
    : frame(id('row'), { name: 'Row', layout: 'horizontal', width: 'fill_container', height: 'fill_container', gap: 0 }, [
        frame(id('sidebar'), { name: 'Sidebar', layout: 'vertical', width: 240, height: 'fill_container', fill: ctx.token('color.surface-secondary'), padding: ctx.token('space.4'), gap: ctx.token('space.2') }, [
          text(id('nav'), 'Navigation', { fill: ctx.token('color.muted'), fontFamily: ctx.token('font.mono'), fontSize: 12 }),
        ]),
        content,
      ]);
  return screen(ctx, id, vp, 'Primary', [topbar(ctx, id, 'AgentX'), body]);
}

function buildSecondary(ctx: MockupContext, vp: Viewport): Child {
  const id = mk(`secondary-${vp.id}`);
  const sections = [0, 1].map((i) => ref(id(`sec-${i}`), ctx.component('card'), { width: 'fill_container' }));
  const content = frame(id('content'), { name: 'Detail', layout: 'vertical', width: 'fill_container', gap: ctx.token('space.5'), padding: ctx.token('space.6') }, [
    text(id('crumb'), 'Jobs / job_a1b2c3d4', { fill: ctx.token('color.muted'), fontFamily: ctx.token('font.mono'), fontSize: 12 }),
    text(id('title'), 'Job detail', { fill: ctx.token('color.foreground'), fontFamily: ctx.token('font.display'), fontSize: ctx.token('font.h2.size'), fontWeight: '700' }),
    ...sections,
  ]);
  return screen(ctx, id, vp, 'Secondary', [topbar(ctx, id, 'AgentX'), content]);
}

function buildTertiary(ctx: MockupContext, vp: Viewport): Child {
  const id = mk(`tertiary-${vp.id}`);
  const form = frame(id('form'), { name: 'Settings form', layout: 'vertical', width: isMobile(vp) ? 'fill_container' : 560, gap: ctx.token('space.5'), padding: ctx.token('space.6') }, [
    text(id('title'), 'Settings', { fill: ctx.token('color.foreground'), fontFamily: ctx.token('font.display'), fontSize: ctx.token('font.h2.size'), fontWeight: '700' }),
    ref(id('card'), ctx.component('card'), { width: 'fill_container' }),
    frame(id('actions'), { name: 'Actions', layout: 'horizontal', gap: ctx.token('space.3'), alignItems: 'center' }, [ref(id('save'), ctx.component('button'))]),
  ]);
  return screen(ctx, id, vp, 'Tertiary', [topbar(ctx, id, 'AgentX'), form]);
}

function buildModal(ctx: MockupContext, vp: Viewport): Child {
  const id = mk(`modal-${vp.id}`);
  const dialog = frame(id('dialog'), {
    name: 'Dialog', layout: 'vertical', width: isMobile(vp) ? 'fill_container' : 420, gap: ctx.token('space.4'),
    padding: ctx.token('space.6'), fill: ctx.token('color.surface'), cornerRadius: ctx.token('radius.lg'),
  }, [
    text(id('title'), 'Confirm & start', { fill: ctx.token('color.foreground'), fontFamily: ctx.token('font.display'), fontSize: ctx.token('font.h3.size'), fontWeight: '600' }),
    text(id('body'), 'This will spin up agentx-job and open a PR when accepted.', { fill: ctx.token('color.muted'), fontFamily: ctx.token('font.family'), fontSize: ctx.token('font.body-md.size') }),
    frame(id('actions'), { name: 'Actions', layout: 'horizontal', gap: ctx.token('space.3'), justifyContent: 'end', width: 'fill_container' }, [ref(id('confirm'), ctx.component('button'))]),
  ]);
  // backdrop fills the screen; the dialog is centered.
  const backdrop = frame(id('backdrop'), {
    name: 'Backdrop', width: vp.width, height: vp.height, fill: ctx.token('color.background'),
    theme: { mode: 'light' }, layout: 'vertical', justifyContent: 'center', alignItems: 'center', padding: ctx.token('space.6'),
  }, [dialog]);
  return backdrop;
}

export const PAGE_TEMPLATES: PageTemplate[] = [
  { id: 'primary', name: 'Primary — Dashboard', uses: ['card', 'button'], build: buildPrimary },
  { id: 'secondary', name: 'Secondary — Detail', uses: ['card', 'button'], build: buildSecondary },
  { id: 'tertiary', name: 'Tertiary — Settings', uses: ['card', 'button'], build: buildTertiary },
  { id: 'modal', name: 'Modal — Dialog', uses: ['card', 'button'], build: buildModal },
];
