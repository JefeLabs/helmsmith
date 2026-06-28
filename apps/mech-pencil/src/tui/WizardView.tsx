/**
 * `<WizardView>` — the no-args wizard.
 *
 *   step 1  framework   SelectList of registry adapters
 *   step 2  theme        the 5 HeroUI knobs: text fields typed via
 *                        <Input>, enum fields cycled with ←/→
 *   step 3  review        <Confirm> → emit the layered bundle
 *
 * Composed only from @ecruz165/tui-view-components (no raw openTUI
 * intrinsics). Hooks rule: every useKeybinding is called
 * unconditionally and gated via `enabled` (mirrors SelectList /
 * ConnectView in the lib).
 *
 * On confirm the view calls `onComplete(result)` then `onQuit()`; the
 * actual bundle emit runs in `runWizard` AFTER the renderer tears down
 * (so chalk output lands in the normal terminal, not the TUI canvas).
 */

import { Box, Heading, Input, Text } from '@ecruz165/tui-view-components/atoms';
import { FocusManager } from '@ecruz165/tui-view-components/focus';
import { useKeybinding } from '@ecruz165/tui-view-components/keyboard';
import { KeybindingsBar } from '@ecruz165/tui-view-components/molecules';
import { Confirm, SelectList } from '@ecruz165/tui-view-components/organisms';
import { useState } from 'react';
import {
  cycle,
  getField,
  initialDraft,
  setField,
  THEME_FIELDS,
  type ThemeDraft,
  validateField,
  type WizardResult,
} from './wizard-config.ts';

export interface WizardFrameworkChoice {
  id: string;
  title: string;
  description: string;
}

export interface WizardViewProps {
  frameworks: WizardFrameworkChoice[];
  /** Called once, on confirm, with the collected result. */
  onComplete: (result: WizardResult) => void;
  /** Tear down the renderer (quit/finish). */
  onQuit: () => void;
}

type Step = 'framework' | 'theme' | 'review';

/** rowIdx === THEME_FIELDS.length is the virtual "Generate" action row. */
const GENERATE_ROW = THEME_FIELDS.length;

