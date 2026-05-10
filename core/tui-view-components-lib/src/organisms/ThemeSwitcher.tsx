/**
 * `<ThemeSwitcher>` — interactive theme picker overlay.
 *
 *   {pickerOpen && (
 *     <ThemeSwitcher active onApply={() => setPickerOpen(false)} />
 *   )}
 *
 * Renders a centered list of all registered themes (bundled + extras
 * from `<AgentxThemeProvider extraThemes>`). Arrow keys (or j/k)
 * navigate, Enter applies, Esc cancels. The active theme starts
 * focused.
 *
 * On Enter:
 *   - calls `setTheme(name)` (which persists via AgentxThemeProvider)
 *   - calls the optional `onApply` callback (e.g. to close the overlay)
 */

import { useKeyboard } from '@opentui/react';
import { useEffect, useState } from 'react';
import { Box } from '../atoms/Box.tsx';
import { Heading } from '../atoms/Heading.tsx';
import { Text } from '../atoms/Text.tsx';
import type { KeyEvent } from '../theme/hooks.ts';
import { useTheme } from '../theme/hooks.ts';
import type { Theme } from '../theme/types.ts';

export interface ThemeSwitcherProps {
  /** When false, the switcher does not capture keystrokes. */
  active?: boolean;
  /** Called after the user picks a theme (Enter). */
  onApply?: (theme: Theme) => void;
  /** Called when the user dismisses (Esc). */
  onCancel?: () => void;
}

export function ThemeSwitcher({ active = true, onApply, onCancel }: ThemeSwitcherProps) {
  const { themes, activeName, setTheme } = useTheme();
  const names = Object.keys(themes);
  const initialIdx = Math.max(0, names.indexOf(activeName));
  const [idx, setIdx] = useState(initialIdx);

  // Keep the cursor on the active theme if the registry shifts under us.
  useEffect(() => {
    const i = names.indexOf(activeName);
    if (i >= 0) setIdx(i);
  }, [activeName, names]);

  useKeyboard((key: KeyEvent) => {
    if (!active) return;
    if (key.name === 'up' || key.name === 'k') {
      setIdx((i) => (i - 1 + names.length) % names.length);
    } else if (key.name === 'down' || key.name === 'j') {
      setIdx((i) => (i + 1) % names.length);
    } else if (key.name === 'return' || key.name === 'enter') {
      const target = names[idx];
      if (target) {
        setTheme(target);
        const applied = themes[target];
        if (applied) onApply?.(applied);
      }
    } else if (key.name === 'escape') {
      onCancel?.();
    }
  });

  return (
    <Box variant="overlay" padding="md" style={{ flexDirection: 'column', gap: 1, minWidth: 32 }}>
      <Heading level={2}>Pick a theme</Heading>
      {names.map((name, i) => {
        const t = themes[name];
        if (!t) return null;
        const focused = i === idx;
        return (
          <Box
            key={name}
            variant={focused ? 'panel' : 'transparent'}
            padding="sm"
            style={{ flexDirection: 'row', gap: 1 }}
          >
            <Text variant={focused ? 'accent' : 'body'}>{focused ? '▸' : ' '}</Text>
            <Text variant={focused ? 'accent' : 'body'}>{t.displayName}</Text>
            <Text variant="subtle">({t.appearance})</Text>
            {t.name === activeName ? <Text variant="muted">· active</Text> : null}
          </Box>
        );
      })}
      <Text variant="subtle">↑↓ / j k navigate · enter apply · esc cancel</Text>
    </Box>
  );
}
