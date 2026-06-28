/**
 * Apt adapter — Debian, Ubuntu, Mint, Pop!_OS, and other Debian-family
 * distros. Always needs root for install/uninstall; uses `sudo` when
 * the current process isn't already root.
 *
 * `apt-get` is preferred over `apt` for scripts (apt's CLI is documented
 * as unstable for non-interactive use; apt-get's interface is the
 * stable one).
 */

import type { InstallResult, PackageManagerAdapter } from '../package-managers.js';
import { commandExists, needsSudo, runCommand } from './exec.js';

let availabilityCache: boolean | undefined;

export const aptAdapter: PackageManagerAdapter = {
  name: 'apt',

  async isAvailable(): Promise<boolean> {
    if (availabilityCache !== undefined) return availabilityCache;
    availabilityCache = await commandExists('apt-get');
    return availabilityCache;
  },

  async install(packageName: string): Promise<InstallResult> {
    const { cmd, args } = withSudo('apt-get', [
      'install',
      '-y',
      '--no-install-recommends',
      packageName,
    ]);
    return runCommand(cmd, args);
  },

  async uninstall(packageName: string): Promise<InstallResult> {
    const { cmd, args } = withSudo('apt-get', ['remove', '-y', packageName]);
    return runCommand(cmd, args);
  },

  async isPackageInstalled(packageName: string): Promise<boolean> {
    // `dpkg-query -W -f='${Status}' <pkg>` returns "install ok installed"
    // when present. Non-zero exit when absent.
    // biome-ignore lint/suspicious/noTemplateCurlyInString: ${Status} is dpkg-query format syntax, not a JS template
    const result = await runCommand('dpkg-query', ['-W', '-f=${Status}', packageName]);
    return result.success && result.stdout.includes('install ok installed');
  },
};

function withSudo(cmd: string, args: string[]): { cmd: string; args: string[] } {
  if (needsSudo()) {
    return { cmd: 'sudo', args: [cmd, ...args] };
  }
  return { cmd, args };
}

/** For tests — clear the availability cache. */
export function _resetAptCache(): void {
  availabilityCache = undefined;
}
