/**
 * Package manager adapter interface. Each adapter wraps a single
 * package manager (brew, apt, dnf, ...) behind a uniform API so the
 * `ensure` layer above doesn't branch on platform.
 *
 * Design decisions:
 *
 *   - **No sudo by default.** Adapters that need elevation (apt, dnf,
 *     pacman) detect the current uid and prefix `sudo` only when not
 *     already root. They never silently sudo without the user's shell
 *     handling the prompt.
 *
 *   - **Capture, don't stream.** install/uninstall return
 *     InstallResult with stdout/stderr captured. The CLI layer can
 *     decide whether to print them live (today: print on completion).
 *     A future Phase 6 task can swap this for streaming progress when
 *     the user passes `--verbose`.
 *
 *   - **isAvailable is cheap.** It runs `which <pm>` and caches the
 *     result. Auto-selection calls it once per adapter when picking a
 *     manager for the current host.
 */

import type { PackageManagerType } from './types.js';

export interface InstallResult {
  success: boolean;
  /** Full captured stdout from the install command. */
  stdout: string;
  /** Full captured stderr — may contain progress messages even on success. */
  stderr: string;
  /** Set when success === false. Human-readable failure summary. */
  error?: string;
}

export interface PackageManagerAdapter {
  /** Identifier for this adapter (matches PackageManagerType). */
  readonly name: PackageManagerType;

  /** Is this package manager runnable on the current host? Cached. */
  isAvailable(): Promise<boolean>;

  /** Install a single package by its platform-specific name. */
  install(packageName: string): Promise<InstallResult>;

  /** Uninstall (remove) a package. */
  uninstall(packageName: string): Promise<InstallResult>;

  /**
   * Is this *package* (by manager-specific name) currently installed
   * via this manager? Distinct from tool-checker.isInstalled, which
   * just checks PATH — a package can be installed but its binary not
   * on PATH (rare but possible with manual configurations).
   */
  isPackageInstalled(packageName: string): Promise<boolean>;
}
