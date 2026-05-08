/**
 * Pritty's auth surface — a thin layer over @ecruz165/agent-auth.
 *
 * The implementation plan originally had pritty re-implement OAuth
 * Device Flow + token cascade + Copilot exchange from scratch. Now
 * those primitives live in @ecruz165/agent-auth (a toolbox-shared
 * library); pritty consumes them and only owns:
 *
 *   - the path resolution to ~/.pritty/auth.json
 *   - thin command wrappers (login, logout, status) for CLI use
 *
 * If a future change wants to switch auth storage (e.g. system
 * keychain), it lands in @ecruz165/agent-auth and every consuming app
 * (pritty, gittyup, etc.) inherits the change.
 */

import { unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  AuthStore,
  type AuthFile,
  loginGitHubCopilot,
  type DeviceFlowResult,
} from "@ecruz165/agent-auth";

/** Resolve the pritty auth-store location. Override via PRITTY_HOME. */
export function getAuthPath(): string {
  const home = process.env.PRITTY_HOME ?? join(homedir(), ".pritty");
  return join(home, "auth.json");
}

export function getAuthStore(): AuthStore {
  return new AuthStore(getAuthPath());
}

/**
 * Run the GitHub Device Flow and persist credentials. Caller is
 * responsible for printing the user-code + verification URL — we pass
 * a callback so the CLI can use chalk/ora.
 */
export async function login(opts: {
  onPrompt: (info: {
    verificationUri: string;
    userCode: string;
    expiresIn: number;
  }) => void;
}): Promise<DeviceFlowResult> {
  const result = await loginGitHubCopilot({
    onPrompt: opts.onPrompt,
  });

  const store = getAuthStore();
  const existing = await store.read();
  const next: AuthFile = {
    version: 1,
    providers: {
      ...existing.providers,
      [result.provider]: {
        apiKey: result.apiKey,
        ...(result.tokenType ? { tokenType: result.tokenType } : {}),
        ...(result.scope ? { scope: result.scope } : {}),
        ...(result.expiresAt ? { expiresAt: result.expiresAt } : {}),
        createdAt: new Date().toISOString(),
      },
    },
  };
  await store.write(next);
  return result;
}

/** Read the current auth file (or empty default if not yet created). */
export async function readAuth(): Promise<AuthFile> {
  return await getAuthStore().read();
}

/** Remove the auth file entirely. AuthStore has no delete(); unlink directly. */
export async function logout(): Promise<void> {
  try {
    await unlink(getAuthPath());
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}
