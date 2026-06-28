import { detectPlatform } from '../platform/index.js';

/** Show the detected OS, architecture, distro family, and WSL state. */
export function runPlatform(): void {
  const info = detectPlatform();
  console.log(JSON.stringify(info, null, 2));
}
