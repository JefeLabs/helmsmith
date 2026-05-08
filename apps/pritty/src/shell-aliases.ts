/**
 * Optional shell-alias setup. Writes (or updates) a marker-bracketed
 * block in the user's shell rc file so plain `commit` and `pr`
 * resolve to `pritty commit` and `pritty pr`. Off by default — only
 * runs when the user opts in at `pritty init` time.
 *
 * Idempotent: re-running replaces the existing pritty block instead
 * of duplicating it. Refuses to mangle a file with an unterminated
 * marker (start but no end) — the user has been editing by hand and
 * we shouldn't second-guess that.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type SupportedShell = "zsh" | "bash" | "fish";

export const ALIAS_BLOCK_START = "# >>> pritty aliases >>>";
export const ALIAS_BLOCK_END = "# <<< pritty aliases <<<";

/**
 * Detect the user's shell from $SHELL. Returns null when the shell
 * isn't one we know how to write aliases for — caller should skip
 * the prompt rather than guess.
 */
export function detectShell(): SupportedShell | null {
  const shell = process.env.SHELL ?? "";
  if (shell.endsWith("/zsh") || shell.endsWith("\\zsh")) return "zsh";
  if (shell.endsWith("/bash") || shell.endsWith("\\bash")) return "bash";
  if (shell.endsWith("/fish") || shell.endsWith("\\fish")) return "fish";
  return null;
}

/** rc file path for the given shell, relative to the user's home. */
export function rcPathFor(shell: SupportedShell): string {
  const home = homedir();
  switch (shell) {
    case "zsh":
      return join(home, ".zshrc");
    case "bash":
      return join(home, ".bashrc");
    case "fish":
      return join(home, ".config", "fish", "config.fish");
  }
}

/**
 * The alias body. Bash/zsh use `=`; fish doesn't. Wrapping the value
 * in double-quotes is fine for both since the value has no special
 * shell characters.
 */
export function aliasBlock(shell: SupportedShell): string {
  const lines: string[] = [ALIAS_BLOCK_START];
  if (shell === "fish") {
    lines.push(`alias commit "pritty commit"`);
    lines.push(`alias pr "pritty pr"`);
  } else {
    lines.push(`alias commit="pritty commit"`);
    lines.push(`alias pr="pritty pr"`);
  }
  lines.push(ALIAS_BLOCK_END);
  return lines.join("\n");
}

export interface InstallResult {
  rcPath: string;
  /** True when an existing pritty block was replaced; false when fresh-appended. */
  replaced: boolean;
}

/**
 * Install (or update) the alias block in the user's rc file. Returns
 * which file was touched and whether an existing block was replaced.
 * Throws when the file has an unterminated marker — that's the user's
 * editing state and we don't want to corrupt it.
 */
export function installShellAliases(shell: SupportedShell): InstallResult {
  const rcPath = rcPathFor(shell);
  const block = aliasBlock(shell);
  let content = "";
  if (existsSync(rcPath)) {
    content = readFileSync(rcPath, "utf8");
  }

  const startIdx = content.indexOf(ALIAS_BLOCK_START);
  if (startIdx >= 0) {
    const endMarkerIdx = content.indexOf(ALIAS_BLOCK_END, startIdx);
    if (endMarkerIdx < 0) {
      throw new Error(
        `${rcPath} contains a "${ALIAS_BLOCK_START}" marker without a matching end marker. Refusing to overwrite — clean up the file by hand and retry.`,
      );
    }
    const before = content.slice(0, startIdx);
    const after = content.slice(endMarkerIdx + ALIAS_BLOCK_END.length);
    writeFileSync(rcPath, `${before}${block}${after}`);
    return { rcPath, replaced: true };
  }

  // Fresh append — make sure the parent dir exists (fish's default
  // location may not be created yet on a fresh user setup).
  mkdirSync(dirname(rcPath), { recursive: true });
  const separator =
    content.length === 0 ? "" : content.endsWith("\n") ? "\n" : "\n\n";
  writeFileSync(rcPath, `${content}${separator}${block}\n`);
  return { rcPath, replaced: false };
}

/**
 * Remove the alias block from the user's rc file (if present). Used
 * by `pritty alias remove` style flows. Idempotent: no-op when no
 * block is present. Throws on unterminated marker (same reason as
 * install).
 */
export function uninstallShellAliases(shell: SupportedShell): boolean {
  const rcPath = rcPathFor(shell);
  if (!existsSync(rcPath)) return false;
  const content = readFileSync(rcPath, "utf8");
  const startIdx = content.indexOf(ALIAS_BLOCK_START);
  if (startIdx < 0) return false;
  const endMarkerIdx = content.indexOf(ALIAS_BLOCK_END, startIdx);
  if (endMarkerIdx < 0) {
    throw new Error(
      `${rcPath} has a start marker but no end marker — refusing to mangle.`,
    );
  }
  const before = content.slice(0, startIdx).replace(/\n+$/, "");
  const after = content.slice(endMarkerIdx + ALIAS_BLOCK_END.length).replace(/^\n+/, "");
  const next = before.length > 0 && after.length > 0
    ? `${before}\n${after}`
    : `${before}${after}`;
  writeFileSync(rcPath, next);
  return true;
}
