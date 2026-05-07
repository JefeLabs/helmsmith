/**
 * Platform identification primitives shared across ToolZ. Intentionally
 * narrow — just what the package manager adapters and tool-resolver
 * need to pick the right install path for the current host.
 */

export type Platform = "darwin" | "linux" | "win32";

export type Architecture = "x64" | "arm64";

/**
 * Linux distro family. Determines which package manager to default to
 * when the user is on Linux. Distros within a family share the same
 * package manager (`apt` for Debian/Ubuntu/Mint, `dnf` for Fedora/RHEL,
 * etc.).
 */
export type LinuxFamily =
  | "debian" // apt: Debian, Ubuntu, Mint, Pop!_OS, ...
  | "fedora" // dnf: Fedora, RHEL, CentOS Stream, ...
  | "arch" // pacman: Arch, Manjaro, ...
  | "alpine" // apk: Alpine
  | "unknown";

export type PackageManagerType =
  | "brew" // macOS, Linuxbrew
  | "apt" // Debian-family
  | "dnf" // Fedora-family
  | "pacman" // Arch-family
  | "apk" // Alpine
  | "winget" // Windows: Winget
  | "scoop" // Windows: Scoop
  | "choco"; // Windows: Chocolatey

export interface PlatformInfo {
  platform: Platform;
  arch: Architecture;
  /** Linux distro family — set only when platform === "linux". */
  linuxFamily?: LinuxFamily;
  /** True when running under WSL (Linux env on Windows host). */
  isWSL: boolean;
}