export function WizardView({ frameworks, onComplete, onQuit }: WizardViewProps) {
  const [step, setStep] = useState<Step>('framework');
  const [frameworkId, setFrameworkId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ThemeDraft>(initialDraft);
  const [rowIdx, setRowIdx] = useState(0);
  const [editing, setEditing] = useState(false);
  const [editBuf, setEditBuf] = useState('');
  const [error, setError] = useState<string | null>(null);

  const onThemeIdle = step === 'theme' && !editing;
  const field = rowIdx < GENERATE_ROW ? THEME_FIELDS[rowIdx] : null;

  // ── theme-step navigation (gated; hooks stay unconditional) ────────
  useKeybinding('up', 'navigate', () => setRowIdx((i) => Math.max(0, i - 1)), {
    enabled: onThemeIdle,
    hidden: true,
  });
  useKeybinding('down', 'navigate', () => setRowIdx((i) => Math.min(GENERATE_ROW, i + 1)), {
    enabled: onThemeIdle,
    hidden: true,
  });
  useKeybinding('k', 'navigate', () => setRowIdx((i) => Math.max(0, i - 1)), {
    enabled: onThemeIdle,
    hidden: true,
  });
  useKeybinding('j', 'navigate', () => setRowIdx((i) => Math.min(GENERATE_ROW, i + 1)), {
    enabled: onThemeIdle,
    hidden: true,
  });

  const cycleField = (dir: 1 | -1) => {
    if (!field || field.kind !== 'enum' || !field.options) return;
    setDraft((d) => setField(d, field.id, cycle(field.options ?? [], getField(d, field.id), dir)));
  };
  useKeybinding('left', '←/→ cycle', () => cycleField(-1), {
    enabled: onThemeIdle && field?.kind === 'enum',
  });
  useKeybinding('right', '', () => cycleField(1), {
    enabled: onThemeIdle && field?.kind === 'enum',
    hidden: true,
  });

  // Enter: edit a text field, or fire the Generate row.
  useKeybinding(
    (k) => k.name === 'return' || k.name === 'enter',
    rowIdx === GENERATE_ROW ? 'generate' : 'edit',
    () => {
      if (rowIdx === GENERATE_ROW) {
        setStep('review');
        return;
      }
      if (field?.kind === 'text') {
        setEditBuf(getField(draft, field.id));
        setError(null);
        setEditing(true);
      }
    },
    { enabled: onThemeIdle, keyDisplay: '↵' },
  );

  // Esc while editing cancels the edit (keeps prior value).
  useKeybinding(
    'escape',
    'cancel edit',
    () => {
      setEditing(false);
      setError(null);
    },
    { enabled: step === 'theme' && editing, keyDisplay: 'esc' },
  );

  // Back to framework step.
  useKeybinding('b', 'back', () => setStep('framework'), { enabled: onThemeIdle });

  // Quit (disabled mid-edit so 'q' types into the field).
  useKeybinding('q', 'quit', () => onQuit(), { enabled: !editing });

  const commitEdit = () => {
    if (!field) return;
    const err = validateField(field.id, editBuf);
    if (err) {
      setError(err);
      return;
    }
    setDraft((d) => setField(d, field.id, editBuf));
    setEditing(false);
    setError(null);
  };

  // ── render ─────────────────────────────────────────────────────────
  if (step === 'framework') {
    return (
      <FocusManager initialFocus="wizard-framework">
        <Box
          variant="default"
          padding="md"
          style={{ flexDirection: 'column', gap: 1, minWidth: 60 }}
        >
          <Heading level={1}>mech-pencil · new design system</Heading>
          <Text variant="muted">Step 1/2 — choose a target framework</Text>
          <SelectList
            focusId="wizard-framework"
            alwaysCapture
            items={frameworks.map((f) => ({ id: f.id, label: f.title, detail: f.description }))}
            onSelect={(idx) => {
              setFrameworkId(frameworks[idx]?.id ?? null);
              setStep('theme');
            }}
          />
          <KeybindingsBar />
        </Box>
      </FocusManager>
    );
  }

  if (step === 'review') {
    return (
      <Box variant="default" padding="md" style={{ flexDirection: 'column', gap: 1, minWidth: 60 }}>
        <Heading level={1}>mech-pencil · review</Heading>
        <Text variant="muted">framework</Text>
        <Text>{frameworkId ?? '(none)'}</Text>
        <Text variant="muted">theme</Text>
        <Text>
          {`accent ${draft.accent} · base ${draft.base} · ${draft.fontFamily} · radius ${draft.radius}/${draft.formRadius}`}
        </Text>
        <Text variant="subtle">
          → writes ./theme.lib.pen + core/*.lib.pen + mocks/*.pen (HeroUI token contract)
        </Text>
        <Confirm
          title="Generate layered bundle?"
          message="Write the bundle into the current directory."
          defaultAnswer="yes"
          yesLabel="generate"
          noLabel="back"
          onConfirm={() => {
            if (frameworkId) onComplete({ frameworkId, draft });
            onQuit();
          }}
          onCancel={() => setStep('theme')}
        />
      </Box>
    );
  }

  // step === 'theme'
  return (
    <Box variant="default" padding="md" style={{ flexDirection: 'column', gap: 1, minWidth: 60 }}>
      <Heading level={1}>mech-pencil · theme</Heading>
      <Text variant="muted">{`Step 2/2 — ${frameworkId} theme values`}</Text>
      <Box variant="transparent" style={{ flexDirection: 'column' }}>
        {THEME_FIELDS.map((f, i) => {
          const isCursor = i === rowIdx;
          const isEditingThis = editing && isCursor && f.kind === 'text';
          return (
            <Box
              key={f.id}
              variant="transparent"
              style={{ flexDirection: 'row', gap: 1, paddingLeft: 1 }}
            >
              <Text variant={isCursor ? 'accent' : 'body'}>{isCursor ? '▸' : ' '}</Text>
              <Text variant={isCursor ? 'accent' : 'body'}>{`${f.label}:`}</Text>
              {isEditingThis ? (
                <Input
                  focused
                  value={editBuf}
                  onInput={(v) => setEditBuf(v)}
                  onSubmit={() => commitEdit()}
                  style={{ width: 28 }}
                />
              ) : (
                <Text variant="subtle">{getField(draft, f.id)}</Text>
              )}
              {isCursor && !isEditingThis ? <Text variant="subtle">{`(${f.hint})`}</Text> : null}
            </Box>
          );
        })}
        <Box variant="transparent" style={{ flexDirection: 'row', gap: 1, paddingLeft: 1 }}>
          <Text variant={rowIdx === GENERATE_ROW ? 'accent' : 'body'}>
            {rowIdx === GENERATE_ROW ? '▸' : ' '}
          </Text>
          <Text variant={rowIdx === GENERATE_ROW ? 'accent' : 'body'}>Continue → review</Text>
        </Box>
      </Box>
      {error ? <Text variant="accent">{`✗ ${error}`}</Text> : null}
      <KeybindingsBar />
    </Box>
  );
}
