/**
 * Molecules — small composites of atoms. Each does one thing well
 * by combining 2–3 atoms with light orchestration (e.g., Panel =
 * Box + optional Text title; Spinner = Box + Text + animation;
 * KeybindingsBar = Box + Text reading from the keyboard registry).
 *
 * Per Atomic Design: molecules are the smallest unit of composed
 * UI. They have minimal internal state; complex state lives in
 * organisms.
 */

export type { KeybindingsBarProps } from './KeybindingsBar.tsx';
export { KeybindingsBar } from './KeybindingsBar.tsx';
export type { PanelProps } from './Panel.tsx';
export { Panel } from './Panel.tsx';
export type { SpinnerProps } from './Spinner.tsx';
export { Spinner } from './Spinner.tsx';
