/**
 * Detect the host's OS, architecture, and (on Linux) distro family.
 * Pure-ish: reads from `node:os` and the filesystem only — no network,
 * no shell-out. Cached after first call.
 */

import { arch as nodeArch, platform as nodePlatform } from "node:os";
import { existsSync, readFileSync } from "node:fs";
import type {
  Architecture,
  LinuxFamily,
  Platform,
  PlatformInfo,
} from "./types.js";

let cached: PlatformInfo | undefined;

export function detectPlatform(): PlatformInfo {
  if (cached) return cached;

  const platform = normalizePlatform(nodePlatform());
  const arch = normalizeArch(nodeArch());
  const isWSL = detectWSL();
  const linuxFamily = platform === "linux" ? detectLinuxFamily() : undefined;

  cached = { platform, arch, isWSL, ...(linuxFamily ? { linuxFamily } : {}) };
  return cached;
}

/** For tests — clears the cache so each test sees a fresh detection. */
export function resetPlatformCache(): void {
  cached = undefined;
}

function normalizePlatform(raw: string): Platform {
  if (raw === "darwin") return "darwin";
  if (raw === "linux") return "linux";
  if (raw === "win32") return "win32";
  // Treat unknowns as linux — most BSD/sunos hosts have a linux-ish
  // package manager surface that's closer to dnf/apk than to brew.
  // The package-manager layer fails closed if no adapter is available.
  return "linux";
}

function normalizeArch(raw: string): Architecture {
  if (raw === "arm64") return "arm64";
  // 32-bit and other architectures collapse to x64 for catalog mapping
  // purposes. The package manager layer will fail at install time if
  // the package genuinely doesn't have a binary for this host.
  return "x64";
}

/**
 * WSL detection — `/proc/version` contains "microsoft" or "WSL" when
 * running under WSL. The plain `os.platform()` returns "linux" inside
 * WSL, but install behavior often diverges (some users prefer winget
 * on the Windows side, some apt on the Linux side), so callers want
 * to know.
 */
function detectWSL(): boolean {
  if (nodePlatform() !== "linux") return false;
  if (!existsSync("/proc/version")) return false;
  try {
    const version = readFileSync("/proc/version", "utf8").toLowerCase();
    return version.includes("microsoft") || version.includes("wsl");
  } catch {
    return false;
  }
}

/**
 * Linux distro family detection via `/etc/os-release`. The ID and
 * ID_LIKE fields tell us which family the distro derives from. Falls
 * back to "unknown" when the file is missing or unparseable — caller
 * can still proceed but adapter selection becomes a guess.
 */
function detectLinuxFamily(): LinuxFamily {
  if (!existsSync("/etc/os-release")) return "unknown";
  try {
    const content = readFileSync("/etc/os-release", "utf8");
    const fields = parseOsRelease(content);
    const id = (fields.ID ?? "").toLowerCase();
    const idLike = (fields.ID_LIKE ?? "").toLowerCase();
    const all = `${id} ${idLike}`;

    if (/\b(debian|ubuntu|mint|pop)\b/.test(all)) return "debian";
    if (/\b(fedora|rhel|centos|rocky|alma)\b/.test(all)) return "fedora";
    if (/\b(arch|manjaro|endeavouros)\b/.test(all)) return "arch";
    if (/\balpine\b/.test(all)) return "alpine";
    return "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Parse `/etc/os-release`-style key=value content. Values can be
 * unquoted, single-quoted, or double-quoted. Lines starting with `#`
 * are comments. Tolerant of surprises — bad lines are silently
 * dropped.
 */
function parseOsRelease(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    const value = rawValue.replace(/^["'](.*)["']$/, "$1");
    out[key] = value;
  }
  return out;
}
