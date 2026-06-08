/**
 * `mech-pencil` with no args → this interactive wizard.
 *
 * Mounts <WizardView> via the lib's generic `runTuiView`. The view
 * collects {framework, theme} and calls `onComplete`; we capture the
 * result in a closure and — only AFTER the renderer has torn down —
 * run the normal `bundle` emit so its chalk output renders in the
 * plain terminal rather than inside the openTUI canvas.
 *
 * Non-interactive callers never reach here: `cli.ts` falls back to
 * `banner()` when stdin/stdout aren't a TTY (CONVENTIONS.md — every
 * interactive surface needs a non-interactive equivalent; the emit
 * verbs `theme`/`bundle` are it).
 */

import { runTuiView } from '@ecruz165/tui-view-components/pages';
import { createElement } from 'react';
import { listFrameworks } from '../frameworks/_core/registry.ts';
import { WizardView } from '../tui/WizardView.tsx';
import { finalizeTheme, type WizardResult } from '../tui/wizard-config.ts';
import { dim, heading } from '../ui.ts';
import { runSystem } from './system.ts';

export async function runWizard(): Promise<void> {
  let result: WizardResult | null = null;

  await runTuiView({ appName: 'mech-pencil' }, (onQuit) =>
    createElement(WizardView, {
      frameworks: listFrameworks().map((f) => ({
        id: f.id,
        title: f.title,
        description: f.description,
      })),
      onComplete: (r) => {
        result = r;
      },
      onQuit,
    }),
  );

  if (!result) {
    console.log(dim('cancelled — no files written.'));
    return;
  }

  const { frameworkId, draft } = result;
  let cfg: ReturnType<typeof finalizeTheme>;
  try {
    cfg = finalizeTheme(draft);
  } catch (e) {
    // resolveTheme rejected a value validateField let through — surface
    // it rather than crash. (Tightening validateField shrinks this gap.)
    console.error(`✗ ${e instanceof Error ? e.message : e}`);
    process.exitCode = 1;
    return;
  }

  console.log(heading(`mech-pencil · ${frameworkId} → option-A system`));
  runSystem({
    accent: cfg.accent,
    base: String(cfg.base),
    font: cfg.fontFamily,
    radius: cfg.radius,
    formRadius: cfg.formRadius,
    dir: '.',
  });
}
